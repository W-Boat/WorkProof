//! CI-only JSON-lines bridge to the production editor store. No mock storage.
use std::{env,fs::{self,OpenOptions},io::{self,BufRead,Write},path::{Path,PathBuf},time::Instant};
use rand::RngCore;
use rusqlite::{Connection,OpenFlags};
use serde::Deserialize;
use serde_json::{json,Value};
use workproof_engine::editor;

const LINE_LIMIT:usize=32*1024*1024;
const MARKER:&str="workproof-editor-stress-harness/1\n";
type Result<T>=std::result::Result<T,String>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request{command:String,#[serde(default)]args:Value,request_id:Value}

fn isolated_root()->Result<PathBuf>{
    if env::var("GITHUB_ACTIONS").as_deref()!=Ok("true"){return Err("CI_ONLY: GITHUB_ACTIONS=true required".into());}
    let args:Vec<_>=env::args_os().skip(1).collect();
    let supplied=if args.is_empty(){env::var_os("WORKPROOF_EDITOR_STRESS_ROOT").ok_or("--root or WORKPROOF_EDITOR_STRESS_ROOT required")?}
        else if args.len()==2&&args[0]=="--root"{args[1].clone()}
        else{return Err("Usage: editor_stress_harness --root EXISTING_PRIVATE_TEMP_DIRECTORY".into());};
    let supplied=PathBuf::from(supplied);
    if !supplied.is_absolute(){return Err("Absolute temporary directory required".into());}
    let metadata=fs::symlink_metadata(&supplied).map_err(|e|e.to_string())?;
    if !metadata.is_dir()||metadata.file_type().is_symlink(){return Err("Existing regular temporary directory required".into());}
    let root=supplied.canonicalize().map_err(|e|e.to_string())?;
    let temp=env::temp_dir().canonicalize().map_err(|e|e.to_string())?;
    if root==temp||!root.starts_with(&temp)||!root.file_name().and_then(|s|s.to_str()).is_some_and(|s|s.starts_with("workproof-editor-stress-")&&s.len()>"workproof-editor-stress-".len()){
        return Err("Root must be a workproof-editor-stress-* directory within system temp".into());
    }
    let marker=root.join(".editor-stress-harness");
    if marker.exists(){
        if fs::symlink_metadata(&marker).map_err(|e|e.to_string())?.file_type().is_symlink()||fs::read(&marker).map_err(|e|e.to_string())?!=MARKER.as_bytes(){return Err("Invalid isolation marker".into());}
    }else{
        if fs::read_dir(&root).map_err(|e|e.to_string())?.next().is_some(){return Err("Fresh isolation root must be empty".into());}
        #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;fs::set_permissions(&root,fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;}
        let mut file=OpenOptions::new().write(true).create_new(true).open(&marker).map_err(|e|e.to_string())?;
        file.write_all(MARKER.as_bytes()).and_then(|_|file.sync_all()).map_err(|e|e.to_string())?;
        let mut seed=[0u8;32];rand::rngs::OsRng.fill_bytes(&mut seed);
        let mut options=OpenOptions::new();options.write(true).create_new(true);
        #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
        let mut key=options.open(root.join("signing-key.bin")).map_err(|e|e.to_string())?;
        key.write_all(&seed).and_then(|_|key.sync_all()).map_err(|e|e.to_string())?;
    }
    let key=root.join("signing-key.bin");
    let key_metadata=fs::symlink_metadata(&key).map_err(|e|e.to_string())?;
    if !key_metadata.is_file()||key_metadata.file_type().is_symlink()||key_metadata.len()!=32{return Err("Invalid isolated signing key".into());}
    let exports=root.join("exports");
    if !exports.exists(){fs::create_dir(&exports).map_err(|e|e.to_string())?;}
    if exports.canonicalize().map_err(|e|e.to_string())?!=exports{return Err("Export directory must not redirect outside isolated root".into());}
    for name in ["editor.sqlite","editor.sqlite-wal","editor.sqlite-shm"]{
        if let Ok(metadata)=fs::symlink_metadata(root.join(name)){if !metadata.is_file()||metadata.file_type().is_symlink(){return Err("SQLite files must remain within isolated root".into());}}
    }
    Ok(root)
}

fn string<'a>(args:&'a Value,name:&str)->Result<&'a str>{args.get(name).and_then(Value::as_str).ok_or_else(||format!("Missing string argument {name}"))}
fn export(root:&Path,args:&Value)->Result<Value>{
    let id=string(args,"id")?;
    let docx:Option<Vec<u8>>=serde_json::from_value(args.get("docx").cloned().unwrap_or(Value::Null)).map_err(|e|e.to_string())?;
    let markdown:Option<String>=serde_json::from_value(args.get("markdown").cloned().unwrap_or(Value::Null)).map_err(|e|e.to_string())?;
    if docx.is_some()&&markdown.is_some(){return Err("请选择一种导出格式。".into());}
    let extension=if docx.is_some(){"docx"}else if markdown.is_some(){"md"}else{"html"};
    let mut random=[0u8;16];rand::rngs::OsRng.fill_bytes(&mut random);
    let name=format!("WorkProof-stress-{}.{}",hex::encode(random),extension);
    let path=root.join("exports").join(&name);
    let certificate=path.with_extension(format!("{extension}.wproof"));
    let out=if let Some(text)=markdown.as_deref(){editor::export_markdown(root,id,&name,text)?}else{editor::export_artifact(root,id,&name,docx.as_deref())?};
    let proof=serde_json::to_vec_pretty(&out.proof).map_err(|e|e.to_string())?;
    let bytes=docx.as_deref().or_else(||markdown.as_deref().map(str::as_bytes)).unwrap_or(out.html.as_bytes());
    let mut artifact=OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e|e.to_string())?;
    let written=(||->Result<()>{
        let mut cert=OpenOptions::new().write(true).create_new(true).open(&certificate).map_err(|e|e.to_string())?;
        let result=artifact.write_all(bytes).and_then(|_|artifact.sync_all()).and_then(|_|cert.write_all(&proof)).and_then(|_|cert.sync_all()).map_err(|e|e.to_string());
        drop(cert);if result.is_err(){let _=fs::remove_file(&certificate);}result
    })();
    drop(artifact);if written.is_err(){let _=fs::remove_file(&path);}written?;
    // Re-read the actual synced files. A write-time report alone is insufficient.
    let actual=fs::read(&path).map_err(|e|e.to_string())?;
    let actual_proof:workproof_protocol::Proof=serde_json::from_slice(&fs::read(&certificate).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let fingerprint=workproof_protocol::digest(&actual);
    let report=workproof_protocol::verify(&actual_proof,&fingerprint,actual.len() as u64);
    if !report.valid||!report.file_match||!report.signature_valid{return Err("Read-back export verification failed".into());}
    Ok(json!({"saved":true,"cancelled":false,"file_name":name,"html":out.html,"fingerprint":fingerprint,"event_count":actual_proof.manifest.event_count,"report":report,"artifact_path":path,"certificate_path":certificate}))
}

