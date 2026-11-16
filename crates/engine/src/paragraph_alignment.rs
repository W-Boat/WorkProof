use serde_json::Value;
use std::collections::HashMap;

pub(crate) fn fingerprints(document: &Value) -> Vec<String> {
    fn visit(node: &Value, fingerprints: &mut Vec<String>) {
        match node["type"].as_str() {
            Some("paragraph" | "heading" | "codeBlock") => {
                let mut hasher = blake3::Hasher::new();
                append_text(node, &mut hasher);
                fingerprints.push(hasher.finalize().to_hex().to_string());
            }
            _ => {
                if let Some(children) = node["content"].as_array() {
                    for child in children {
                        visit(child, fingerprints);
                    }
                }
            }
        }
    }

    fn append_text(node: &Value, hasher: &mut blake3::Hasher) {
        if let Some(text) = node["text"].as_str() {
            hasher.update(text.as_bytes());
        }
        if node["type"] == "hardBreak" {
            hasher.update(b"\n");
        }
        if let Some(children) = node["content"].as_array() {
            for child in children {
                append_text(child, hasher);
            }
        }
    }

    let mut result = Vec::new();
    visit(document, &mut result);
    result
}


#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Change {
    Edited { before: usize, after: usize },
    Inserted { after: usize },
    Deleted { before: usize },
    Unchanged,
    /// Multiple interpretations are possible from the two snapshots.
    Unassigned,
}

/// Infer a single paragraph change from two consecutive samples. Compare
/// paragraph fingerprints only so callers can discard sampled text.
pub(crate) fn single_change(before: &[String], after: &[String]) -> Change {
    if before == after {
        return Change::Unchanged;
    }

    let prefix = before.iter().zip(after).take_while(|(a, b)| a == b).count();
    let suffix = before[prefix..].iter().rev().zip(after[prefix..].iter().rev())
        .take_while(|(a, b)| a == b).count();
    let old = &before[prefix..before.len() - suffix];
    let new = &after[prefix..after.len() - suffix];

    // Repeated text cannot establish which occurrence changed or moved.
    let mut old_counts = HashMap::new();
    let mut new_counts = HashMap::new();
    for hash in before { *old_counts.entry(hash).or_insert(0_u32) += 1; }
    for hash in after { *new_counts.entry(hash).or_insert(0_u32) += 1; }
    match (old, new) {
        ([old], [new])
            if old_counts.get(old) == Some(&1) && new_counts.get(new) == Some(&1)
            && !new_counts.contains_key(old) && !old_counts.contains_key(new) =>
        {
            Change::Edited { before: prefix, after: prefix }
        }
        ([], [item]) if new_counts.get(item) == Some(&1) => Change::Inserted { after: prefix },
        ([item], []) if old_counts.get(item) == Some(&1) => Change::Deleted { before: prefix },
        _ => Change::Unassigned,
    }
}

/// Carry an identity across unique unchanged text or one unambiguous edit.
pub(crate) fn align_identities(
    before: &[String], old_ids: &[u64], after: &[String], change: &Change, next_id: &mut u64,
) -> Vec<u64> {
    if before == after {
        return old_ids.to_vec();
    }

    let mut unique = HashMap::new();
    for (hash, id) in before.iter().zip(old_ids) {
        unique.entry(hash.as_str()).and_modify(|found| *found = None).or_insert(Some(*id));
    }
    let mut counts = HashMap::new();
    for hash in after {
        *counts.entry(hash.as_str()).or_insert(0usize) += 1;
    }

    after.iter().enumerate().map(|(index, hash)| {
        if let Change::Edited { before, after } = change {
            if index == *after {
                return old_ids[*before];
            }
        }
        let previous = unique.get(hash.as_str()).copied().flatten();
        if counts.get(hash.as_str()) == Some(&1) {
            if let Some(id) = previous {
                return id;
            }
        }
        *next_id += 1;
        *next_id
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(values: &[&str]) -> Vec<String> {
        values.iter().map(|text| workproof_protocol::digest(text.as_bytes())).collect()
    }

    #[test]
    fn keeps_identity_after_rewriting_and_moving_a_unique_paragraph() {
        let mut next=2;
        let before=sample(&["heading","draft"]);
        let rewritten=sample(&["heading","revised"]);
        let moved=sample(&["revised","heading"]);
        let ids=align_identities(&before,&[1,2],&rewritten,&single_change(&before,&rewritten),&mut next);
        assert_eq!(ids,[1,2]);
        let ids=align_identities(&rewritten,&ids,&moved,&single_change(&rewritten,&moved),&mut next);
        assert_eq!(ids,[2,1]);

        let repeated=sample(&["revised","revised","heading"]);
        let ids=align_identities(&moved,&ids,&repeated,&single_change(&moved,&repeated),&mut next);
        assert!(!ids[..2].contains(&2));
    }

    #[test]
    fn locates_a_single_change_and_leaves_ambiguous_edits_unassigned() {
        assert_eq!(single_change(&sample(&["a", "旧", "z"]), &sample(&["a", "新", "z"])),
            Change::Edited { before: 1, after: 1 });
        assert_eq!(single_change(&sample(&["a", "z"]), &sample(&["a", "新", "z"])),
            Change::Inserted { after: 1 });
        assert_eq!(single_change(&sample(&["a", "旧", "z"]), &sample(&["a", "z"])),
            Change::Deleted { before: 1 });
        assert_eq!(single_change(&sample(&["重复", "重复"]), &sample(&["新", "重复"])),
            Change::Unassigned);
        assert_eq!(single_change(&sample(&["a", "b"]), &sample(&["b", "a"])),
            Change::Unassigned);
    }
}
