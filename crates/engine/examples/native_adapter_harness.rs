//! CI harness: native desktop approval via stdin, never a production HTTP approval endpoint.
use std::io::BufRead;
#[tokio::main]
async fn main()->Result<(),Box<dyn std::error::Error>>{
    if std::env::var("GITHUB_ACTIONS").as_deref()!=Ok("true"){return Err("CI harness only".into());}
    let dir=workproof_engine::data_dir()?;
    let root=std::env::temp_dir().canonicalize()?;
    let actual=dir.canonicalize()?;
    if !actual.starts_with(root)||!actual.file_name().is_some_and(|s|{let n=s.to_string_lossy();n.starts_with("workproof-photoshop-")||n.starts_with("workproof-word-")||n.starts_with("workproof-krita-")}){return Err("Isolated fixture directory required".into());}
    std::thread::spawn(||{
        for line in std::io::stdin().lock().lines(){
            let Ok(line)=line else{break;};
            let Ok(value)=serde_json::from_str::<serde_json::Value>(&line) else{continue;};
            if let Some(ticket)=value["revoke"].as_str(){
                if workproof_engine::pairing::revoke(ticket).is_err(){eprintln!("Fixture revocation rejected");}
                continue;
            }
            if let (Some(ticket),Some(approve))=(value["ticket"].as_str(),value["approve"].as_bool()){
                if workproof_engine::pairing::decide(ticket,approve).is_err(){eprintln!("Fixture approval rejected");}
            }
        }
    });
    // Optional port keeps fixture runs from colliding with an installed desktop on 43127.
    let port=std::env::var("WORKPROOF_HARNESS_PORT").ok().and_then(|p|p.parse().ok()).unwrap_or(43127);
    workproof_engine::run(port).await
}
