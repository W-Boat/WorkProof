//! Optional graph supplements bind only to explicitly disclosed, verified event checkpoints.
//! They do not establish complete editing history, artifact identity or human authorship.
use crate::{Evidence,Event,inspect_certificate};
use serde::{Deserialize,Serialize};
use std::collections::{BTreeMap,BTreeSet};

pub const FORMAT:&str="workproof-evolution/1";
pub const MAX_SNAPSHOTS:usize=128;
pub const MAX_NODES:usize=10_000;
pub const MAX_TOTAL_NODES:usize=50_000;
pub const MAX_JSON_BYTES:usize=8*1024*1024;
pub const MAX_DEPTH:usize=256;
const MAX_ID:u64=9_007_199_254_740_991;

#[derive(Clone,Copy,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum NodeKind{Object,Group,Mesh,Layer,Modifier}
#[derive(Clone,Copy,Debug,Serialize,Deserialize,PartialEq,Eq,PartialOrd,Ord)]
#[serde(rename_all="snake_case")]
pub enum Relation{Root,Contains,Modifies}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Node{pub id:u64,pub parent:Option<u64>,pub order:u32,pub kind:NodeKind,pub relation:Relation}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot{
    pub format:String,pub session_id:String,pub source:String,pub seq:u64,pub event_kind:String,pub nodes:Vec<Node>,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Supplement{pub format:String,pub snapshots:Vec<Snapshot>}
#[derive(Debug,Serialize,Deserialize)]
pub struct EvolutionReport{
    pub protocol:String,pub valid:bool,pub certificate_valid:bool,pub artifact_checked:bool,
    pub complete_history_verified:bool,pub identity_verified:bool,pub scope:String,pub completeness:String,
    pub snapshots:Vec<Snapshot>,pub errors:Vec<String>,
}
fn graph_event(kind:&str)->bool{matches!(kind,"start"|"layer"|"mesh"|"modifier"|"resume")}
fn checked_nodes(snapshot:&Snapshot)->Result<BTreeMap<u64,&Node>,&'static str>{
    if snapshot.format!=FORMAT{return Err("EVOLUTION_SCHEMA_UNSUPPORTED");}
    if snapshot.session_id.is_empty()||snapshot.session_id.len()>128||snapshot.source.is_empty()||snapshot.source.len()>64||
        !snapshot.source.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-')||
        snapshot.seq>=crate::MAX_EVENTS as u64||!graph_event(&snapshot.event_kind){return Err("EVOLUTION_BINDING_INVALID");}
    if snapshot.nodes.len()>MAX_NODES{return Err("EVOLUTION_NODE_LIMIT");}
    let mut nodes=BTreeMap::new();let mut positions=BTreeSet::new();
    for node in &snapshot.nodes{
        if node.id==0||node.id>MAX_ID||node.order>=MAX_NODES as u32||nodes.insert(node.id,node).is_some(){return Err("EVOLUTION_NODE_INVALID");}
        if !positions.insert((node.parent,node.relation,node.order)){return Err("EVOLUTION_ORDER_DUPLICATE");}
        if node.parent.is_none()!=(node.relation==Relation::Root){return Err("EVOLUTION_RELATION_INVALID");}
    }
    for node in nodes.values(){
        if node.parent.is_some_and(|parent|!nodes.contains_key(&parent)){return Err("EVOLUTION_PARENT_MISSING");}
    }
    let mut resolved:BTreeMap<u64,usize>=BTreeMap::new();
    for id in nodes.keys(){
        let mut current=Some(*id);let mut path=Vec::new();let mut visiting=BTreeSet::new();
        let mut depth=0;
        while let Some(id)=current{
            if let Some(existing)=resolved.get(&id){depth=*existing;break;}
            if !visiting.insert(id){return Err("EVOLUTION_CYCLE");}
            path.push(id);
            if path.len()>MAX_DEPTH{return Err("EVOLUTION_DEPTH_LIMIT");}
            current=nodes.get(&id).ok_or("EVOLUTION_PARENT_MISSING")?.parent;
        }
        for id in path.into_iter().rev(){
            depth+=1;if depth>MAX_DEPTH{return Err("EVOLUTION_DEPTH_LIMIT");}
            resolved.insert(id,depth);
        }
    }
    Ok(nodes)
}
/// Versioned binary encoding: UTF-8 fields have u32 LE lengths; numbers are LE.
/// Nodes are sorted by ID. Enum tags below are stable protocol constants.
pub fn checkpoint(snapshot:&Snapshot)->Result<String,&'static str>{
    let nodes=checked_nodes(snapshot)?;
    let mut bytes=b"WorkProof:evolution:v1:blake3\0".to_vec();
    for field in [&snapshot.format,&snapshot.session_id,&snapshot.source,&snapshot.event_kind]{crate::field(&mut bytes,field);}
    bytes.extend_from_slice(&snapshot.seq.to_le_bytes());bytes.extend_from_slice(&(nodes.len() as u32).to_le_bytes());
    for node in nodes.values(){
        bytes.extend_from_slice(&node.id.to_le_bytes());
        bytes.push(u8::from(node.parent.is_some()));bytes.extend_from_slice(&node.parent.unwrap_or(0).to_le_bytes());
        bytes.extend_from_slice(&node.order.to_le_bytes());
        bytes.push(match node.kind{NodeKind::Object=>1,NodeKind::Group=>2,NodeKind::Mesh=>3,NodeKind::Layer=>4,NodeKind::Modifier=>5});
        bytes.push(match node.relation{Relation::Root=>1,Relation::Contains=>2,Relation::Modifies=>3});
    }
    Ok(crate::digest(&bytes))
}
pub fn verify(evidence:&Evidence,supplement:&Supplement)->EvolutionReport{
    let inspection=inspect_certificate(evidence);
    let mut report=EvolutionReport{protocol:FORMAT.into(),valid:false,certificate_valid:inspection.certificate_valid,
        artifact_checked:false,complete_history_verified:false,identity_verified:false,scope:inspection.scope,
        completeness:"disclosed_snapshots_only".into(),snapshots:Vec::new(),errors:Vec::new()};
    let reject=|mut report:EvolutionReport,code:&str|{report.errors.push(code.into());report};
    if !inspection.certificate_valid{return reject(report,"EVOLUTION_CERTIFICATE_INVALID");}
    if supplement.format!=FORMAT{return reject(report,"EVOLUTION_SCHEMA_UNSUPPORTED");}
    if supplement.snapshots.is_empty()||supplement.snapshots.len()>MAX_SNAPSHOTS||
        supplement.snapshots.iter().map(|s|s.nodes.len()).sum::<usize>()>MAX_TOTAL_NODES{return reject(report,"EVOLUTION_SNAPSHOT_LIMIT");}
    let (manifest,events):(_,Vec<&Event>)=match evidence{
        Evidence::Full(proof)=>(&proof.manifest,proof.records.iter().map(|r|&r.event).collect()),
        Evidence::Selective(proof)=>(&proof.manifest,proof.disclosed.iter().map(|r|&r.record.event).collect()),
    };
    let events:BTreeMap<_,_>=events.into_iter().map(|e|(e.seq,e)).collect();
    let mut previous=None;
    for snapshot in &supplement.snapshots{
        if snapshot.session_id!=manifest.session_id||snapshot.source!=manifest.source||previous.is_some_and(|seq|seq>=snapshot.seq){return reject(report,"EVOLUTION_BINDING_INVALID");}
        previous=Some(snapshot.seq);
        let Some(event)=events.get(&snapshot.seq)else{return reject(report,"EVOLUTION_EVENT_NOT_DISCLOSED");};
        if event.kind!=snapshot.event_kind||!graph_event(&event.kind){return reject(report,"EVOLUTION_EVENT_KIND_MISMATCH");}
        let hash=match checkpoint(snapshot){Ok(hash)=>hash,Err(code)=>return reject(report,code)};
        if hash!=event.checkpoint{return reject(report,"EVOLUTION_CHECKPOINT_MISMATCH");}
    }
    report.valid=true;report.snapshots=supplement.snapshots.clone();report
}
/// Byte cap precedes JSON parsing. No unverified nodes are reflected in rejected reports.
pub fn verify_json(evidence_json:&[u8],supplement_json:&[u8])->EvolutionReport{
    let rejected=|code:&str|EvolutionReport{protocol:FORMAT.into(),valid:false,certificate_valid:false,artifact_checked:false,
        complete_history_verified:false,identity_verified:false,scope:"unknown".into(),completeness:"disclosed_snapshots_only".into(),snapshots:Vec::new(),errors:vec![code.into()]};
    if evidence_json.len()>32*1024*1024||supplement_json.len()>MAX_JSON_BYTES{return rejected("EVOLUTION_INPUT_LIMIT");}
    let evidence=match serde_json::from_slice::<Evidence>(evidence_json){Ok(value)=>value,Err(_)=>return rejected("EVOLUTION_PROOF_INVALID")};
    // Verify the signature/chain or Merkle disclosure before parsing the graph.
    if !inspect_certificate(&evidence).certificate_valid{return rejected("EVOLUTION_CERTIFICATE_INVALID");}
    let supplement=match serde_json::from_slice(supplement_json){Ok(value)=>value,Err(_)=>return rejected("EVOLUTION_JSON_INVALID")};
    verify(&evidence,&supplement)
}

