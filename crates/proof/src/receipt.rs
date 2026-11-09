//! Explicit-key server receipts. A receipt acknowledges bytes, not client provenance.
use ed25519_dalek::{Signature,Signer,SigningKey,VerifyingKey};
use serde::{Deserialize,Serialize};

const VERSION:&str="workproof-server-receipt/1";
const DOMAIN:&[u8]=b"WorkProof server receipt v1\0";
const MAX_RECEIPT:usize=16*1024;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptPayload{
    pub protocol:String,
    pub purpose:String,
    pub issuer_id:String,
    pub receipt_id:String,
    pub received_at_ms:u64,
    pub expires_at_ms:u64,
    pub evidence_digest:String,
    pub proof_signature:String,
    pub artifact_hash:String,
    pub session_id:String,
    pub scope:String,
    pub received_events:u64,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerReceipt{pub payload:ReceiptPayload,pub signature:String}

pub struct ReceiptContext{
    pub issuer_id:String,pub receipt_id:String,pub received_at_ms:u64,pub expires_at_ms:u64,
}
/// All trust inputs come from the verifier's configuration, never the receipt.
pub struct ReceiptPolicy<'a>{
    pub issuer_id:&'a str,pub key:&'a VerifyingKey,pub now_ms:u64,pub max_lifetime_ms:u64,
}
#[derive(Debug,Serialize)]
pub struct ReceiptVerification{
    pub receipt_verified:bool,pub issuer_key_matched:bool,pub received_scope:String,
    pub artifact_checked:bool,pub client_origin_verified:bool,pub collection_verified:bool,
    pub author_identity_verified:bool,pub rule_calibration_verified:bool,
}
fn shape(p:&ReceiptPayload)->bool{
    p.protocol==VERSION&&p.purpose=="server-received"
        &&!p.issuer_id.is_empty()&&p.issuer_id.len()<=128
        &&p.issuer_id.bytes().all(|b|b.is_ascii_alphanumeric()||b"._:-".contains(&b))
        &&p.receipt_id.len()==64&&p.receipt_id.bytes().all(|b|b.is_ascii_hexdigit())
        &&p.received_at_ms<p.expires_at_ms
        &&p.evidence_digest.len()==64&&p.artifact_hash.len()==64&&p.proof_signature.len()==128
        &&p.session_id.len()<=512&&matches!(p.scope.as_str(),"full"|"selective")
}
fn signing_bytes(p:&ReceiptPayload)->Result<Vec<u8>,&'static str>{
    if !shape(p){return Err("INVALID_RECEIPT_PAYLOAD");}
    let mut bytes=DOMAIN.to_vec();bytes.extend(serde_json::to_vec(p).map_err(|_|"INVALID_RECEIPT_PAYLOAD")?);Ok(bytes)
}
/// The server supplies its own receipt identifier and timestamps. Never use a
/// client-provided timestamp as the server's receiving time.
pub fn issue_receipt(evidence:&[u8],context:ReceiptContext,key:&SigningKey)->Result<ServerReceipt,&'static str>{
    let inspection=crate::inspect_certificate_json(evidence);
    if !inspection.certificate_valid{return Err("INVALID_EVIDENCE");}
    let manifest=inspection.manifest.ok_or("INVALID_EVIDENCE")?;
    let payload=ReceiptPayload{
        protocol:VERSION.into(),purpose:"server-received".into(),issuer_id:context.issuer_id,
        receipt_id:context.receipt_id,received_at_ms:context.received_at_ms,expires_at_ms:context.expires_at_ms,
        evidence_digest:crate::digest(evidence),proof_signature:inspection.signature.ok_or("INVALID_EVIDENCE")?,
        artifact_hash:manifest.artifact_hash,session_id:manifest.session_id,
        scope:inspection.scope,received_events:inspection.disclosed_events,
    };
    let signature=hex::encode(key.sign(&signing_bytes(&payload)?).to_bytes());
    Ok(ServerReceipt{payload,signature})
}
pub fn verify_receipt(evidence:&[u8],receipt_json:&[u8],policy:ReceiptPolicy<'_>)->Result<ReceiptVerification,&'static str>{
    if evidence.len()>32*1024*1024{return Err("EVIDENCE_TOO_LARGE");}
    if receipt_json.len()>MAX_RECEIPT{return Err("RECEIPT_TOO_LARGE");}
    let receipt:ServerReceipt=serde_json::from_slice(receipt_json).map_err(|_|"INVALID_RECEIPT")?;
    let p=&receipt.payload;let bytes=signing_bytes(p)?;
    if p.issuer_id!=policy.issuer_id{return Err("UNEXPECTED_ISSUER");}
    if policy.max_lifetime_ms==0||p.expires_at_ms-p.received_at_ms>policy.max_lifetime_ms
        ||policy.now_ms<p.received_at_ms||policy.now_ms>=p.expires_at_ms{return Err("RECEIPT_OUTSIDE_TIME_POLICY");}
    if receipt.signature.len()!=128{return Err("INVALID_RECEIPT_SIGNATURE");}
    let raw=hex::decode(&receipt.signature).map_err(|_|"INVALID_RECEIPT_SIGNATURE")?;
    let signature=Signature::from_slice(&raw).map_err(|_|"INVALID_RECEIPT_SIGNATURE")?;
    policy.key.verify_strict(&bytes,&signature).map_err(|_|"INVALID_RECEIPT_SIGNATURE")?;
    if p.evidence_digest!=crate::digest(evidence){return Err("EVIDENCE_MISMATCH");}
    let inspection=crate::inspect_certificate_json(evidence);
    if !inspection.certificate_valid{return Err("INVALID_EVIDENCE");}
    let manifest=inspection.manifest.ok_or("INVALID_EVIDENCE")?;
    if inspection.signature.as_deref()!=Some(p.proof_signature.as_str())||manifest.artifact_hash!=p.artifact_hash
        ||manifest.session_id!=p.session_id||inspection.scope!=p.scope||inspection.disclosed_events!=p.received_events{return Err("EVIDENCE_MISMATCH");}
    Ok(ReceiptVerification{receipt_verified:true,issuer_key_matched:true,received_scope:p.scope.clone(),
        artifact_checked:false,client_origin_verified:false,collection_verified:false,
        author_identity_verified:false,rule_calibration_verified:false})
}

#[cfg(test)]mod tests{
    use super::*;
    fn context()->ReceiptContext{ReceiptContext{issuer_id:"institution-test".into(),receipt_id:"ab".repeat(32),received_at_ms:1000,expires_at_ms:2000}}
    fn policy(key:&VerifyingKey,now_ms:u64)->ReceiptPolicy<'_>{ReceiptPolicy{issuer_id:"institution-test",key,now_ms,max_lifetime_ms:1000}}
    fn evidence()->Vec<u8>{serde_json::to_vec(&crate::tests::sample()).unwrap()}
    #[test]fn explicit_trust_and_honest_scope(){
        let evidence=evidence();let key=SigningKey::from_bytes(&[42;32]);let public=key.verifying_key();
        let receipt=issue_receipt(&evidence,context(),&key).unwrap();let json=serde_json::to_vec(&receipt).unwrap();
        let result=verify_receipt(&evidence,&json,policy(&public,1500)).unwrap();
        assert!(result.receipt_verified&&result.issuer_key_matched);assert_eq!(result.received_scope,"full");
        assert!(!result.artifact_checked&&!result.client_origin_verified&&!result.collection_verified&&!result.author_identity_verified&&!result.rule_calibration_verified);
        let wrong=SigningKey::from_bytes(&[43;32]).verifying_key();assert!(verify_receipt(&evidence,&json,policy(&wrong,1500)).is_err());
        assert!(verify_receipt(&evidence,&json,ReceiptPolicy{issuer_id:"official-name",..policy(&public,1500)}).is_err());
    }
    #[test]fn receipt_tampering_and_time_boundaries(){
        let evidence=evidence();let key=SigningKey::from_bytes(&[42;32]);let public=key.verifying_key();let receipt=issue_receipt(&evidence,context(),&key).unwrap();let json=serde_json::to_vec(&receipt).unwrap();
        for now in [0,999,2000,u64::MAX]{assert!(verify_receipt(&evidence,&json,policy(&public,now)).is_err());}
        assert!(verify_receipt(&evidence,&json,ReceiptPolicy{max_lifetime_ms:999,..policy(&public,1500)}).is_err());
        let mut changed=receipt;changed.payload.received_at_ms=1100;assert!(verify_receipt(&evidence,&serde_json::to_vec(&changed).unwrap(),policy(&public,1500)).is_err());
    }
    #[test]fn selective_receipt_cannot_claim_the_full_submission(){
        let proof=crate::tests::sample();
        let full=serde_json::to_vec(&proof).unwrap();
        let selected=serde_json::to_vec(&crate::create_disclosure(&proof,&[0,2]).unwrap()).unwrap();
        let key=SigningKey::from_bytes(&[42;32]);let public=key.verifying_key();
        let full_receipt=serde_json::to_vec(&issue_receipt(&full,context(),&key).unwrap()).unwrap();
        assert!(verify_receipt(&selected,&full_receipt,policy(&public,1500)).is_err());
        let receipt=issue_receipt(&selected,context(),&key).unwrap();
        assert_eq!(receipt.payload.scope,"selective");assert_eq!(receipt.payload.received_events,2);
        let json=serde_json::to_vec(&receipt).unwrap();
        assert!(verify_receipt(&selected,&json,policy(&public,1500)).unwrap().receipt_verified);
        assert!(verify_receipt(&full,&json,policy(&public,1500)).is_err());
    }
    #[test]fn exact_bytes_invalid_evidence_and_parser_boundaries(){
        let evidence=evidence();let key=SigningKey::from_bytes(&[42;32]);let public=key.verifying_key();let receipt=issue_receipt(&evidence,context(),&key).unwrap();let json=serde_json::to_vec(&receipt).unwrap();
        let mut formatted=evidence.clone();formatted.push(b' ');assert!(crate::inspect_certificate_json(&formatted).certificate_valid);assert!(verify_receipt(&formatted,&json,policy(&public,1500)).is_err());
        assert!(issue_receipt(b"{}",context(),&key).is_err());assert!(verify_receipt(&evidence,&vec![0;MAX_RECEIPT+1],policy(&public,1500)).is_err());
        let mut unknown:serde_json::Value=serde_json::from_slice(&json).unwrap();unknown["embedded_trust_key"]=serde_json::json!(hex::encode(public.to_bytes()));assert!(verify_receipt(&evidence,&serde_json::to_vec(&unknown).unwrap(),policy(&public,1500)).is_err());
        let mut upgrade=receipt;upgrade.payload.purpose="official-client-generated".into();assert!(verify_receipt(&evidence,&serde_json::to_vec(&upgrade).unwrap(),policy(&public,1500)).is_err());
    }
}
