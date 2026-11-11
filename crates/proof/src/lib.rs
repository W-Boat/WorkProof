//! Locally signed process records and selective inclusion, not proof of human authorship.
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
#[cfg(feature="wasm")]
use wasm_bindgen::prelude::*;

pub const VERSION: &str = "workproof/3";
pub const MAX_EVENTS: usize = 100_000;
pub mod merkle;
pub mod evolution;
pub mod behavior;
pub mod receipt;
pub use behavior::{assess_behavior,BehaviorAssessment};
pub use merkle::{create_disclosure, verify_disclosure, Disclosure};
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
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub metrics: std::collections::BTreeMap<String,u64>,
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub merkle_root: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proof { pub manifest: Manifest, pub records: Vec<Record>, pub signature: String }
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Evidence { Full(Proof), Selective(Disclosure) }
#[cfg_attr(feature="wasm",wasm_bindgen)]
pub fn behavior_json(proof_json:&str)->String{
    let assessment=if proof_json.len()>32*1024*1024{BehaviorAssessment::unavailable()}
        else{match serde_json::from_str::<Evidence>(proof_json){Ok(proof)=>assess_behavior(&proof),Err(_)=>BehaviorAssessment::unavailable()}};
    serde_json::to_string(&assessment).expect("bounded behavior assessment contains finite numeric values")
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    pub valid: bool,
    pub file_match: bool,
    pub chain_valid: bool,
    pub signature_valid: bool,
    pub merkle_valid: Option<bool>,
    pub scope: String,
    pub disclosed_events: u64,
    pub total_events: u64,
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
    field(&mut b, &e.kind); field(&mut b, &e.checkpoint);
    if !e.metrics.is_empty(){
        b.extend_from_slice(b"WorkProof:metrics:v2\0");
        b.extend_from_slice(&(e.metrics.len() as u32).to_le_bytes());
        for (key,value) in &e.metrics {field(&mut b,key);b.extend_from_slice(&value.to_le_bytes());}
    }
    digest(&b)
}
pub fn signing_bytes(m: &Manifest) -> Vec<u8> {
    let mut b = if m.protocol==VERSION {b"WorkProof:manifest:v3\0".to_vec()} else {b"WorkProof:manifest:v1\0".to_vec()};
    for s in [&m.protocol, &m.session_id, &m.file_name, &m.started_at, &m.source, &m.chain_head,
        &m.artifact_hash, &m.public_key, &m.identity, &m.time_evidence] { field(&mut b, s); }
    b.extend_from_slice(&m.event_count.to_le_bytes());
    b.extend_from_slice(&m.artifact_bytes.to_le_bytes()); b.push(u8::from(m.demo));
    if m.protocol==VERSION {field(&mut b,&m.merkle_root);}
    b
}
pub fn sign(mut manifest: Manifest, records: Vec<Record>, key: &SigningKey) -> Proof {
    if manifest.protocol==VERSION {manifest.merkle_root=merkle::root(&manifest.session_id,&records).unwrap_or_default();}
    let signature = hex::encode(key.sign(&signing_bytes(&manifest)).to_bytes());
    Proof { manifest, records, signature }
}
pub fn valid_hash(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
pub fn validate_event(e: &Event) -> bool {
    matches!(e.kind.as_str(), "start"|"edit"|"undo"|"redo"|"save"|"pause"|"resume"|"gap"|"stop"|"mesh"|"layer"|"modifier"|"viewport"|"interaction"|"format"|"layout")
    && e.seq < MAX_EVENTS as u64 && e.elapsed_ms <= 31_536_000_000
    && e.inserted <= 100_000_000 && e.deleted <= 100_000_000 && e.chars <= 100_000_000
    && (e.checkpoint.is_empty() || valid_hash(&e.checkpoint))
    && e.metrics.len()<=16 && e.metrics.iter().all(|(k,v)|matches!(k.as_str(),"vertices"|"edges"|"faces"|"objects"|"modifiers"|"layers"|"groups"|"visible_layers"|"paragraphs"|"characters"|"viewport_changes"|"slides"|"shapes"|"backspace"|"delete_forward"|"space"|"enter"|"copy"|"paste"|"cut"|"undo_commands"|"redo_commands"|"format_commands"|"cursor_moves"|"layout_changes"|"spaces_inserted"|"line_breaks_inserted"|"word_revision_tracking"|"word_revision_total"|"word_revision_insert"|"word_revision_delete"|"word_revision_format"|"word_revision_other")&&*v<=1_000_000_000)
}
pub fn verify(p: &Proof, artifact_hash: &str, artifact_bytes: u64) -> Report {
    let m = &p.manifest;
    let mut errors = vec![];
    let schema = supported_manifest(m);
    if !schema { errors.push("UNSUPPORTED_MANIFEST".into()); }
    let file_match = artifact_hash == m.artifact_hash && artifact_bytes == m.artifact_bytes;
    if !file_match { errors.push("FILE_MISMATCH".into()); }
    let mut prev = genesis(&m.session_id);
    let mut elapsed = 0;
    let mut chain_valid = !p.records.is_empty() && p.records.len() <= MAX_EVENTS && p.records.len() as u64 == m.event_count;
    for (i, r) in p.records.iter().enumerate().take(MAX_EVENTS + 1) {
        if !validate_event(&r.event) || (m.protocol=="workproof/1" && !r.event.metrics.is_empty()) || r.event.seq != i as u64 || r.event.elapsed_ms < elapsed
            || (i == 0 && r.event.kind != "start") { chain_valid = false; }
        let computed = event_hash(&prev, &r.event);
        if computed != r.hash { chain_valid = false; }
        prev = computed; elapsed = r.event.elapsed_ms;
    }
    if prev != m.chain_head { chain_valid = false; }
    // The exported artifact must be the final recorded save checkpoint.
    if !p.records.last().is_some_and(|r| r.event.kind == "save" && r.event.checkpoint == m.artifact_hash) { chain_valid = false; }
    if !chain_valid { errors.push("CHAIN_INVALID".into()); }
    let signature_valid = signature_valid(m,&p.signature);
    let merkle_valid = if m.protocol==VERSION {Some(merkle::root(&m.session_id,&p.records).is_some_and(|root|root==m.merkle_root))} else {None};
    if merkle_valid==Some(false){errors.push("MERKLE_ROOT_INVALID".into());}
    if !signature_valid { errors.push("SIGNATURE_INVALID".into()); }
    Report { valid: schema && file_match && chain_valid && signature_valid && merkle_valid!=Some(false), file_match, chain_valid, signature_valid,
        merkle_valid,scope:"full".into(),disclosed_events:p.records.len() as u64,total_events:m.event_count,errors }
}
fn supported_manifest(m:&Manifest)->bool{
    ((m.protocol==VERSION && valid_hash(&m.merkle_root)) ||
        (matches!(m.protocol.as_str(),"workproof/1"|"workproof/2") && m.merkle_root.is_empty()))
        && m.identity=="self-signed" && m.time_evidence=="none"
        && !m.session_id.is_empty() && m.session_id.len()<=128 && m.file_name.len()<=1024
        && m.started_at.len()<=64 && m.source.len()<=128 && valid_hash(&m.artifact_hash)
        && m.event_count>=2 && m.event_count<=MAX_EVENTS as u64
}
fn signature_valid(m:&Manifest,signature:&str)->bool{
    (|| {
        let pk: [u8;32] = hex::decode(&m.public_key).ok()?.try_into().ok()?;
        let sig = Signature::from_slice(&hex::decode(signature).ok()?).ok()?;
        VerifyingKey::from_bytes(&pk).ok()?.verify_strict(&signing_bytes(m), &sig).ok()?;
        Some(())
    })().is_some()
}
pub fn verify_evidence(p:&Evidence,artifact_hash:&str,artifact_bytes:u64)->Report{
    match p{Evidence::Full(p)=>verify(p,artifact_hash,artifact_bytes),Evidence::Selective(p)=>verify_disclosure(p,artifact_hash,artifact_bytes)}
}
/// Certificate-only inspection deliberately does not report an artifact/file match.
#[derive(Debug,Serialize,Deserialize)]
pub struct CertificateInspection{
    pub protocol:String,pub certificate_valid:bool,pub artifact_checked:bool,
    pub identity_verified:bool,pub time_verified:bool,
    pub signature_valid:bool,pub chain_valid:bool,pub merkle_valid:Option<bool>,
    pub scope:String,pub disclosed_events:u64,pub total_events:u64,pub errors:Vec<String>,
    pub manifest:Option<Manifest>,pub signature:Option<String>,
    #[serde(default,skip_serializing_if="std::collections::BTreeMap::is_empty")]
    pub actions:std::collections::BTreeMap<String,u64>,
}
impl CertificateInspection{
    pub fn rejected(code:&str)->Self{Self{protocol:"workproof-inspection/1".into(),certificate_valid:false,artifact_checked:false,identity_verified:false,time_verified:false,signature_valid:false,chain_valid:false,merkle_valid:None,scope:"unknown".into(),disclosed_events:0,total_events:0,errors:vec![code.into()],manifest:None,signature:None,actions:Default::default()}}
}
pub fn inspect_certificate(evidence:&Evidence)->CertificateInspection{
    let (m,signature)=match evidence{Evidence::Full(p)=>(&p.manifest,&p.signature),Evidence::Selective(p)=>(&p.manifest,&p.signature)};
    // Bound reflected metadata even on invalid inputs. No user-controlled megabyte fields in stdout.
    if !supported_manifest(m)||!valid_hash(&m.chain_head)||m.public_key.len()!=64||signature.len()!=128
        ||!m.public_key.bytes().all(|b|b.is_ascii_hexdigit())||!signature.bytes().all(|b|b.is_ascii_hexdigit()){
        return CertificateInspection::rejected("INVALID_MANIFEST");
    }
    // The claimed hash checks internal consistency only. The result never exposes file_match.
    let report=verify_evidence(evidence,&m.artifact_hash,m.artifact_bytes);
    let mut actions=std::collections::BTreeMap::new();
    if report.valid{
        let events:Vec<&Event>=match evidence{
            Evidence::Full(p)=>p.records.iter().map(|r|&r.event).collect(),
            Evidence::Selective(p)=>p.disclosed.iter().map(|r|&r.record.event).collect(),
        };
        for event in events{
            for (key,value) in &event.metrics{
                if matches!(key.as_str(),"backspace"|"delete_forward"|"space"|"enter"|"copy"|"paste"|"cut"|"undo_commands"|"redo_commands"|"format_commands"|"cursor_moves"|"spaces_inserted"|"line_breaks_inserted"){
                    *actions.entry(key.clone()).or_insert(0u64)+=*value;
                }
            }
            let key=match event.kind.as_str(){"format"=>Some("format_changes"),"layout"=>Some("layout_changes"),"undo"=>Some("undo_events"),"redo"=>Some("redo_events"),_=>None};
            if let Some(key)=key{*actions.entry(key.into()).or_insert(0)+=1;}
        }
    }
    CertificateInspection{protocol:"workproof-inspection/1".into(),certificate_valid:report.valid,artifact_checked:false,identity_verified:false,time_verified:false,
        signature_valid:report.signature_valid,chain_valid:report.chain_valid,merkle_valid:report.merkle_valid,
        scope:report.scope,disclosed_events:report.disclosed_events,total_events:report.total_events,errors:report.errors,
        manifest:Some(m.clone()),signature:report.signature_valid.then(||signature.clone()),actions}
}
pub fn inspect_certificate_json(json:&[u8])->CertificateInspection{
    if json.len()>32*1024*1024{return CertificateInspection::rejected("PROOF_TOO_LARGE");}
    match serde_json::from_slice::<Evidence>(json){Ok(proof)=>inspect_certificate(&proof),Err(_)=>CertificateInspection::rejected("INVALID_PROOF")}
}
#[cfg(test)]mod inspection_tests{
    use super::*;
    #[test]fn action_summary_requires_valid_records_and_respects_disclosure(){
        let mut full=tests::sample();full.records[1].event.metrics.insert("copy".into(),3);
        let mut head=genesis(&full.manifest.session_id);
        for record in &mut full.records{head=event_hash(&head,&record.event);record.hash=head.clone();}
        full.manifest.chain_head=head;
        let full=sign(full.manifest,full.records,&SigningKey::from_bytes(&[7;32]));
        assert_eq!(inspect_certificate(&Evidence::Full(full.clone())).actions.get("copy"),Some(&3));
        let hidden=create_disclosure(&full,&[]).unwrap();
        assert!(inspect_certificate(&Evidence::Selective(hidden)).actions.is_empty());
        let shared=create_disclosure(&full,&[1]).unwrap();
        assert_eq!(inspect_certificate(&Evidence::Selective(shared)).actions.get("copy"),Some(&3));
        let mut changed=full;changed.records[1].event.metrics.insert("copy".into(),999);
        let report=inspect_certificate(&Evidence::Full(changed));
        assert!(!report.certificate_valid&&report.actions.is_empty());
    }
    #[test]fn certificate_inspection_does_not_claim_to_check_the_artifact(){
        let full=tests::sample();let report=inspect_certificate(&Evidence::Full(full.clone()));
        assert!(report.certificate_valid&&report.signature_valid&&report.chain_valid);
        assert!(!report.artifact_checked&&!report.identity_verified&&!report.time_verified);
        let json=serde_json::to_value(report).unwrap();assert!(json.get("file_match").is_none());
        let partial=create_disclosure(&full,&[1]).unwrap();let report=inspect_certificate(&Evidence::Selective(partial));
        assert!(report.certificate_valid&&report.signature_valid);assert!(!report.chain_valid&&!report.artifact_checked);assert_eq!(report.scope,"selective");
    }
    #[test]fn modified_records_and_oversize_metadata_are_not_accepted(){
        let mut full=tests::sample();full.records[1].event.inserted+=1;
        let report=inspect_certificate(&Evidence::Full(full.clone()));assert!(!report.certificate_valid);assert!(!report.chain_valid);assert!(report.signature_valid);
        full.manifest.chain_head="private metadata".repeat(10000);
        let report=inspect_certificate(&Evidence::Full(full));assert!(report.manifest.is_none());assert!(!report.certificate_valid);assert!(serde_json::to_vec(&report).unwrap().len()<2048);
        assert!(!inspect_certificate_json(b"not JSON").certificate_valid);
    }
}
#[cfg(feature="wasm")]
#[wasm_bindgen]
pub fn create_disclosure_json(json:&str,indices:&str)->Result<String,JsValue>{
    if json.len()>32*1024*1024||indices.len()>16*1024{return Err(JsValue::from_str("PROOF_TOO_LARGE"));}
    let p:Proof=serde_json::from_str(json).map_err(|_|JsValue::from_str("FULL_PROOF_REQUIRED"))?;
    let selected:Vec<u64>=serde_json::from_str(indices).map_err(|_|JsValue::from_str("INVALID_SELECTION"))?;
    let proof=create_disclosure(&p,&selected).map_err(|e|JsValue::from_str(&e))?;
    serde_json::to_string_pretty(&proof).map_err(|_|JsValue::from_str("INVALID_PROOF"))
}

