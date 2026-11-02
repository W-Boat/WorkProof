//! One-shot image verification. No document paths or CA contents cross the webview boundary.
use std::{path::{Path,PathBuf},process::{Command,Stdio,ExitStatus},io::Read,sync::atomic::{AtomicBool,Ordering},time::{Duration,Instant}};
use serde_json::{Value,json};
static BUSY:AtomicBool=AtomicBool::new(false);
struct Guard;
impl Drop for Guard{fn drop(&mut self){BUSY.store(false,Ordering::Release);}}

#[cfg(unix)]
fn prepare<T:std::os::fd::AsRawFd>(pipe:&T)->Result<(),String>{
    unsafe extern "C"{fn fcntl(fd:i32,cmd:i32,...)->i32;}
    #[cfg(target_os="macos")]let flag=4;
    #[cfg(not(target_os="macos"))]let flag=2048;
    let fd=pipe.as_raw_fd();let old=unsafe{fcntl(fd,3)};
    if old<0||unsafe{fcntl(fd,4,old|flag)}<0{return Err("无法限制核验输出读取。".into());}Ok(())
}
#[cfg(windows)]fn prepare<T>(_pipe:&T)->Result<(),String>{Ok(())}
#[cfg(windows)]trait Pipe:Read+std::os::windows::io::AsRawHandle{}
#[cfg(windows)]impl<T:Read+std::os::windows::io::AsRawHandle> Pipe for T{}
#[cfg(unix)]trait Pipe:Read{}
#[cfg(unix)]impl<T:Read> Pipe for T{}
fn drain<T:Pipe>(pipe:&mut T,out:&mut Vec<u8>,limit:usize)->Result<(),String>{
    let mut buffer=[0;4096];
    loop{
        #[cfg(windows)]{
            #[link(name="kernel32")]unsafe extern "system"{fn PeekNamedPipe(h:*mut std::ffi::c_void,b:*mut std::ffi::c_void,n:u32,r:*mut u32,a:*mut u32,l:*mut u32)->i32;}
            let mut available=0;
            if unsafe{PeekNamedPipe(pipe.as_raw_handle(),std::ptr::null_mut(),0,std::ptr::null_mut(),&mut available,std::ptr::null_mut())}==0{return if std::io::Error::last_os_error().raw_os_error()==Some(109){Ok(())}else{Err("无法读取核验输出。".into())};}
            if available==0{return Ok(());}
        }
        match pipe.read(&mut buffer){Ok(0)=>return Ok(()),Ok(n)=>{if out.len()+n>limit{return Err("核验输出过大，已停止本次检查。".into());}out.extend_from_slice(&buffer[..n]);},Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>return Ok(()),Err(_)=>return Err("无法读取核验输出。".into())}
    }
}
fn capture(mut command:Command,seconds:u64,limit:usize)->Result<(ExitStatus,Vec<u8>,Vec<u8>),String>{
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let mut child=command.spawn().map_err(|_|"无法启动核验工具或系统文件选择器，请检查完整安装包与系统组件。")?;
    let mut stdout=child.stdout.take().unwrap();let mut stderr=child.stderr.take().unwrap();
    let deadline=Instant::now()+Duration::from_secs(seconds);let mut out=vec![];let mut err=vec![];
    let result=(||{prepare(&stdout)?;prepare(&stderr)?;loop{
        let status=child.try_wait().map_err(|_|"无法确认核验工具是否完成。")?;
        drain(&mut stdout,&mut out,limit)?;drain(&mut stderr,&mut err,limit)?;
        if let Some(status)=status{return Ok((status,out,err));}
        if Instant::now()>=deadline{return Err("操作超时，已停止本次检查。你的文件没有修改。".into());}
        std::thread::sleep(Duration::from_millis(30));
    }})();
    if result.is_err(){let _=child.kill();let _=child.wait();}result
}

