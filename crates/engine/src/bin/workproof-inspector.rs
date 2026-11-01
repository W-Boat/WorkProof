//! Isolated, one-shot inspection helper. No store, listener, artifact path or signing key access.
#![cfg_attr(windows, windows_subsystem = "windows")]
use std::io::Read;
fn main()->Result<(),Box<dyn std::error::Error>>{
    if std::env::args_os().len()!=1{return Err("Usage: workproof-inspector < certificate.wproof".into());}
    let mut bytes=vec![];std::io::stdin().take(32*1024*1024+1).read_to_end(&mut bytes)?;
    println!("{}",serde_json::to_string(&workproof_protocol::inspect_certificate_json(&bytes))?);Ok(())
}
