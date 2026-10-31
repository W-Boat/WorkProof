use workproof_protocol::*;
use ed25519_dalek::SigningKey;
fn main(){
    let dir=std::env::args().nth(1).unwrap_or_else(||"apps/verifier/public/demo".into());std::fs::create_dir_all(&dir).unwrap();
    let content="# 让创作过程，有据可查\n\n这是一份 WorkProof 演示样本。\n它展示记录、修改和保存的过程，不用于证明真人创作。\n\n证据可以复核，隐私应被尊重。\n";
    let key=SigningKey::from_bytes(&[42;32]);let id="demo-open-process-001";
    let mut head=genesis(id);let mut records=vec![];let mut chars=0u64;let final_chars=content.encode_utf16().count() as u64;
    for i in 0..86u64 {
        let (kind,ins,del)=if i==0{("start",0,0)}else if i==85{("save",0,0)}else if i==84{("edit",final_chars.saturating_sub(chars),0)}else if i%13==0{("undo",0,1)}else if i%17==0{("save",0,0)}else{("edit",1,0)};
        chars=chars.saturating_add(ins).saturating_sub(del);
        let event=Event{seq:i,elapsed_ms:i*13700+(i/14)*41000,kind:kind.into(),inserted:ins,deleted:del,chars,checkpoint:if i==85{digest(content.as_bytes())}else{String::new()},metrics:Default::default()};
        head=event_hash(&head,&event);records.push(Record{event,hash:head.clone()});
    }
    let manifest=Manifest{protocol:VERSION.into(),session_id:id.into(),file_name:"essay.md".into(),started_at:"2026-10-31T09:00:00+08:00".into(),source:"synthetic-demo".into(),event_count:records.len() as u64,chain_head:head,artifact_hash:digest(content.as_bytes()),artifact_bytes:content.len() as u64,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),merkle_root:String::new(),demo:true};
    let proof=sign(manifest,records,&key);assert!(verify(&proof,&digest(content.as_bytes()),content.len() as u64).valid);
    std::fs::write(format!("{dir}/essay.md"),content).unwrap();std::fs::write(format!("{dir}/essay.md.wproof"),serde_json::to_string_pretty(&proof).unwrap()).unwrap();
    let selected=workproof_protocol::create_disclosure(&proof,&[5,20,40]).unwrap();
    std::fs::write(format!("{dir}/essay.md.selected.wproof"),serde_json::to_string_pretty(&selected).unwrap()).unwrap();
}
