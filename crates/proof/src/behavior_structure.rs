use crate::Evidence;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StructureAssessment {
    pub profile: String,
    pub version: String,
    pub saves: u64,
    pub pauses: u64,
    pub changes: u64,
    pub gaps: u64,
    pub first_gap_seq: Option<u64>,
}

/// Called after certificate verification. Count only observations that each
/// host is capable of making, and flag only an explicit interruption.
pub fn assess(evidence: &Evidence) -> Option<StructureAssessment> {
    let (profile, observed_changes): (_, &[&str]) = match evidence.manifest().source.as_str() {
        "photoshop" | "krita" => ("image", &["layer", "edit", "undo", "redo"]),
        "illustrator" => ("vector", &["layout", "edit"]),
        "indesign" => ("layout", &["layout", "edit"]),
        "blender" => ("model", &["mesh", "modifier", "layer"]),
        "powerpoint" | "wps-presentation" => ("presentation", &["layout", "edit"]),
        "excel" | "wps-spreadsheets" => ("spreadsheet", &["layout", "edit"]),
        "sai2-file" => ("saved_file", &[]),
        _ => return None,
    };
    let mut result = StructureAssessment {
        profile: profile.into(),
        version: "structure-coverage/1".into(),
        saves: 0,
        pauses: 0,
        changes: 0,
        gaps: 0,
        first_gap_seq: None,
    };
    for record in evidence.records() {
        let event = &record.event;
        match event.kind.as_str() {
            "save" => result.saves += 1,
            "pause" => result.pauses += 1,
            "gap" => {
                result.gaps += 1;
                result.first_gap_seq.get_or_insert(event.seq);
            }
            kind if observed_changes.contains(&kind) => result.changes += 1,
            _ => {}
        }
    }
    Some(result)
}