#[cfg(feature="wasm")]
#[wasm_bindgen]
pub fn verify_evolution_json(proof_json:&str,supplement_json:&str)->Result<String,JsValue>{
    serde_json::to_string(&evolution::verify_json(proof_json.as_bytes(),supplement_json.as_bytes()))
        .map_err(|_|JsValue::from_str("EVOLUTION_REPORT_INVALID"))
}

#[cfg(feature="wasm")]
#[wasm_bindgen]
pub fn verify_server_receipt(proof:&[u8],receipt:&[u8],issuer:&str,public_key:&str,now_ms:f64,max_lifetime_seconds:u32)->Result<String,JsValue>{
    if !now_ms.is_finite()||now_ms<0.0||now_ms.fract()!=0.0||now_ms>9_007_199_254_740_991.0||max_lifetime_seconds==0||max_lifetime_seconds>2678400||public_key.len()!=64{return Err(JsValue::from_str("INVALID_RECEIPT_POLICY"));}
    let bytes:[u8;32]=hex::decode(public_key).map_err(|_|JsValue::from_str("INVALID_TRUSTED_KEY"))?.try_into().map_err(|_|JsValue::from_str("INVALID_TRUSTED_KEY"))?;
    let key=VerifyingKey::from_bytes(&bytes).map_err(|_|JsValue::from_str("INVALID_TRUSTED_KEY"))?;
    let result=receipt::verify_receipt(proof,receipt,receipt::ReceiptPolicy{issuer_id:issuer,key:&key,now_ms:now_ms as u64,max_lifetime_ms:max_lifetime_seconds as u64*1000}).map_err(|e|JsValue::from_str(e))?;
    serde_json::to_string(&result).map_err(|_|JsValue::from_str("INVALID_RECEIPT_REPORT"))
}

