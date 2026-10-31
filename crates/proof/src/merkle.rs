//! Domain-separated BLAKE3 tree. Unpaired subtrees are promoted without duplication.
//! Disclosure proves inclusion in a signed commitment, not completeness of hidden records.
use super::*;
use std::collections::BTreeSet;

pub const FORMAT:&str="workproof/disclosure/1";
pub const MAX_DISCLOSED:usize=1024;
const MAX_DEPTH:usize=17; // ceil(log2(MAX_EVENTS))
type Hash=[u8;32];

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Included {pub record:Record,pub siblings:Vec<String>}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Disclosure {
    pub format:String,
    pub manifest:Manifest,
    pub disclosed:Vec<Included>,
    pub signature:String,
}
fn leaf(session:&str,record:&Record)->Hash{
    let mut bytes=b"WorkProof:merkle-leaf:v3\0".to_vec();
    field(&mut bytes,session);field(&mut bytes,&record.hash);
    field(&mut bytes,&event_hash("",&record.event));
    *blake3::hash(&bytes).as_bytes()
}
fn parent(left:&Hash,right:&Hash)->Hash{
    let mut hasher=blake3::Hasher::new();
    hasher.update(b"WorkProof:merkle-node:v3\0");hasher.update(left);hasher.update(right);
    *hasher.finalize().as_bytes()
}
struct Tree {levels:Vec<Vec<Hash>>}
impl Tree {
    fn new(session:&str,records:&[Record])->Option<Self>{
        if records.is_empty()||records.len()>MAX_EVENTS{return None;}
        let mut levels=vec![records.iter().map(|r|leaf(session,r)).collect::<Vec<_>>()];
        while levels.last()?.len()>1{
            let next=levels.last()?.chunks(2).map(|pair|if pair.len()==2{parent(&pair[0],&pair[1])}else{pair[0]}).collect();
            levels.push(next);
        }
        Some(Self{levels})
    }
    fn root(&self)->String{hex::encode(self.levels.last().expect("nonempty tree")[0])}
    fn path(&self,mut index:usize)->Vec<String>{
        let mut result=vec![];
        for level in &self.levels[..self.levels.len()-1]{
            if let Some(sibling)=level.get(index^1){result.push(hex::encode(sibling));}
            index/=2;
        }
        result
    }
}
pub fn root(session:&str,records:&[Record])->Option<String>{Tree::new(session,records).map(|tree|tree.root())}
fn inclusion(session:&str,entry:&Included,count:u64,expected:&str)->bool{
    if count==0||count>MAX_EVENTS as u64||entry.record.event.seq>=count||entry.siblings.len()>MAX_DEPTH{return false;}
    let mut value=leaf(session,&entry.record);
    let mut index=entry.record.event.seq;let mut width=count;let mut siblings=entry.siblings.iter();
    while width>1{
        if index%2==1||index+1<width{
            let Some(encoded)=siblings.next() else{return false;};
            if !valid_hash(encoded){return false;}
            let Ok(bytes)=hex::decode(encoded) else{return false;};
            let Ok(sibling)=Hash::try_from(bytes) else{return false;};
            value=if index%2==1{parent(&sibling,&value)}else{parent(&value,&sibling)};
        }
        index/=2;width=width.div_ceil(2);
    }
    siblings.next().is_none()&&hex::encode(value)==expected
}
pub fn create_disclosure(proof:&Proof,indices:&[u64])->Result<Disclosure,String>{
    if proof.manifest.protocol!=VERSION{return Err("MERKLE_PROOF_V3_REQUIRED".into());}
    if indices.len()>MAX_DISCLOSED{return Err("SELECTION_TOO_LARGE".into());}
    let m=&proof.manifest;
    if !verify(proof,&m.artifact_hash,m.artifact_bytes).valid{return Err("INVALID_FULL_PROOF".into());}
    let mut selected=BTreeSet::from([0,m.event_count-1]);
    for &index in indices{
        if index>=m.event_count{return Err("SELECTION_OUT_OF_RANGE".into());}
        selected.insert(index);
    }
    if selected.len()>MAX_DISCLOSED{return Err("SELECTION_TOO_LARGE".into());}
    let tree=Tree::new(&m.session_id,&proof.records).ok_or("INVALID_FULL_PROOF")?;
    let disclosed=selected.into_iter().map(|index|Included{record:proof.records[index as usize].clone(),siblings:tree.path(index as usize)}).collect();
    Ok(Disclosure{format:FORMAT.into(),manifest:m.clone(),signature:proof.signature.clone(),disclosed})
}
pub fn verify_disclosure(proof:&Disclosure,artifact_hash:&str,artifact_bytes:u64)->Report{
    let m=&proof.manifest;let mut errors=vec![];
    let schema=proof.format==FORMAT&&m.protocol==VERSION&&supported_manifest(m);
    if !schema{errors.push("UNSUPPORTED_DISCLOSURE".into());}
    let file_match=artifact_hash==m.artifact_hash&&artifact_bytes==m.artifact_bytes;
    if !file_match{errors.push("FILE_MISMATCH".into());}
    let signature_valid=signature_valid(m,&proof.signature);
    if !signature_valid{errors.push("SIGNATURE_INVALID".into());}
    let entries=&proof.disclosed;
    let mut valid=entries.len()>=2&&entries.len()<=MAX_DISCLOSED;
    let first=entries.first().map(|e|&e.record);
    let last=entries.last().map(|e|&e.record);
    valid &= first.is_some_and(|r|r.event.seq==0&&r.event.kind=="start"&&r.hash==event_hash(&genesis(&m.session_id),&r.event));
    valid &= last.is_some_and(|r|r.event.seq.checked_add(1)==Some(m.event_count)&&r.event.kind=="save"&&r.event.checkpoint==m.artifact_hash&&r.hash==m.chain_head);
    for (index,entry) in entries.iter().take(MAX_DISCLOSED+1).enumerate(){
        valid &= validate_event(&entry.record.event)&&valid_hash(&entry.record.hash)&&inclusion(&m.session_id,entry,m.event_count,&m.merkle_root);
        if index>0{
            let before=&entries[index-1].record;let current=&entry.record;
            valid &= before.event.seq<current.event.seq&&before.event.elapsed_ms<=current.event.elapsed_ms;
            if before.event.seq.checked_add(1)==Some(current.event.seq){valid &= event_hash(&before.hash,&current.event)==current.hash;}
        }
    }
    if !valid{errors.push("DISCLOSURE_INVALID".into());}
    Report{valid:schema&&file_match&&signature_valid&&valid,file_match,chain_valid:false,signature_valid,merkle_valid:Some(valid),
        scope:"selective".into(),disclosed_events:entries.len() as u64,total_events:m.event_count,errors}
}

