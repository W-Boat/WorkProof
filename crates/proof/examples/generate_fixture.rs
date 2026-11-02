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
        let event=Event{seq:i,elapsed_ms:i*13700+(i/14)*41000,kind:kind.into(),inserted:ins,deleted:del,chars,checkpoint:if i==85{digest(content.as_bytes())}else{String::new()},metrics:std::collections::BTreeMap::from([("characters".into(),chars)])};
        head=event_hash(&head,&event);records.push(Record{event,hash:head.clone()});
    }
    let manifest=Manifest{protocol:VERSION.into(),session_id:id.into(),file_name:"essay.md".into(),started_at:"2026-10-31T09:00:00+08:00".into(),source:"synthetic-demo".into(),event_count:records.len() as u64,chain_head:head,artifact_hash:digest(content.as_bytes()),artifact_bytes:content.len() as u64,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),merkle_root:String::new(),demo:true};
    let proof=sign(manifest,records,&key);assert!(verify(&proof,&digest(content.as_bytes()),content.len() as u64).valid);
    std::fs::write(format!("{dir}/essay.md"),content).unwrap();std::fs::write(format!("{dir}/essay.md.wproof"),serde_json::to_string_pretty(&proof).unwrap()).unwrap();
    let selected=workproof_protocol::create_disclosure(&proof,&[5,20,40]).unwrap();
    std::fs::write(format!("{dir}/essay.md.selected.wproof"),serde_json::to_string_pretty(&selected).unwrap()).unwrap();
    generate_evolution_fixture(&dir);
}

fn generate_evolution_fixture(dir:&str){
    use workproof_protocol::evolution::{self,Node,NodeKind,Relation,Snapshot,Supplement};
    let content=b"Synthetic structure demo; not a Blender file.\n";
    let key=SigningKey::from_bytes(&[43;32]);let id="demo-evolution-001";
    let first=Snapshot{format:evolution::FORMAT.into(),session_id:id.into(),source:"synthetic-demo".into(),seq:1,event_kind:"mesh".into(),nodes:vec![
        Node{id:1,parent:None,order:0,kind:NodeKind::Object,relation:Relation::Root},
        Node{id:2,parent:None,order:1,kind:NodeKind::Object,relation:Relation::Root},
        Node{id:3,parent:Some(1),order:0,kind:NodeKind::Mesh,relation:Relation::Contains},
    ]};
    let mut second=first.clone();second.seq=2;second.nodes[2].parent=Some(2);
    let mut head=genesis(id);let mut records=vec![];
    for seq in 0..4u64{
        let (kind,checkpoint)=match seq{0=>("start",String::new()),1=>("mesh",evolution::checkpoint(&first).unwrap()),2=>("mesh",evolution::checkpoint(&second).unwrap()),_=>("save",digest(content))};
        let event=Event{seq,elapsed_ms:seq*1000,kind:kind.into(),inserted:0,deleted:0,chars:0,checkpoint,metrics:Default::default()};
        head=event_hash(&head,&event);records.push(Record{event,hash:head.clone()});
    }
    let proof=sign(Manifest{protocol:VERSION.into(),session_id:id.into(),source:"synthetic-demo".into(),file_name:"structure-demo.txt".into(),started_at:"2026-11-02T00:00:00Z".into(),event_count:4,chain_head:head,artifact_hash:digest(content),artifact_bytes:content.len() as u64,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),demo:true,merkle_root:String::new()},records,&key);
    let graph=Supplement{format:evolution::FORMAT.into(),snapshots:vec![first.clone(),second]};
    assert!(evolution::verify(&Evidence::Full(proof.clone()),&graph).valid);
    std::fs::write(format!("{dir}/structure-demo.txt"),content).unwrap();
    std::fs::write(format!("{dir}/structure-demo.txt.wproof"),serde_json::to_vec_pretty(&proof).unwrap()).unwrap();
    std::fs::write(format!("{dir}/structure-demo.wgraph"),serde_json::to_vec_pretty(&graph).unwrap()).unwrap();
    std::fs::write(format!("{dir}/structure-demo.selected.wproof"),serde_json::to_vec_pretty(&create_disclosure(&proof,&[1]).unwrap()).unwrap()).unwrap();
    std::fs::write(format!("{dir}/structure-demo.selected.wgraph"),serde_json::to_vec_pretty(&Supplement{format:evolution::FORMAT.into(),snapshots:vec![first]}).unwrap()).unwrap();
}
