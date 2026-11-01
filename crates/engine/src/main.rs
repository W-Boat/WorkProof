use workproof_protocol::{Evidence,Proof,verify_evidence,create_disclosure};
use std::io::Read;
fn read_proof(path:&str)->Result<Vec<u8>,Box<dyn std::error::Error>>{
    let mut bytes=vec![];
    std::fs::File::open(path)?.take(32*1024*1024+1).read_to_end(&mut bytes)?;
    if bytes.len()>32*1024*1024{return Err("Proof exceeds 32 MiB".into());}
    Ok(bytes)
}
#[tokio::main(worker_threads = 2)]
async fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<String>=std::env::args().collect();
    if args.get(1).map(String::as_str)==Some("inspect-stdin"){
        if args.len()!=2{return Err("Usage: workproof-engine inspect-stdin < certificate.wproof".into());}
        let mut bytes=vec![];std::io::stdin().take(32*1024*1024+1).read_to_end(&mut bytes)?;
        println!("{}",serde_json::to_string(&workproof_protocol::inspect_certificate_json(&bytes))?);return Ok(());
    }
    if args.get(1).map(String::as_str)==Some("serve-web") {
        let dir=args.get(2).ok_or("Usage: workproof-engine serve-web DIRECTORY")?;
        if !std::path::Path::new(dir).join("index.html").is_file(){return Err("Directory must contain the exported verifier index.html".into());}
        let app=axum::Router::new().fallback_service(tower_http::services::ServeDir::new(dir));
        let listener=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,4173)).await?;
        println!("WorkProof verifier: http://127.0.0.1:4173 (static files only; no upload endpoint)");
        axum::serve(listener,app).await?;return Ok(());
    }
    if args.get(1).map(String::as_str)==Some("disclose") {
        if args.len()!=4&&args.len()!=5{return Err("Usage: workproof-engine disclose INPUT.wproof OUTPUT.wproof [ZERO_BASED_INDICES_CSV]".into());}
        let p:Proof=serde_json::from_slice(&read_proof(&args[2])?)?;
        let selected:Vec<u64>=if let Some(value)=args.get(4){
            if value.len()>16*1024{return Err("Selection exceeds limit".into());}
            value.split(',').map(str::parse).collect::<Result<_,_>>()?
        }else{vec![]};
        let d=create_disclosure(&p,&selected)?;
        use std::io::Write;
        let mut output=std::fs::OpenOptions::new().write(true).create_new(true).open(&args[3])?;
        output.write_all(&serde_json::to_vec_pretty(&d)?)?;
        println!("Selective proof exported: {} of {} events, original signature retained",d.disclosed.len(),d.manifest.event_count);
        return Ok(());
    }
    if args.get(1).map(String::as_str)==Some("verify") {
        if args.len()!=4{return Err("Usage: workproof-engine verify ARTIFACT PROOF.wproof".into());}
        let p:Evidence=serde_json::from_slice(&read_proof(&args[3])?)?;
        let mut file=std::fs::File::open(&args[2])?;let mut hasher=blake3::Hasher::new();let mut buf=[0u8;65536];let mut length=0;
        loop{let n=file.read(&mut buf)?;if n==0{break;}hasher.update(&buf[..n]);length+=n as u64;}
        let report=verify_evidence(&p,&hasher.finalize().to_hex().to_string(),length);
        println!("{}",serde_json::to_string_pretty(&report)?);if !report.valid{std::process::exit(2);}return Ok(());
    }
    if args.len()!=1{return Err("Unknown WorkProof command".into());}
    workproof_engine::run(43127).await
}