#[cfg(test)]
mod tests{
    use super::*;
    fn proof(count:usize)->Proof{
        let mut p=crate::tests::sample();let key=SigningKey::from_bytes(&[7;32]);
        let mut previous=genesis(&p.manifest.session_id);
        p.records=(0..count).map(|i|{
            let event=Event{seq:i as u64,elapsed_ms:i as u64*1000,kind:if i==0{"start"}else if i+1==count{"save"}else{"edit"}.into(),
                inserted:1,deleted:0,chars:i as u64,checkpoint:if i+1==count{p.manifest.artifact_hash.clone()}else{String::new()},metrics:Default::default()};
            previous=event_hash(&previous,&event);Record{event,hash:previous.clone()}
        }).collect();
        p.manifest.event_count=count as u64;p.manifest.chain_head=previous;
        sign(p.manifest,p.records,&key)
    }
    fn valid(p:&Disclosure)->bool{verify_disclosure(p,&digest(b"hello"),5).valid}
    // Independent recursive shape oracle; particularly exercise promoted odd subtrees.
    fn recursive(leaves:&[Hash])->Hash{
        if leaves.len()==1{return leaves[0];}
        let split=leaves.len().next_power_of_two()/2;
        parent(&recursive(&leaves[..split]),&recursive(&leaves[split..]))
    }
    #[test]fn every_position_in_odd_and_power_of_two_trees(){
        for count in 2..70{
            let p=proof(count);let tree=Tree::new(&p.manifest.session_id,&p.records).unwrap();
            let leaves:Vec<_>=p.records.iter().map(|r|leaf(&p.manifest.session_id,r)).collect();
            assert_eq!(tree.root(),hex::encode(recursive(&leaves)));
            for i in 0..count{let d=create_disclosure(&p,&[i as u64]).unwrap();assert!(valid(&d),"count={count},position={i}");assert!(!verify_disclosure(&d,&digest(b"hello"),5).chain_valid);}
        }
    }
    #[test]fn tampering_reordering_duplicates_paths_and_boundaries_are_rejected(){
        let p=proof(17);let d=create_disclosure(&p,&[3,6,10]).unwrap();assert!(valid(&d));
        let mut bad=d.clone();bad.disclosed[1].record.event.chars+=1;assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed[1].siblings[0]="00".repeat(32);assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed[1].siblings.push("00".repeat(32));assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed[1].siblings.pop();assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed.swap(1,2);assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed.insert(1,bad.disclosed[1].clone());assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed.remove(0);assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed.pop();assert!(!valid(&bad));
        let mut bad=d.clone();bad.manifest.event_count+=1;assert!(!valid(&bad));
        let mut bad=d.clone();bad.manifest.session_id.push('x');assert!(!valid(&bad));
        assert!(!verify_disclosure(&d,&digest(b"wrong"),5).valid);assert!(!verify_disclosure(&d,&digest(b"hello"),6).valid);
    }
    #[test]fn selection_is_bounded_deduplicated_and_does_not_resign(){
        let p=proof(20);let d=create_disclosure(&p,&[12,3,3]).unwrap();
        assert_eq!(d.disclosed.iter().map(|e|e.record.event.seq).collect::<Vec<_>>(),vec![0,3,12,19]);
        assert_eq!(d.signature,p.signature);assert_eq!(d.manifest.merkle_root,p.manifest.merkle_root);
        assert!(create_disclosure(&p,&[20]).is_err());assert!(create_disclosure(&p,&vec![0;MAX_DISCLOSED+1]).is_err());
        let mut old=p;old.manifest.protocol="workproof/2".into();assert!(create_disclosure(&old,&[]).is_err());
    }
    #[test]fn schema_and_leaf_positions_are_committed(){
        let p=proof(4);let d=create_disclosure(&p,&[1]).unwrap();
        let mut bad=d.clone();bad.format="workproof/disclosure/999".into();assert!(!valid(&bad));
        let mut bad=d.clone();bad.disclosed[1].record.event.seq=2;assert!(!valid(&bad));
        let mut bad=d.clone();bad.manifest.merkle_root="00".repeat(32);assert!(!valid(&bad));
        let mut bad=d;bad.signature="00".into();assert!(!valid(&bad));
    }
    #[test]fn maximum_tree_depth_and_disclosure_limit(){
        let p=proof(MAX_EVENTS);let d=create_disclosure(&p,&[1,65_535,99_998]).unwrap();assert!(valid(&d));
        assert!(d.disclosed.iter().all(|e|e.siblings.len()<=MAX_DEPTH));
        let selected:Vec<u64>=(1..MAX_DISCLOSED as u64).collect();
        assert!(create_disclosure(&p,&selected).is_err(),"Mandatory boundaries count toward the disclosure limit");
        assert!(root("empty",&[]).is_none());
    }
}