fn choose(image:bool)->Result<Option<PathBuf>,String>{
    #[cfg(windows)]let command={
        let root=std::env::var_os("SystemRoot").ok_or("无法定位系统文件选择器。")?;
        let mut c=Command::new(PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
        let filter=if image{"PNG / JPEG|*.png;*.jpg;*.jpeg"}else{"CA 证书文件|*.pem;*.crt;*.cer"};
        let title=if image{"选择带有创作证书的图片"}else{"选择从可信渠道取得的 CA 证书文件"};
        c.args(["-NoLogo","-NoProfile","-NonInteractive","-STA","-Command"]).arg(format!("Add-Type -AssemblyName System.Windows.Forms;[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$d=New-Object Windows.Forms.OpenFileDialog;$d.Title='{title}';$d.Filter='{filter}';$d.Multiselect=$false;$d.CheckFileExists=$true;if($d.ShowDialog() -eq 'OK'){{[Console]::Write($d.FileName)}};$d.Dispose()"));c
    };
    #[cfg(target_os="macos")]let command={let mut c=Command::new("/usr/bin/osascript");let prompt=if image{"选择带有创作证书的 PNG 或 JPEG 图片"}else{"选择从可信渠道取得的 CA 证书文件"};c.args(["-e",&format!("try\nPOSIX path of (choose file with prompt \"{prompt}\")\non error number -128\nreturn \"\"\nend try")]);c};
    #[cfg(target_os="linux")]let command={let mut c=Command::new("zenity");c.args(["--file-selection","--title",if image{"选择带有创作证书的图片"}else{"选择独立可信的 CA 证书文件"}]);c.arg(if image{"--file-filter=PNG / JPEG | *.png *.jpg *.jpeg"}else{"--file-filter=CA | *.pem *.crt *.cer"});c};
    let (status,out,_)=capture(command,300,32768)?;
    #[cfg(target_os="linux")]if status.code()==Some(1){return Ok(None);}
    if !status.success(){return Err("系统没有完成文件选择。Linux 桌面需要安装 zenity，并在图形会话中运行。".into());}
    let text=String::from_utf8(out).map_err(|_|"文件路径无法读取。")?;let text=text.trim_end_matches(['\r','\n']);
    if text.is_empty(){Ok(None)}else{Ok(Some(PathBuf::from(text)))}
}
fn regular(path:&Path,limit:u64)->Result<(),String>{let m=std::fs::metadata(path).map_err(|_|"选中的文件无法读取，请检查是否仍在原位置。")?;if !m.is_file()||m.len()==0||m.len()>limit{return Err("请选择大小符合要求的普通文件：图片最多 96 MB，CA 文件最多 256 KB。".into());}Ok(())}

pub(crate) fn checked_summary(bytes:&[u8])->Result<Value,String>{
    let v:Value=serde_json::from_slice(bytes).map_err(|_|"核验工具返回了无法识别的结果，请更新完整安装包。")?;
    let yes=|path:&str|v.pointer(path).and_then(Value::as_bool)==Some(true);
    let no=|path:&str|v.pointer(path).and_then(Value::as_bool)==Some(false);
    let mime=v["media_type"].as_str().unwrap_or("");let scope=v.pointer("/workproof/scope").and_then(Value::as_str).unwrap_or("");
    let disclosed=v.pointer("/workproof/disclosed_events").and_then(Value::as_u64);let total=v.pointer("/workproof/total_events").and_then(Value::as_u64);
    // A selective proof authenticates disclosed Merkle leaves, not the entire
    // undisclosed hash chain. Legacy full proofs predate the Merkle field.
    let coverage=match scope{
        "full"=>yes("/workproof/chain_valid")&&v.pointer("/workproof/merkle_valid").is_some_and(|m|m.is_null()||m.as_bool()==Some(true)),
        "selective"=>no("/workproof/chain_valid")&&yes("/workproof/merkle_valid"),
        _=>false,
    };
    if v["protocol"]!="workproof-c2pa-report/1"||v["trust_policy"]!="explicit-ca-file"||!matches!(mime,"image/png"|"image/jpeg")||!matches!(scope,"full"|"selective")||
        !coverage||!["/c2pa_integrity_valid","/c2pa_trusted","/original_asset_checked","/workproof/valid","/workproof/file_match","/workproof/signature_valid"].iter().all(|p|yes(p))||
        !["/identity_verified","/creation_time_verified","/revocation_checked","/network_used"].iter().all(|p|no(p))||
        !yes(if mime=="image/png"{"/original_png_checked"}else{"/original_jpeg_checked"})||
        v.pointer("/workproof/errors").and_then(Value::as_array).map_or(true,|a|!a.is_empty())||
        disclosed.is_none()||total.is_none()||disclosed<Some(2)||disclosed>total||(scope=="full"&&disclosed!=total){return Err("核验结果不完整或检查未全部通过，请使用匹配版本的完整安装包重试。".into());}
    Ok(json!({"scope":scope,"disclosed":disclosed,"total":total,"mediaType":mime}))
}
fn failure(stderr:&[u8])->String{
    let text=String::from_utf8_lossy(stderr);
    if text.contains("C2PA_EXPLICIT_CA_TRUST_FAILED"){"所选 CA 未能建立可信签名链。请向签发方核对独立可信的 CA 文件。"}
    else if text.contains("C2PA_MANIFEST_REQUIRED"){"这张图片没有找到可核验的内嵌证书。普通图片请使用作品与 .wproof 配对核验。"}
    else if text.contains("WORKPROOF_OR_ORIGINAL_ASSET_MISMATCH"){"图片与创作证据不匹配，或创作证据已被修改。请取得原始交付件后重试。"}
    else{"本次核验未通过。图片、内嵌证书或 CA 文件可能不符合要求，请核对原始交付件；不能将此结果直接认定为 AI 创作或抄袭。"}.into()
}
pub fn verify(resource:PathBuf)->Result<Value,String>{
    if BUSY.swap(true,Ordering::AcqRel){return Err("已有图片核验正在进行，请完成或取消当前选择。".into());}let _guard=Guard;
    let name=if cfg!(windows){"workproof-c2pa.exe"}else{"workproof-c2pa"};
    let mut candidates=vec![resource.join("c2pa").join(name)];if let Ok(exe)=std::env::current_exe(){if let Some(parent)=exe.parent(){candidates.push(parent.join("c2pa").join(name));}}
    let tool=candidates.into_iter().find(|p|p.is_file()).ok_or("安装包中缺少图片核验工具。请安装包含 C2PA 工具的完整 WorkProof 安装包。")?;
    let Some(image)=choose(true)?else{return Ok(json!({"cancelled":true}));};regular(&image,96*1024*1024)?;
    let Some(ca)=choose(false)?else{return Ok(json!({"cancelled":true}));};regular(&ca,256*1024)?;
    let mut command=Command::new(tool);command.arg("verify").arg(image).arg(ca);
    let (status,output,stderr)=capture(command,60,1024*1024)?;if !status.success(){return Err(failure(&stderr));}checked_summary(&output)
}

