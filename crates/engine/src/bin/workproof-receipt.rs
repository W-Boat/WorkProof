//! Explicitly invoked server utility. Never starts a collector or creates keys.
use std::{fs,io::{Read,Write},path::Path,time::{SystemTime,UNIX_EPOCH}};
use ed25519_dalek::{SigningKey,VerifyingKey};
use workproof_protocol::receipt::{issue_receipt,verify_receipt,ReceiptContext,ReceiptPolicy};
type Error=Box<dyn std::error::Error>;
fn read_bounded(source:impl Read,limit:u64)->Result<Vec<u8>,Error>{let mut bytes=Vec::new();source.take(limit+1).read_to_end(&mut bytes)?;if bytes.len() as u64>limit{return Err("INPUT_TOO_LARGE".into());}Ok(bytes)}
fn bounded(path:&Path,limit:u64)->Result<Vec<u8>,Error>{read_bounded(fs::File::open(path)?,limit)}
fn key(path:&Path)->Result<[u8;32],Error>{
    if !path.is_absolute(){return Err("KEY_PATH_MUST_BE_ABSOLUTE".into());}
    let bytes=bounded(path,128)?;let text=std::str::from_utf8(&bytes).map_err(|_|"INVALID_KEY_FILE")?.trim();
    if text.len()!=64{return Err("INVALID_KEY_FILE".into());}
    hex::decode(text).map_err(|_|"INVALID_KEY_FILE")?.try_into().map_err(|_|"INVALID_KEY_FILE".into())
}
fn lifetime(value:&std::ffi::OsStr)->Result<u64,Error>{
    let seconds=value.to_str().ok_or("INVALID_LIFETIME")?.parse::<u64>().map_err(|_|"INVALID_LIFETIME")?;
    if seconds==0||seconds>31*24*60*60{return Err("LIFETIME_MUST_BE_1_TO_2678400_SECONDS".into());}Ok(seconds*1000)
}
fn main()->Result<(),Error>{
    let args:Vec<_>=std::env::args_os().collect();let mode=args.get(1).and_then(|v|v.to_str()).unwrap_or("");
    let stdio=mode=="issue-stdin";
    if !(stdio&&args.len()==5||matches!(mode,"issue"|"verify")&&args.len()==7){return Err("Usage: workproof-receipt issue PROOF OUTPUT ISSUER_ID TTL_SECONDS ABSOLUTE_PRIVATE_SEED_HEX_FILE | issue-stdin ISSUER_ID TTL_SECONDS ABSOLUTE_PRIVATE_SEED_HEX_FILE < PROOF | verify PROOF RECEIPT ISSUER_ID MAX_LIFETIME_SECONDS ABSOLUTE_PUBLIC_KEY_HEX_FILE".into());}
    let proof=if stdio{read_bounded(std::io::stdin().lock(),32*1024*1024)?}else{bounded(Path::new(&args[2]),32*1024*1024)?};
    let issuer=args[if stdio{2}else{4}].to_str().ok_or("INVALID_ISSUER")?;
    let lifetime=lifetime(&args[if stdio{3}else{5}])?;
    let now:u64=SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis().try_into().map_err(|_|"INVALID_SYSTEM_CLOCK")?;
    if mode!="verify"{
        let signing=SigningKey::from_bytes(&key(Path::new(&args[if stdio{4}else{6}]))?);
        let mut random=[0u8;32];use rand::RngCore;rand::thread_rng().fill_bytes(&mut random);
        let receipt=issue_receipt(&proof,ReceiptContext{issuer_id:issuer.into(),receipt_id:hex::encode(random),received_at_ms:now,expires_at_ms:now.checked_add(lifetime).ok_or("INVALID_SYSTEM_CLOCK")?},&signing)?;
        let bytes=serde_json::to_vec_pretty(&receipt)?;
        if stdio{let mut output=std::io::stdout().lock();output.write_all(&bytes)?;output.write_all(b"\n")?;}
        else{
            let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&args[3])?;output.write_all(&bytes)?;output.sync_all()?;
            println!("{}",serde_json::json!({"protocol":"workproof-receipt-cli/1","receipt_created":true,"network_used":false,"client_origin_verified":false,"artifact_checked":false}));
        }
    }else{
        let public=VerifyingKey::from_bytes(&key(Path::new(&args[6]))?).map_err(|_|"INVALID_PUBLIC_KEY")?;
        let receipt=bounded(Path::new(&args[3]),16*1024)?;
        let result=verify_receipt(&proof,&receipt,ReceiptPolicy{issuer_id:issuer,key:&public,now_ms:now,max_lifetime_ms:lifetime})?;
        println!("{}",serde_json::to_string(&result)?);
    }
    Ok(())
}
