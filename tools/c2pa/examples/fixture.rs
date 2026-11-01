//! Synthetic CI fixture only; never use its fixed key as a user identity.
use workproof_protocol::*;
use ed25519_dalek::SigningKey;
fn main(){
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(),Ok("true"));
    let args:Vec<String>=std::env::args().collect();let png=std::fs::read(&args[1]).unwrap();let dir=std::path::Path::new(&args[2]);
    let key=SigningKey::from_bytes(&[61;32]);let id="synthetic-c2pa-demo";
    let mut head=genesis(id);let mut records=vec![];
    let count:usize=args.get(3).map(|v|v.parse().unwrap()).unwrap_or(5);assert!((5..=10000).contains(&count));
    for seq in 0..count {
        let kind=if seq==0{"start"}else if seq==count-1{"save"}else{"edit"};
        let event=Event{seq:seq as u64,elapsed_ms:seq as u64*1000,kind:kind.to_string(),inserted:0,deleted:0,chars:0,checkpoint:if kind=="save"{digest(&png)}else{String::new()},metrics:Default::default()};
        head=event_hash(&head,&event);records.push(Record{event,hash:head.clone()});
    }
    let manifest=Manifest{protocol:VERSION.into(),session_id:id.into(),file_name:std::path::Path::new(&args[1]).file_name().unwrap().to_string_lossy().into_owned(),started_at:"2026-11-01T00:00:00Z".into(),source:"synthetic-ci".into(),event_count:count as u64,chain_head:head,artifact_hash:digest(&png),artifact_bytes:png.len() as u64,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),demo:true,merkle_root:String::new()};
    let proof=sign(manifest,records,&key);assert!(verify(&proof,&digest(&png),png.len() as u64).valid);
    std::fs::write(dir.join("full.wproof"),serde_json::to_string_pretty(&proof).unwrap()).unwrap();
    let selected=create_disclosure(&proof,&[2]).unwrap();std::fs::write(dir.join("selected.wproof"),serde_json::to_string_pretty(&selected).unwrap()).unwrap();
}