#[cfg(test)]mod tests{
    use super::*;
    fn sample()->Value{json!({"protocol":"workproof-c2pa-report/1","trust_policy":"explicit-ca-file","media_type":"image/png","c2pa_integrity_valid":true,"c2pa_trusted":true,"original_asset_checked":true,"original_png_checked":true,"identity_verified":false,"creation_time_verified":false,"revocation_checked":false,"network_used":false,"workproof":{"valid":true,"file_match":true,"chain_valid":true,"signature_valid":true,"merkle_valid":true,"scope":"full","disclosed_events":5,"total_events":5,"errors":[]}})}
    #[test]fn reject_false_incomplete_or_inconsistent_success(){
        assert!(checked_summary(b"not json").is_err());let sample=sample();
        for path in ["/c2pa_trusted","/workproof/file_match","/workproof/signature_valid","/workproof/merkle_valid"]{let mut v=sample.clone();*v.pointer_mut(path).unwrap()=json!(false);assert!(checked_summary(&serde_json::to_vec(&v).unwrap()).is_err());}
        let mut v=sample.clone();v["workproof"]["total_events"]=json!(4);assert!(checked_summary(&serde_json::to_vec(&v).unwrap()).is_err());
        let mut v=sample.clone();v["workproof"]["errors"]=json!(["tamper"]);assert!(checked_summary(&serde_json::to_vec(&v).unwrap()).is_err());
        let mut v=sample;v["workproof"].as_object_mut().unwrap().remove("merkle_valid");assert!(checked_summary(&serde_json::to_vec(&v).unwrap()).is_err());
    }
    #[test]fn full_legacy_and_selective_coverage_are_distinct(){
        let full=sample();assert!(checked_summary(&serde_json::to_vec(&full).unwrap()).is_ok());
        let mut legacy=full.clone();legacy["workproof"]["merkle_valid"]=Value::Null;assert!(checked_summary(&serde_json::to_vec(&legacy).unwrap()).is_ok());
        legacy["workproof"]["chain_valid"]=json!(false);assert!(checked_summary(&serde_json::to_vec(&legacy).unwrap()).is_err());
        let mut selected=full;selected["workproof"]["scope"]=json!("selective");selected["workproof"]["chain_valid"]=json!(false);selected["workproof"]["disclosed_events"]=json!(3);
        let summary=checked_summary(&serde_json::to_vec(&selected).unwrap()).unwrap();assert_eq!(summary["scope"],"selective");
        for field in ["chain_valid","merkle_valid"]{let mut invalid=selected.clone();invalid["workproof"][field]=if field=="chain_valid"{json!(true)}else{Value::Null};assert!(checked_summary(&serde_json::to_vec(&invalid).unwrap()).is_err());}
    }
    #[test]fn consume_real_cli_reports(){
        let Some(path)=std::env::var_os("WORKPROOF_C2PA_REPORT")else{assert_ne!(std::env::var("GITHUB_ACTIONS").as_deref(),Ok("true"),"CI must supply WORKPROOF_C2PA_REPORT with real full and selective CLI reports");return;};
        let data=std::fs::read(path).unwrap();let reports:Vec<Value>=serde_json::from_slice(&data).expect("CLI fixture reports must be an array");
        let mut full=false;let mut selected=false;
        for report in reports{let summary=checked_summary(&serde_json::to_vec(&report).unwrap()).expect("real independent CLI result must be compatible");full|=summary["scope"]=="full";selected|=summary["scope"]=="selective";assert!(summary["total"].is_u64());}
        assert!(full&&selected,"real CLI fixtures must cover full and selective evidence");
    }
    fn helper(script:&str)->Command{
        #[cfg(windows)]{let root=std::env::var_os("SystemRoot").unwrap();let mut c=Command::new(PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));c.args(["-NoProfile","-NonInteractive","-Command",script]);c}
        #[cfg(unix)]{let mut c=Command::new("/bin/sh");c.args(["-c",script]);c}
    }
    #[test]fn helper_output_and_timeout_are_bounded(){
        #[cfg(windows)]let (large,stall)=("[Console]::Write(('x'*10000))","Start-Sleep -Seconds 5");
        #[cfg(unix)]let (large,stall)=("printf '%010000d' 0","exec sleep 5");
        assert!(capture(helper(large),10,100).is_err());let start=Instant::now();assert!(capture(helper(stall),1,100).is_err());assert!(start.elapsed()<Duration::from_secs(4));
    }
}
