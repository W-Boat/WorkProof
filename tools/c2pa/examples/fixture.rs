//! Synthetic CI fixture only; never use its fixed key as a user identity.
use workproof_protocol::*;
use ed25519_dalek::SigningKey;
fn main(){
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(),Ok("true"));
    let args:Vec<String>=std::env::args().collect();let png=std::fs::read(&args[1]).unwrap();let dir=std::path::Path::new(&args[2]);
    let key=SigningKey::from_bytes(&[61;32]);let id="synthetic-c2pa-demo";
    let mut head=genesis(id);let mut records=vec![];
    for (seq,kind) in ["start","edit","edit","edit","save"].iter().enumerate(){
        let event=Event{seq:seq as u64,elapsed_ms:seq as u64*1000,kind:kind.to_string(),inserted:0,deleted:0,chars:0,checkpoint:if *kind=="save"{digest(&png)}else{String::new()},metrics:Default::default()};
        head=event_hash(&head,&event);records.push(Record{event,hash:head.clone()});
    }
    let manifest=Manifest{protocol:VERSION.into(),session_id:id.into(),file_name:"synthetic.png".into(),started_at:"2026-11-01T00:00:00Z".into(),source:"synthetic-ci".into(),event_count:5,chain_head:head,artifact_hash:digest(&png),artifact_bytes:png.len() as u64,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),demo:true,merkle_root:String::new()};
    let proof=sign(manifest,records,&key);assert!(verify(&proof,&digest(&png),png.len() as u64).valid);
    std::fs::write(dir.join("full.wproof"),serde_json::to_string_pretty(&proof).unwrap()).unwrap();
    let selected=create_disclosure(&proof,&[2]).unwrap();std::fs::write(dir.join("selected.wproof"),serde_json::to_string_pretty(&selected).unwrap()).unwrap();
}
