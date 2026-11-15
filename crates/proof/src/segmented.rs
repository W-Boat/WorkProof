//! Streaming validation for segmented full-record certificates.
//! The caller must authenticate the expected count, tail and file digest
//! together in the certificate manifest before trusting the result.

use crate::{event_hash, genesis, valid_hash, validate_event_payload, Record, MAX_EVENTS};

/// Reject unbounded certificates independently of the per-segment limit.
pub const MAX_TOTAL_EVENTS: u64 = 1_000_000;

#[derive(Debug, PartialEq, Eq)]
pub enum ChainError {
    SegmentSize,
    EventCount,
    InvalidEvent,
    ChainLink,
    FinalSave,
}

/// One chain crosses all segment boundaries. Verification can release each
/// segment immediately after its records have been checked.
pub struct SegmentChain {
    next_seq: u64,
    elapsed_ms: u64,
    head: String,
    final_save: Option<String>,
}

impl SegmentChain {
    pub fn new(session_id: &str) -> Self {
        Self {
            next_seq: 0,
            elapsed_ms: 0,
            head: genesis(session_id),
            final_save: None,
        }
    }

    /// Advance only after checking the entire segment. A failed segment
    /// cannot leave a partly advanced verifier behind.
    pub fn push(&mut self, records: &[Record]) -> Result<(), ChainError> {
        if records.is_empty() || records.len() > MAX_EVENTS {
            return Err(ChainError::SegmentSize);
        }
        if self.next_seq + records.len() as u64 > MAX_TOTAL_EVENTS {
            return Err(ChainError::EventCount);
        }

        let mut head = self.head.clone();
        let mut elapsed = self.elapsed_ms;
        for (offset, record) in records.iter().enumerate() {
            let event = &record.event;
            let sequence = self.next_seq + offset as u64;
            if event.seq != sequence
                || event.elapsed_ms < elapsed
                || (sequence == 0 && event.kind != "start")
                || !validate_event_payload(event)
            {
                return Err(ChainError::InvalidEvent);
            }

            let expected = event_hash(&head, event);
            if expected != record.hash {
                return Err(ChainError::ChainLink);
            }
            head = expected;
            elapsed = event.elapsed_ms;
        }

        let last = &records[records.len() - 1].event;
        self.final_save = (last.kind == "save").then(|| last.checkpoint.clone());
        self.next_seq += records.len() as u64;
        self.elapsed_ms = elapsed;
        self.head = head;
        Ok(())
    }

    pub fn finish(
        self,
        signed_count: u64,
        signed_head: &str,
        artifact_hash: &str,
    ) -> Result<(), ChainError> {
        if signed_count < 2 || signed_count != self.next_seq {
            return Err(ChainError::EventCount);
        }
        if self.head != signed_head {
            return Err(ChainError::ChainLink);
        }
        if !valid_hash(artifact_hash) || self.final_save.as_deref() != Some(artifact_hash) {
            return Err(ChainError::FinalSave);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{digest, Event};

    fn records(session: &str, count: usize, artifact: &str) -> Vec<Record> {
        let mut head = genesis(session);
        (0..count).map(|index| {
            let kind = match index {
                0 => "start",
                i if i == count - 1 => "save",
                _ => "edit",
            };
            let event = Event {
                seq: index as u64,
                elapsed_ms: index as u64,
                kind: kind.into(),
                inserted: u64::from(kind == "edit"),
                deleted: 0,
                chars: index as u64,
                checkpoint: if kind == "save" { artifact.into() } else { String::new() },
                metrics: Default::default(),
            };
            head = event_hash(&head, &event);
            Record { event, hash: head.clone() }
        }).collect()
    }

    #[test]
    fn crosses_legacy_event_limit_and_rejects_missing_reordered_or_tampered_segments() {
        let artifact = digest(b"final");
        let count = MAX_EVENTS + 17;
        let full = records("session", count, &artifact);
        let head = &full[count - 1].hash;
        let (first, second) = full.split_at(MAX_EVENTS);

        let mut chain = SegmentChain::new("session");
        assert_eq!(chain.push(second), Err(ChainError::InvalidEvent));
        chain.push(first).unwrap();
        let mut changed = second.to_vec();
        changed[0].event.inserted += 1;
        assert_eq!(chain.push(&changed), Err(ChainError::ChainLink));
        chain.push(second).unwrap();
        chain.finish(count as u64, head, &artifact).unwrap();

        let mut incomplete = SegmentChain::new("session");
        incomplete.push(first).unwrap();
        assert_eq!(incomplete.finish(count as u64, head, &artifact), Err(ChainError::EventCount));

        let mut wrong_file = SegmentChain::new("session");
        wrong_file.push(first).unwrap();
        wrong_file.push(second).unwrap();
        assert_eq!(wrong_file.finish(count as u64, head, &digest(b"other")), Err(ChainError::FinalSave));
    }
}