fn stats(root:&Path)->Result<Value>{
    fn files(directory:&Path,root:&Path,out:&mut Vec<Value>,depth:usize)->Result<()>{
        if depth>8||out.len()>10000{return Err("Stress file inventory exceeds bound".into());}
        for entry in fs::read_dir(directory).map_err(|e|e.to_string())?{
            if out.len()>=10000{return Err("Stress file inventory exceeds bound".into());}
            let entry=entry.map_err(|e|e.to_string())?;
            let path=entry.path();
            let metadata=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
            if metadata.file_type().is_symlink(){return Err("Unexpected symlink in isolated storage".into());}
            if metadata.is_dir(){files(&path,root,out,depth+1)?;}else if metadata.is_file(){out.push(json!({"path":path.strip_prefix(root).map_err(|e|e.to_string())?,"bytes":metadata.len()}));}
        }
        Ok(())
    }
    let mut inventory=vec![];files(root,root,&mut inventory,0)?;
    let mut result=json!({"root":root,"files":inventory});
    if root.join("editor.sqlite").is_file(){
        let db=Connection::open_with_flags(root.join("editor.sqlite"),OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e|e.to_string())?;
        let page_count:u64=db.query_row("PRAGMA page_count",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let page_size:u64=db.query_row("PRAGMA page_size",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        result["sqlite"]=json!({"page_count":page_count,"page_size":page_size});
        let mut counts=serde_json::Map::new();
        for table in ["documents","revisions","editor_events"]{let count:u64=db.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|row|row.get(0)).map_err(|e|e.to_string())?;counts.insert(table.into(),json!(count));}
        result["sqlite"]["rows"]=Value::Object(counts);
        match db.prepare("SELECT name,SUM(pgsize),SUM(payload),SUM(unused) FROM dbstat GROUP BY name"){
            Ok(mut statement)=>{
                let rows=statement.query_map([],|row|Ok(json!({"name":row.get::<_,String>(0)?,"page_bytes":row.get::<_,u64>(1)?,"payload_bytes":row.get::<_,u64>(2)?,"unused_bytes":row.get::<_,u64>(3)?}))).map_err(|e|e.to_string())?;
                let mut values=vec![];for row in rows{values.push(row.map_err(|e|e.to_string())?);}result["sqlite"]["dbstat"]=json!(values);
            }
            Err(error)=>{result["sqlite"]["dbstat_error"]=json!(error.to_string());}
        };
    }
    Ok(result)
}
fn dispatch(root:&Path,request:&Request)->Result<Value>{
    let args=&request.args;
    match request.command.as_str(){
        "editor_list"=>editor::list(root),
        "editor_create"=>editor::create(root,string(args,"title")?,string(args,"started")?,args["kind"].as_str().unwrap_or("word")),
        "editor_load"=>editor::load(root,string(args,"id")?),
        "editor_save"=>editor::save(root,serde_json::from_value(args.get("input").cloned().ok_or("Missing input")?).map_err(|e|e.to_string())?),
        "editor_version"=>editor::version(root,string(args,"id")?,args["revision"].as_u64().ok_or("Missing unsigned revision")?),
        "editor_export"=>export(root,args),
        "stats"=>stats(root),
        _=>Err(format!("Unsupported stress command {}",request.command)),
    }
}

// Drain an oversized request through its newline, then accept the next request.
fn read_line(reader:&mut impl BufRead,buffer:&mut Vec<u8>)->io::Result<Option<bool>>{
    buffer.clear();let mut oversized=false;let mut received=false;
    loop{
        let chunk=reader.fill_buf()?;
        if chunk.is_empty(){return Ok(if received{Some(oversized)}else{None});}
        received=true;let length=chunk.iter().position(|byte|*byte==b'\n').map(|i|i+1).unwrap_or(chunk.len());let ended=chunk[length-1]==b'\n';
        if !oversized{if buffer.len().saturating_add(length)>LINE_LIMIT{oversized=true;buffer.clear();}else{buffer.extend_from_slice(&chunk[..length]);}}
        reader.consume(length);if ended{return Ok(Some(oversized));}
    }
}
fn main()->std::result::Result<(),Box<dyn std::error::Error>>{
    let root=isolated_root().map_err(io::Error::other)?;
    let stdin=io::stdin();let mut input=stdin.lock();let stdout=io::stdout();let mut output=stdout.lock();let mut buffer=Vec::new();
    while let Some(oversized)=read_line(&mut input,&mut buffer)?{
        let started=Instant::now();
        let parsed=if oversized{Err("Request line exceeds 32 MiB".to_string())}else{serde_json::from_slice::<Request>(&buffer).map_err(|e|e.to_string())};
        let (request_id,result)=match parsed{
            Ok(request)=>{let id=request.request_id.clone();let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||dispatch(&root,&request))).unwrap_or_else(|_|Err("Editor command panicked".into()));(id,result)}
            Err(error)=>(Value::Null,Err(error)),
        };
        let elapsed_ms=started.elapsed().as_secs_f64()*1000.0;
        let response=match result{Ok(result)=>json!({"request_id":request_id,"ok":true,"result":result,"error":null,"elapsed_ms":elapsed_ms}),Err(error)=>json!({"request_id":request_id,"ok":false,"result":null,"error":error,"elapsed_ms":elapsed_ms})};
        serde_json::to_writer(&mut output,&response)?;output.write_all(b"\n")?;output.flush()?;
    }
    Ok(())
}
