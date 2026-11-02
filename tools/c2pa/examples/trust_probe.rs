//! CI-only diagnosis against synthetic public certificates. This does not alter
//! the production Reader context or grant trust to an end-entity certificate.
use c2pa::crypto::cose::{CertificateTrustPolicy,TrustAnchorType};
use std::{env,fs,process::ExitCode};

fn execute()->Result<(),Box<dyn std::error::Error>>{
    if env::var("GITHUB_ACTIONS").as_deref()!=Ok("true"){return Err("CI_ONLY_SYNTHETIC_CERTIFICATE_PROBE".into());}
    let args:Vec<_>=env::args().skip(1).collect();
    if args.len()!=3{return Err("Usage: trust_probe ROOT.pem ROOT.der SIGNER.der".into());}
    let pem=fs::read(&args[0])?;let root=fs::read(&args[1])?;let leaf=fs::read(&args[2])?;
    let mut policy=CertificateTrustPolicy::default();
    policy.add_trust_anchors(&pem,"urn:workproof:synthetic-ci-root",TrustAnchorType::Manifest,None)?;
    let full_chain=vec![leaf.clone(),root.clone()];
    let issuer_chain=vec![root];
    for (name,chain) in [("full-chain-leaf-and-root",full_chain.as_slice()),("issuer-chain-root-only",issuer_chain.as_slice()),("leaf-only-with-explicit-root-anchor",&[][..])]{
        let result=policy.check_certificate_trust(chain,&leaf,None);
        println!("{}",serde_json::json!({"probe":name,"accepted":result.is_ok(),"sdk_result":format!("{result:?}"),"scope":"CI synthetic public certificates; production policy unchanged"}));
    }
    Ok(())
}
fn main()->ExitCode{
    match execute(){Ok(())=>ExitCode::SUCCESS,Err(error)=>{eprintln!("Trust probe setup failed: {error}");ExitCode::FAILURE}}
}
