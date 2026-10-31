use workproof_protocol::{Proof,verify};
use std::io::Read;
#[tokio::main(worker_threads = 2)]
async fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<String>=std::env::args().collect();
    if args.get(1).map(String::as_str)==Some("verify") {
        if args.len()!=4{return Err("Usage: workproof-engine verify ARTIFACT PROOF.wproof".into());}
        if std::fs::metadata(&args[3])?.len()>32*1024*1024{return Err("Proof exceeds 32 MiB".into());}
        let p:Proof=serde_json::from_slice(&std::fs::read(&args[3])?)?;
        let mut file=std::fs::File::open(&args[2])?;let mut hasher=blake3::Hasher::new();let mut buf=[0u8;65536];let mut length=0;
        loop{let n=file.read(&mut buf)?;if n==0{break;}hasher.update(&buf[..n]);length+=n as u64;}
        let report=verify(&p,&hasher.finalize().to_hex().to_string(),length);
        println!("{}",serde_json::to_string_pretty(&report)?);if !report.valid{std::process::exit(2);}return Ok(());
    }
    workproof_engine::run(43127).await
}