#[cfg(feature="wasm")]
#[wasm_bindgen]
pub struct FileHasher { hasher: blake3::Hasher, bytes: u64 }
#[cfg(feature="wasm")]
#[wasm_bindgen]
impl FileHasher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self { hasher: blake3::Hasher::new(), bytes: 0 } }
    pub fn update(&mut self, bytes: &[u8]) { self.hasher.update(bytes); self.bytes += bytes.len() as u64; }
    pub fn finish(&self) -> String { self.hasher.finalize().to_hex().to_string() }
    pub fn verify(&self, json: &str) -> Result<String, JsValue> {
        if json.len() > 32 * 1024 * 1024 { return Err(JsValue::from_str("PROOF_TOO_LARGE")); }
        let proof: Evidence = serde_json::from_str(json).map_err(|_| JsValue::from_str("INVALID_PROOF"))?;
        serde_json::to_string(&verify_evidence(&proof, &self.finish(), self.bytes)).map_err(|_| JsValue::from_str("INVALID_PROOF"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(crate) fn sample() -> Proof {
        let key = SigningKey::from_bytes(&[7;32]);
        let mut records = vec![]; let mut head = genesis("fixture");
        for (seq, kind) in ["start", "edit", "save"].iter().enumerate() {
            let event = Event { seq: seq as u64, elapsed_ms: seq as u64*1000, kind: kind.to_string(), inserted: 5, deleted: 0, chars: 5, checkpoint: if *kind == "save" {digest(b"hello")} else {String::new()}, metrics:Default::default() };
            head = event_hash(&head, &event); records.push(Record{event,hash:head.clone()});
        }
        sign(Manifest { protocol: VERSION.into(),session_id:"fixture".into(),file_name:"hello.txt".into(),started_at:"2026-10-31T00:00:00Z".into(),source:"test".into(),event_count:3,chain_head:head,artifact_hash:digest(b"hello"),artifact_bytes:5,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),demo:true,merkle_root:String::new() },records,&key)
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
    #[test] fn signed_metrics_detect_tampering(){
        let mut p=sample();p.records[1].event.metrics.insert("vertices".into(),8);
        let mut head=genesis(&p.manifest.session_id);for r in &mut p.records{head=event_hash(&head,&r.event);r.hash=head.clone();}
        p.manifest.chain_head=head;
        p=sign(p.manifest,p.records,&SigningKey::from_bytes(&[7;32]));
        assert!(verify(&p,&digest(b"hello"),5).valid);
        p.records[1].event.metrics.insert("vertices".into(),9);
        assert!(!verify(&p,&digest(b"hello"),5).chain_valid);
    }
    #[test] fn legacy_v1_still_verifies(){
        let mut p=sample();p.manifest.protocol="workproof/1".into();p.manifest.merkle_root.clear();
        p=sign(p.manifest,p.records,&SigningKey::from_bytes(&[7;32]));assert!(verify(&p,&digest(b"hello"),5).valid);
    }
    #[test] fn powerpoint_counts_are_signed_and_bounded(){
        let mut p=sample();p.manifest.source="powerpoint".into();
        p.records[1].event.metrics.insert("slides".into(),3);
        p.records[1].event.metrics.insert("shapes".into(),12);
        assert!(validate_event(&p.records[1].event));
        let mut head=genesis(&p.manifest.session_id);
        for record in &mut p.records{head=event_hash(&head,&record.event);record.hash=head.clone();}
        p.manifest.chain_head=head;
        p=sign(p.manifest,p.records,&SigningKey::from_bytes(&[7;32]));
        assert!(verify(&p,&digest(b"hello"),5).valid);
        p.records[1].event.metrics.insert("shapes".into(),13);
        assert!(!verify(&p,&digest(b"hello"),5).chain_valid);
        p.records[1].event.metrics.insert("slides".into(),1_000_000_001);
        assert!(!validate_event(&p.records[1].event));
    }
    #[test] fn unknown_metrics_are_rejected(){let mut p=sample();p.records[1].event.metrics.insert("raw_content".into(),1);assert!(!verify(&p,&digest(b"hello"),5).valid);}
    #[test] fn legacy_v2_still_verifies_without_merkle_claims(){
        let mut p=sample();p.manifest.protocol="workproof/2".into();p.manifest.merkle_root.clear();
        p=sign(p.manifest,p.records,&SigningKey::from_bytes(&[7;32]));
        assert!(verify(&p,&digest(b"hello"),5).valid);assert_eq!(verify(&p,&digest(b"hello"),5).merkle_valid,None);
        let json=serde_json::to_string(&p).unwrap();assert!(!json.contains("merkle_root"));
        p.manifest.merkle_root="00".repeat(32);assert!(!verify(&p,&digest(b"hello"),5).valid);
    }
    #[test] fn v3_root_is_part_of_signature(){
        let mut p=sample();p.manifest.merkle_root="00".repeat(32);
        let report=verify(&p,&digest(b"hello"),5);assert!(!report.valid);assert!(!report.signature_valid);assert_eq!(report.merkle_valid,Some(false));
    }
    #[test]fn historical_v2_signature_from_prior_release_still_verifies(){
        let p:Proof=serde_json::from_str(include_str!("../tests/fixtures/v2-demo.wproof")).unwrap();
        assert_eq!(p.manifest.protocol,"workproof/2");assert!(p.manifest.merkle_root.is_empty());
        assert!(verify(&p,&p.manifest.artifact_hash,p.manifest.artifact_bytes).valid);
    }
    #[test]fn stripping_a_v3_root_cannot_downgrade_the_original_signature(){
        let mut p=sample();p.manifest.protocol="workproof/2".into();p.manifest.merkle_root.clear();
        let report=verify(&p,&digest(b"hello"),5);assert!(!report.valid);assert!(!report.signature_valid);
    }
}