#[cfg(test)]mod tests{
    use super::*;
    use crate::{Record,Manifest,sign,genesis,event_hash,digest,create_disclosure,Proof,VERSION};
    use ed25519_dalek::SigningKey;
    fn snapshot()->Snapshot{Snapshot{format:FORMAT.into(),session_id:"evolution-fixture".into(),source:"blender".into(),seq:1,event_kind:"mesh".into(),nodes:vec![
        Node{id:1,parent:None,order:0,kind:NodeKind::Object,relation:Relation::Root},
        Node{id:2,parent:Some(1),order:0,kind:NodeKind::Mesh,relation:Relation::Contains},
        Node{id:3,parent:Some(1),order:0,kind:NodeKind::Modifier,relation:Relation::Modifies},
    ]}}
    fn fixture()->(Proof,Supplement){
        let snapshot=snapshot();let key=SigningKey::from_bytes(&[9;32]);let artifact=digest(b"graph fixture");
        let mut head=genesis(&snapshot.session_id);let mut records=vec![];
        for (seq,kind,checkpoint) in [(0,"start",String::new()),(1,"mesh",checkpoint(&snapshot).unwrap()),(2,"save",artifact.clone())]{
            let event=Event{seq,elapsed_ms:seq*100,kind:kind.into(),inserted:0,deleted:0,chars:0,checkpoint,metrics:Default::default()};
            head=event_hash(&head,&event);records.push(Record{event,hash:head.clone()});
        }
        let proof=sign(Manifest{protocol:VERSION.into(),session_id:snapshot.session_id.clone(),source:snapshot.source.clone(),file_name:"fixture.blend".into(),started_at:"2026-11-02T00:00:00Z".into(),event_count:3,chain_head:head,
            artifact_hash:artifact,artifact_bytes:13,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),demo:true,merkle_root:String::new()},records,&key);
        (proof,Supplement{format:FORMAT.into(),snapshots:vec![snapshot]})
    }
    #[test]fn canonical_graph_order_and_json_whitespace_do_not_change_commitment(){
        let (proof,mut supplement)=fixture();let before=checkpoint(&supplement.snapshots[0]).unwrap();
        supplement.snapshots[0].nodes.reverse();assert_eq!(before,checkpoint(&supplement.snapshots[0]).unwrap());
        let report=verify_json(&serde_json::to_vec(&proof).unwrap(),&serde_json::to_vec_pretty(&supplement).unwrap());
        assert!(report.valid&&report.certificate_valid);assert!(!report.artifact_checked&&!report.complete_history_verified&&!report.identity_verified);
        assert_eq!(report.completeness,"disclosed_snapshots_only");assert_eq!(report.snapshots.len(),1);
    }
    #[test]fn malformed_graphs_fail_with_no_reflected_nodes(){
        let (proof,supplement)=fixture();
        for mutation in 0..6{
            let mut changed=supplement.clone();let nodes=&mut changed.snapshots[0].nodes;
            match mutation{
                0=>nodes[1].parent=Some(999),
                1=>{nodes[0].parent=Some(2);nodes[0].relation=Relation::Contains;},
                2=>nodes[1].id=1,
                3=>{nodes[2].relation=Relation::Contains;},
                4=>nodes[1].id=MAX_ID+1,
                _=>nodes[1].relation=Relation::Root,
            }
            let report=verify(&Evidence::Full(proof.clone()),&changed);assert!(!report.valid);assert!(report.snapshots.is_empty());assert_eq!(report.errors.len(),1);
        }
    }
    #[test]fn source_session_sequence_event_kind_and_graph_changes_are_bound(){
        let (proof,supplement)=fixture();
        for mutation in 0..5{
            let mut changed=supplement.clone();let snapshot=&mut changed.snapshots[0];
            match mutation{0=>snapshot.source="photoshop".into(),1=>snapshot.session_id="other".into(),2=>snapshot.seq=0,3=>snapshot.event_kind="layer".into(),_=>snapshot.nodes[1].kind=NodeKind::Layer}
            assert!(!verify(&Evidence::Full(proof.clone()),&changed).valid);
        }
    }
    #[test]fn invalid_signature_or_chain_cannot_authorize_graph(){
        let (mut proof,supplement)=fixture();proof.records[1].event.checkpoint="00".repeat(32);
        let report=verify(&Evidence::Full(proof),&supplement);assert!(!report.certificate_valid);assert_eq!(report.errors,vec!["EVOLUTION_CERTIFICATE_INVALID"]);
    }
    #[test]fn selective_graphs_require_disclosed_authenticated_events(){
        let (proof,supplement)=fixture();
        let included=create_disclosure(&proof,&[1]).unwrap();assert!(verify(&Evidence::Selective(included),&supplement).valid);
        let hidden=create_disclosure(&proof,&[]).unwrap();let report=verify(&Evidence::Selective(hidden),&supplement);
        assert!(report.certificate_valid);assert!(!report.valid);assert_eq!(report.errors,vec!["EVOLUTION_EVENT_NOT_DISCLOSED"]);assert!(report.snapshots.is_empty());
    }
    #[test]fn rejects_unknown_fields_duplicate_snapshots_and_limits(){
        let (proof,supplement)=fixture();let bytes=serde_json::to_vec(&proof).unwrap();
        let mut value=serde_json::to_value(&supplement).unwrap();value["snapshots"][0]["nodes"][0]["name"]=serde_json::json!("private name");
        assert!(!verify_json(&bytes,&serde_json::to_vec(&value).unwrap()).valid);
        for field in ["kind","relation"]{
            let mut value=serde_json::to_value(&supplement).unwrap();value["snapshots"][0]["nodes"][0][field]=serde_json::json!("unknown-private-description");
            let report=verify_json(&bytes,&serde_json::to_vec(&value).unwrap());assert!(!report.valid);assert!(report.snapshots.is_empty());
        }
        let mut changed=supplement.clone();changed.snapshots.push(changed.snapshots[0].clone());assert!(!verify(&Evidence::Full(proof.clone()),&changed).valid);
        changed.snapshots=vec![snapshot();MAX_SNAPSHOTS+1];assert!(!verify(&Evidence::Full(proof),&changed).valid);
        assert_eq!(verify_json(&bytes,&vec![b' ';MAX_JSON_BYTES+1]).errors,vec!["EVOLUTION_INPUT_LIMIT"]);
    }
    #[test]fn deeply_nested_graphs_are_rejected_even_with_cached_ancestors(){
        let mut value=snapshot();value.nodes=(1..=MAX_DEPTH as u64+1).map(|id|Node{
            id,parent:if id==1{None}else{Some(id-1)},order:0,kind:NodeKind::Object,
            relation:if id==1{Relation::Root}else{Relation::Contains},
        }).collect();
        assert_eq!(checkpoint(&value).unwrap_err(),"EVOLUTION_DEPTH_LIMIT");
        value.nodes.pop();assert!(checkpoint(&value).is_ok());
    }
}
