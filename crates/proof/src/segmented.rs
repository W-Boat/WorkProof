//! Signed full-record certificates with a chain that crosses segment boundaries.

use crate::{event_hash, genesis, signing_bytes, valid_hash, validate_event_payload, Manifest, Record, Report, MAX_EVENTS};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};

pub const VERSION: &str = "workproof/segmented/1";
/// Bounds both proof verification work and the signed layout.
pub const MAX_TOTAL_EVENTS: u64 = 1_000_000;
pub const MAX_SEGMENTS: usize = 10_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParagraphLocation {
    pub ordinal: u32,
    pub fingerprint: String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub historical_id: Option<u64>,
    pub first_seq: u64,
    pub last_seq: u64,
}


#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentedProof {
    pub manifest: Manifest,
    pub segments: Vec<Vec<Record>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paragraphs: Vec<ParagraphLocation>,
    pub signature: String,
}

impl SegmentedProof {
    pub fn sign(manifest: Manifest, segments: Vec<Vec<Record>>, key: &SigningKey) -> Result<Self, ChainError> {
        Self::sign_with_paragraphs(manifest, segments, Vec::new(), key)
    }

    pub fn sign_with_paragraphs(
        mut manifest: Manifest, segments: Vec<Vec<Record>>, paragraphs: Vec<ParagraphLocation>, key: &SigningKey,
    ) -> Result<Self, ChainError> {
        manifest.protocol = VERSION.into();
        manifest.merkle_root.clear();
        manifest.public_key = hex::encode(key.verifying_key().to_bytes());
        let mut proof = Self { manifest, segments, paragraphs, signature: String::new() };
        if !proof.valid_manifest() {
            return Err(ChainError::Manifest);
        }
        proof.check_chain()?;
        proof.signature = hex::encode(key.sign(&proof.signing_payload()).to_bytes());
        Ok(proof)
    }

    /// The domain tag distinguishes this signature from every flat manifest.
    fn signing_payload(&self) -> Vec<u8> {
        let mut bytes = b"WorkProof:segmented-manifest:v1\0".to_vec();
        bytes.extend_from_slice(&signing_bytes(&self.manifest));
        bytes.extend_from_slice(&(self.segments.len() as u64).to_le_bytes());
        for segment in &self.segments {
            bytes.extend_from_slice(&(segment.len() as u64).to_le_bytes());
        }
        if !self.paragraphs.is_empty() {
            bytes.extend_from_slice(b"WorkProof:paragraph-locations:v1\0");
            bytes.extend_from_slice(&(self.paragraphs.len() as u64).to_le_bytes());
            for location in &self.paragraphs {
                bytes.extend_from_slice(&location.ordinal.to_le_bytes());
                bytes.extend_from_slice(location.fingerprint.as_bytes());
                bytes.extend_from_slice(&location.first_seq.to_le_bytes());
                bytes.extend_from_slice(&location.last_seq.to_le_bytes());
            }
        }
        if self.paragraphs.iter().any(|row|row.historical_id.is_some()) {
            bytes.extend_from_slice(b"WorkProof:historical-paragraphs:v1\0");
            for row in &self.paragraphs {
                bytes.extend_from_slice(&row.historical_id.unwrap_or(0).to_le_bytes());
            }
        }
        bytes
    }

    pub(crate) fn valid_manifest(&self) -> bool {
        let m = &self.manifest;
        m.protocol == VERSION
            && m.merkle_root.is_empty()
            && m.identity == "self-signed"
            && m.time_evidence == "none"
            && !m.session_id.is_empty()
            && m.session_id.len() <= 128
            && m.file_name.len() <= 1024
            && m.started_at.len() <= 64
            && m.source.len() <= 128
            && (2..=MAX_TOTAL_EVENTS).contains(&m.event_count)
            && valid_hash(&m.chain_head)
            && valid_hash(&m.artifact_hash)
            && valid_hash(&m.public_key)
            && (1..=MAX_SEGMENTS).contains(&self.segments.len())
            && self.paragraphs.len() <= 50_000
            && self.paragraphs.iter().enumerate().all(|(i,row)|
                (i==0 || self.paragraphs[i-1].last_seq<row.first_seq)
                && row.ordinal>0 && row.historical_id!=Some(0) && valid_hash(&row.fingerprint)
                && row.first_seq>0 && row.first_seq<=row.last_seq && row.last_seq<m.event_count)
    }

