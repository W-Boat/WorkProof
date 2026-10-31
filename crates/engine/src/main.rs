use workproof_protocol::{Proof,digest,verify};
#[tokio::main]
async fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<String>=std::env::args().collect();
    if args.get(1).map(String::as_str)==Some("verify") {
        if args.len()!=4{return Err("Usage: workproof-engine verify ARTIFACT PROOF.wproof".into());}
        let p:Proof=serde_json::from_slice(&std::fs::read(&args[3])?)?;
        let bytes=std::fs::read(&args[2])?;let report=verify(&p,&digest(&bytes),bytes.len() as u64);
        println!("{}",serde_json::to_string_pretty(&report)?);if !report.valid{std::process::exit(2);}return Ok(());
    }
    workproof_engine::run(43127).await
}
