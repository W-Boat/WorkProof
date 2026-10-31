//! CI harness: native desktop approval via stdin, never a production HTTP approval endpoint.
use std::io::BufRead;
#[tokio::main]
async fn main()->Result<(),Box<dyn std::error::Error>>{
    if std::env::var("GITHUB_ACTIONS").as_deref()!=Ok("true"){return Err("CI harness only".into());}
    let dir=workproof_engine::data_dir();
    let root=std::env::temp_dir().canonicalize()?;
    let actual=dir.canonicalize()?;
    if !actual.starts_with(root)||!actual.file_name().is_some_and(|s|s.to_string_lossy().starts_with("workproof-photoshop-")){return Err("Isolated fixture directory required".into());}
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
    workproof_engine::run(43127).await
}