    fn check_chain(&self) -> Result<(), ChainError> {
        let m = &self.manifest;
        let mut chain = SegmentChain::new(&m.session_id);
        for segment in &self.segments {
            chain.push(segment)?;
        }
        chain.finish(m.event_count, &m.chain_head, &m.artifact_hash)
    }

    fn valid_signature(&self) -> bool {
        (|| {
            if self.signature.len() != 128 { return None; }
            let pk: [u8; 32] = hex::decode(&self.manifest.public_key).ok()?.try_into().ok()?;
            let sig = Signature::from_slice(&hex::decode(&self.signature).ok()?).ok()?;
            VerifyingKey::from_bytes(&pk).ok()?.verify_strict(&self.signing_payload(), &sig).ok()
        })().is_some()
    }

    pub fn verify(&self, artifact_hash: &str, artifact_bytes: u64) -> Report {
        let m = &self.manifest;
        let schema = self.valid_manifest();
        let signature_valid = schema && self.valid_signature();
        // Avoid scanning unauthenticated or oversized segment collections.
        let chain_valid = signature_valid && self.check_chain().is_ok();
        let file_match = artifact_hash == m.artifact_hash && artifact_bytes == m.artifact_bytes;
        let mut errors = Vec::new();
        if !schema { errors.push("UNSUPPORTED_MANIFEST".into()); }
        if !signature_valid { errors.push("SIGNATURE_INVALID".into()); }
        if signature_valid && !chain_valid { errors.push("CHAIN_INVALID".into()); }
        if !file_match { errors.push("FILE_MISMATCH".into()); }
        Report {
            valid: file_match && chain_valid,
            file_match,
            chain_valid,
            signature_valid,
            merkle_valid: None,
            scope: "full".into(),
            disclosed_events: if chain_valid { m.event_count } else { 0 },
            total_events: m.event_count,
            errors,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ChainError {
    Manifest,
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
    fn signed_layout_rejects_repacking_and_file_changes() {
        let artifact = digest(b"final");
        let mut full = records("session", 5, &artifact);
        let head = full.last().unwrap().hash.clone();
        let tail = full.split_off(3);
        let manifest = Manifest {
            protocol: String::new(),
            session_id: "session".into(),
            file_name: "draft.md".into(),
            started_at: String::new(),
            source: "workproof-tiptap".into(),
            event_count: 5,
            chain_head: head,
            artifact_hash: artifact.clone(),
            artifact_bytes: 5,
            public_key: String::new(),
            identity: "self-signed".into(),
            time_evidence: "none".into(),
            demo: false,
            merkle_root: String::new(),
        };
        let key = SigningKey::from_bytes(&[3; 32]);
        let location = ParagraphLocation { ordinal: 1, fingerprint: digest(b"paragraph"), historical_id: Some(3), first_seq: 1, last_seq: 1 };
        let mut proof = SegmentedProof::sign_with_paragraphs(manifest, vec![full, tail], vec![location], &key).unwrap();
        proof.paragraphs[0].ordinal = 2;
        assert!(!proof.verify(&artifact, 5).signature_valid);
        proof.paragraphs[0].ordinal = 1;
        proof.paragraphs[0].historical_id=None;
        assert!(!proof.verify(&artifact, 5).signature_valid);
        proof.paragraphs[0].historical_id=Some(3);
        assert!(proof.verify(&artifact, 5).valid);
        let encoded = serde_json::to_vec(&proof).unwrap();
        let parsed: crate::Evidence = serde_json::from_slice(&encoded).unwrap();
        assert!(crate::verify_evidence(&parsed, &artifact, 5).valid);
        let inspection = crate::inspect_certificate_json(&encoded);
        assert!(inspection.certificate_valid);
        assert!(!inspection.artifact_checked);
        assert_eq!(inspection.disclosed_events, 5);
        assert!(!proof.verify(&artifact, 6).file_match);

        let boundary = proof.segments[0].pop().unwrap();
        proof.segments[1].insert(0, boundary);
        assert!(proof.check_chain().is_ok());
        assert!(!proof.verify(&artifact, 5).signature_valid);
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
