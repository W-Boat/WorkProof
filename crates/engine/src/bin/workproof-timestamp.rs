//! Optional RFC 3161 interoperability tool. Never runs as part of the collector.
use std::{fs,io::{Read,Write},path::{Path,PathBuf},process::{Command,Stdio},time::{Duration,Instant}};

struct Workspace(PathBuf);
impl Workspace {
    fn create()->std::io::Result<Self>{
        let path=std::env::temp_dir().join(format!("workproof-ts-{:032x}",rand::random::<u128>()));
        let mut builder=fs::DirBuilder::new();
        #[cfg(unix)] {use std::os::unix::fs::DirBuilderExt;builder.mode(0o700);}
        builder.create(&path)?;Ok(Self(path))
    }
    fn file(&self,name:&str)->PathBuf{self.0.join(name)}
}
impl Drop for Workspace {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn bounded(path:&Path,limit:u64)->Result<Vec<u8>,Box<dyn std::error::Error>>{
    let mut bytes=Vec::new();fs::File::open(path)?.take(limit+1).read_to_end(&mut bytes)?;
    if bytes.len() as u64>limit{return Err("Input exceeds size limit".into());}Ok(bytes)
}
fn openssl(program:&Path,args:&[&std::ffi::OsStr])->Result<bool,Box<dyn std::error::Error>>{
    if !program.is_absolute()||!program.is_file(){return Err("OpenSSL must be an explicit absolute executable path".into());}
    let mut command=Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    command.env_remove("OPENSSL_CONF").env_remove("OPENSSL_MODULES");
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let mut child=command.spawn()?;let started=Instant::now();
    loop {
        if let Some(status)=child.try_wait()?{return Ok(status.success());}
        if started.elapsed()>Duration::from_secs(15){let _=child.kill();let _=child.wait();return Err("OpenSSL timed out".into());}
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn main()->Result<std::process::ExitCode,Box<dyn std::error::Error>>{
    let args:Vec<_>=std::env::args_os().collect();
    let mode=args.get(1).and_then(|v|v.to_str()).unwrap_or("");
    if !((mode=="request"&&args.len()==5)||(mode=="verify"&&args.len()==7)){
        return Err("Usage: workproof-timestamp request PROOF OUTPUT.tsq ABSOLUTE_OPENSSL | verify PROOF QUERY.tsq RESPONSE.tsr TRUST.pem ABSOLUTE_OPENSSL".into());
    }
    let report=workproof_protocol::inspect_certificate_json(&bounded(Path::new(&args[2]),32*1024*1024)?);
    if !report.certificate_valid{return Err("Certificate content is invalid; no timestamp request or trusted result produced".into());}
    let signature=hex::decode(report.signature.ok_or("Missing verified signature")?)?;
    let work=Workspace::create()?;let data=work.file("signature.bin");fs::write(&data,signature)?;
    if mode=="request" {
        let query=work.file("request.tsq");
        if !openssl(Path::new(&args[4]),&["ts".as_ref(),"-query".as_ref(),"-sha256".as_ref(),"-cert".as_ref(),"-data".as_ref(),data.as_os_str(),"-out".as_ref(),query.as_os_str()])? {return Err("OpenSSL could not generate RFC 3161 request".into());}
        let bytes=bounded(&query,64*1024)?;
        let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&args[3])?;output.write_all(&bytes)?;
        println!("{{\"protocol\":\"workproof-timestamp/1\",\"request_created\":true,\"timestamp_verified\":false,\"network_used\":false}}");
        return Ok(std::process::ExitCode::SUCCESS);
    }
    let query=work.file("request.tsq");fs::write(&query,bounded(Path::new(&args[3]),64*1024)?)?;
    let response=work.file("response.tsr");fs::write(&response,bounded(Path::new(&args[4]),1024*1024)?)?;
    let trust=work.file("trust.pem");fs::write(&trust,bounded(Path::new(&args[5]),1024*1024)?)?;
    let program=Path::new(&args[6]);
    let verify=|binding:&str,value:&Path| openssl(program,&["ts".as_ref(),"-verify".as_ref(),binding.as_ref(),value.as_os_str(),"-in".as_ref(),response.as_os_str(),"-CAfile".as_ref(),trust.as_os_str(),"-no-CApath".as_ref(),"-no-CAstore".as_ref()]);
    // Query binding enforces the nonce; data binding prevents substituting another query/response pair.
    let valid=verify("-queryfile",&query)?&&verify("-data",&data)?;
    println!("{}",serde_json::json!({"protocol":"workproof-timestamp/1","timestamp_verified":valid,
        "trust_policy":"explicit-ca-file","artifact_checked":false,"identity_verified":false,"creation_time_verified":false,
        "revocation_checked":false,"network_used":false}));
    Ok(if valid {std::process::ExitCode::SUCCESS} else {std::process::ExitCode::from(2)})
}
