//! WorkProof v1: a locally signed process record, not a proof of human authorship.
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

pub const VERSION: &str = "workproof/1";
pub const MAX_EVENTS: usize = 100_000;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub seq: u64,
    pub elapsed_ms: u64,
    pub kind: String,
    pub inserted: u64,
    pub deleted: u64,
    pub chars: u64,
    pub checkpoint: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record { pub event: Event, pub hash: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub protocol: String,
    pub session_id: String,
    pub file_name: String,
    pub started_at: String,
    pub source: String,
    pub event_count: u64,
    pub chain_head: String,
    pub artifact_hash: String,
    pub artifact_bytes: u64,
    pub public_key: String,
    pub identity: String,
    pub time_evidence: String,
    pub demo: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proof { pub manifest: Manifest, pub records: Vec<Record>, pub signature: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    pub valid: bool,
    pub file_match: bool,
    pub chain_valid: bool,
    pub signature_valid: bool,
    pub errors: Vec<String>,
}

fn field(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value.as_bytes());
}
pub fn genesis(session: &str) -> String {
    let mut b = b"WorkProof:genesis:v1\0".to_vec(); field(&mut b, session); digest(&b)
}
pub fn digest(bytes: &[u8]) -> String { blake3::hash(bytes).to_hex().to_string() }
pub fn event_hash(previous: &str, e: &Event) -> String {
    let mut b = b"WorkProof:event:v1\0".to_vec(); field(&mut b, previous);
    for n in [e.seq, e.elapsed_ms, e.inserted, e.deleted, e.chars] { b.extend_from_slice(&n.to_le_bytes()); }
    field(&mut b, &e.kind); field(&mut b, &e.checkpoint); digest(&b)
}
pub fn signing_bytes(m: &Manifest) -> Vec<u8> {
    let mut b = b"WorkProof:manifest:v1\0".to_vec();
    for s in [&m.protocol, &m.session_id, &m.file_name, &m.started_at, &m.source, &m.chain_head,
        &m.artifact_hash, &m.public_key, &m.identity, &m.time_evidence] { field(&mut b, s); }
    b.extend_from_slice(&m.event_count.to_le_bytes());
    b.extend_from_slice(&m.artifact_bytes.to_le_bytes()); b.push(u8::from(m.demo)); b
}
pub fn sign(manifest: Manifest, records: Vec<Record>, key: &SigningKey) -> Proof {
    let signature = hex::encode(key.sign(&signing_bytes(&manifest)).to_bytes());
    Proof { manifest, records, signature }
}
pub fn valid_hash(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
pub fn validate_event(e: &Event) -> bool {
    matches!(e.kind.as_str(), "start"|"edit"|"undo"|"redo"|"save"|"pause"|"resume"|"gap"|"stop")
    && e.seq < MAX_EVENTS as u64 && e.elapsed_ms <= 31_536_000_000
    && e.inserted <= 100_000_000 && e.deleted <= 100_000_000 && e.chars <= 100_000_000
    && (e.checkpoint.is_empty() || valid_hash(&e.checkpoint))
}
pub fn verify(p: &Proof, artifact_hash: &str, artifact_bytes: u64) -> Report {
    let m = &p.manifest;
    let mut errors = vec![];
    let schema = m.protocol == VERSION && m.identity == "self-signed" && m.time_evidence == "none"
        && !m.session_id.is_empty() && m.session_id.len() <= 128 && m.file_name.len() <= 1024
        && m.started_at.len() <= 64 && m.source.len() <= 128 && valid_hash(&m.artifact_hash);
    if !schema { errors.push("UNSUPPORTED_MANIFEST".into()); }
    let file_match = artifact_hash == m.artifact_hash && artifact_bytes == m.artifact_bytes;
    if !file_match { errors.push("FILE_MISMATCH".into()); }
    let mut prev = genesis(&m.session_id);
    let mut elapsed = 0;
    let mut chain_valid = !p.records.is_empty() && p.records.len() <= MAX_EVENTS && p.records.len() as u64 == m.event_count;
    for (i, r) in p.records.iter().enumerate().take(MAX_EVENTS + 1) {
        if !validate_event(&r.event) || r.event.seq != i as u64 || r.event.elapsed_ms < elapsed
            || (i == 0 && r.event.kind != "start") { chain_valid = false; }
        let computed = event_hash(&prev, &r.event);
        if computed != r.hash { chain_valid = false; }
        prev = computed; elapsed = r.event.elapsed_ms;
    }
    if prev != m.chain_head { chain_valid = false; }
    // The exported artifact must be the final recorded save checkpoint.
    if !p.records.last().is_some_and(|r| r.event.kind == "save" && r.event.checkpoint == m.artifact_hash) { chain_valid = false; }
    if !chain_valid { errors.push("CHAIN_INVALID".into()); }
    let signature_valid = (|| {
        let pk: [u8;32] = hex::decode(&m.public_key).ok()?.try_into().ok()?;
        let sig = Signature::from_slice(&hex::decode(&p.signature).ok()?).ok()?;
        VerifyingKey::from_bytes(&pk).ok()?.verify_strict(&signing_bytes(m), &sig).ok()?;
        Some(())
    })().is_some();
    if !signature_valid { errors.push("SIGNATURE_INVALID".into()); }
    Report { valid: schema && file_match && chain_valid && signature_valid, file_match, chain_valid, signature_valid, errors }
}

#[wasm_bindgen]
pub struct FileHasher { hasher: blake3::Hasher, bytes: u64 }
#[wasm_bindgen]
impl FileHasher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self { hasher: blake3::Hasher::new(), bytes: 0 } }
    pub fn update(&mut self, bytes: &[u8]) { self.hasher.update(bytes); self.bytes += bytes.len() as u64; }
    pub fn finish(&self) -> String { self.hasher.finalize().to_hex().to_string() }
    pub fn verify(&self, json: &str) -> Result<String, JsValue> {
        if json.len() > 32 * 1024 * 1024 { return Err(JsValue::from_str("PROOF_TOO_LARGE")); }
        let proof: Proof = serde_json::from_str(json).map_err(|_| JsValue::from_str("INVALID_PROOF"))?;
        serde_json::to_string(&verify(&proof, &self.finish(), self.bytes)).map_err(|_| JsValue::from_str("INVALID_PROOF"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Proof {
        let key = SigningKey::from_bytes(&[7;32]);
        let mut records = vec![]; let mut head = genesis("fixture");
        for (seq, kind) in ["start", "edit", "save"].iter().enumerate() {
            let event = Event { seq: seq as u64, elapsed_ms: seq as u64*1000, kind: kind.to_string(), inserted: 5, deleted: 0, chars: 5, checkpoint: if *kind == "save" {digest(b"hello")} else {String::new()} };
            head = event_hash(&head, &event); records.push(Record{event,hash:head.clone()});
        }
        sign(Manifest { protocol: VERSION.into(),session_id:"fixture".into(),file_name:"hello.txt".into(),started_at:"2026-10-31T00:00:00Z".into(),source:"test".into(),event_count:3,chain_head:head,artifact_hash:digest(b"hello"),artifact_bytes:5,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),demo:true },records,&key)
    }
    #[test] fn valid_record_and_unicode_serialization() { let p=sample(); assert!(verify(&p,&digest(b"hello"),5).valid); let s=serde_json::to_string_pretty(&p).unwrap(); let p:Proof=serde_json::from_str(&s).unwrap(); assert!(verify(&p,&digest(b"hello"),5).valid); }
    #[test] fn replaced_file() { assert!(!verify(&sample(),&digest(b"world"),5).file_match); }
    #[test] fn edited_event() { let mut p=sample(); p.records[1].event.inserted+=1; assert!(!verify(&p,&digest(b"hello"),5).chain_valid); }
    #[test] fn deleted_tail() { let mut p=sample(); p.records.pop(); assert!(!verify(&p,&digest(b"hello"),5).valid); }
    #[test] fn rewritten_chain_cannot_reuse_signature() { let mut p=sample(); p.records[1].event.chars=9; let mut h=genesis(&p.manifest.session_id); for r in &mut p.records {h=event_hash(&h,&r.event);r.hash=h.clone();} p.manifest.chain_head=h; assert!(!verify(&p,&digest(b"hello"),5).signature_valid); }
    #[test] fn unknown_protocol() { let mut p=sample();p.manifest.protocol="workproof/999".into();assert!(!verify(&p,&digest(b"hello"),5).valid); }
    #[test] fn malformed_signature_never_panics() { let mut p=sample();p.signature="00".into();assert!(!verify(&p,&digest(b"hello"),5).signature_valid); }
    #[test] fn regressing_clock() { let mut p=sample();p.records[2].event.elapsed_ms=0;assert!(!verify(&p,&digest(b"hello"),5).chain_valid); }
    #[test] fn unsupported_time_assertion() { let mut p=sample();p.manifest.time_evidence="trusted".into();assert!(!verify(&p,&digest(b"hello"),5).valid); }
}
