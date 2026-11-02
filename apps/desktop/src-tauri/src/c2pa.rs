//! One-shot image verification. No document paths or CA contents cross the webview boundary.
use std::{path::{Path,PathBuf},process::{Command,Stdio,ExitStatus},io::Read,sync::atomic::{AtomicBool,Ordering},time::{Duration,Instant}};
use serde_json::{Value,json};
static BUSY:AtomicBool=AtomicBool::new(false);
struct Guard;
impl Drop for Guard{fn drop(&mut self){BUSY.store(false,Ordering::Release);}}

// Each invocation owns a fresh process group/job. Cleanup never targets a
// process discovered by name or an unrelated installation's process ID.
#[cfg(unix)]struct ProcessTree(i32);
#[cfg(unix)]impl ProcessTree{
    fn attach(child:&std::process::Child)->Result<Self,String>{Ok(Self(child.id() as i32))}
}
#[cfg(unix)]impl Drop for ProcessTree{fn drop(&mut self){
    unsafe extern "C"{fn kill(pid:i32,signal:i32)->i32;}
    unsafe{kill(-self.0,9);}
}}

#[cfg(windows)]mod process_tree{
    use std::{ffi::c_void,os::windows::io::AsRawHandle,process::Child};
    type Handle=*mut c_void;
    #[repr(C)]#[derive(Default)]struct BasicLimits{process_time:i64,job_time:i64,flags:u32,min_working:usize,max_working:usize,active:u32,affinity:usize,priority:u32,scheduling:u32}
    #[repr(C)]#[derive(Default)]struct ExtendedLimits{basic:BasicLimits,io:[u64;6],process_memory:usize,job_memory:usize,peak_process:usize,peak_job:usize}
    #[repr(C)]struct ThreadEntry{size:u32,usage:u32,id:u32,owner:u32,base_priority:i32,delta_priority:i32,flags:u32}
    #[link(name="kernel32")]unsafe extern "system"{
        fn CreateJobObjectW(attributes:*mut c_void,name:*const u16)->Handle;
        fn SetInformationJobObject(job:Handle,class:i32,info:*const c_void,size:u32)->i32;
        fn AssignProcessToJobObject(job:Handle,process:Handle)->i32;
        fn CloseHandle(handle:Handle)->i32;
        fn CreateToolhelp32Snapshot(flags:u32,pid:u32)->Handle;
        fn Thread32First(snapshot:Handle,entry:*mut ThreadEntry)->i32;
        fn Thread32Next(snapshot:Handle,entry:*mut ThreadEntry)->i32;
        fn OpenThread(access:u32,inherit:i32,id:u32)->Handle;
        fn ResumeThread(thread:Handle)->u32;
    }
    struct Owned(Handle);
    impl Drop for Owned{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
    pub(super) struct ProcessTree(Owned);
    impl ProcessTree{
        pub(super) fn attach(child:&Child)->Result<Self,String>{unsafe{
            let job=CreateJobObjectW(std::ptr::null_mut(),std::ptr::null());
            if job.is_null(){return Err("无法隔离本次核验进程。".into());}
            let job=Owned(job);let mut limits=ExtendedLimits::default();limits.basic.flags=0x2000;
            if SetInformationJobObject(job.0,9,&limits as *const _ as *const c_void,std::mem::size_of_val(&limits) as u32)==0||AssignProcessToJobObject(job.0,child.as_raw_handle())==0{
                return Err("无法隔离本次核验进程，已取消启动。".into());
            }
            // The child was created suspended, so it cannot spawn descendants
            // before assignment. Resume only its own initial thread.
            let snapshot=CreateToolhelp32Snapshot(4,0);
            if snapshot as isize == -1{return Err("无法完成核验进程启动。".into());}
            let snapshot=Owned(snapshot);
            let mut entry=ThreadEntry{size:std::mem::size_of::<ThreadEntry>() as u32,usage:0,id:0,owner:0,base_priority:0,delta_priority:0,flags:0};
            let mut available=Thread32First(snapshot.0,&mut entry);
            while available!=0{
                if entry.owner==child.id(){
                    let thread=OpenThread(2,0,entry.id);
                    if thread.is_null(){return Err("无法恢复核验进程。".into());}
                    let thread=Owned(thread);
                    if ResumeThread(thread.0)==u32::MAX{return Err("无法恢复核验进程。".into());}
                    return Ok(Self(job));
                }
                entry.size=std::mem::size_of::<ThreadEntry>() as u32;
                available=Thread32Next(snapshot.0,&mut entry);
            }
            Err("核验进程的初始线程不可用。".into())
        }}
    }
}
#[cfg(windows)]use process_tree::ProcessTree;

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
    #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000004);}
    #[cfg(unix)]{use std::os::unix::process::CommandExt;command.process_group(0);}
    let mut child=command.spawn().map_err(|_|"无法启动核验工具或系统文件选择器，请检查完整安装包与系统组件。")?;
    let tree=match ProcessTree::attach(&child){Ok(tree)=>tree,Err(error)=>{let _=child.kill();let _=child.wait();return Err(error);}};
    let mut stdout=child.stdout.take().unwrap();let mut stderr=child.stderr.take().unwrap();
    let deadline=Instant::now()+Duration::from_secs(seconds);let mut out=vec![];let mut err=vec![];
    let result=(||{prepare(&stdout)?;prepare(&stderr)?;loop{
        let status=child.try_wait().map_err(|_|"无法确认核验工具是否完成。")?;
        drain(&mut stdout,&mut out,limit)?;drain(&mut stderr,&mut err,limit)?;
        if let Some(status)=status{return Ok((status,out,err));}
        if Instant::now()>=deadline{return Err("操作超时，已停止本次检查。你的文件没有修改。".into());}
        std::thread::sleep(Duration::from_millis(30));
    }})();
    drop(tree); // Also closes descendants after normal helper exit.
    if result.is_err(){let _=child.kill();let _=child.wait();}result
}

fn choose(image:bool)->Result<Option<PathBuf>,String>{
    if image{pick("选择带有创作证书的图片","PNG / JPEG|*.png;*.jpg;*.jpeg",false,"带证书图片.png")}
    else{pick("选择从可信渠道取得的 CA 证书文件","CA 证书文件|*.pem;*.crt;*.cer",false,"")}
}
fn pick(title:&str,filter:&str,save:bool,suggested:&str)->Result<Option<PathBuf>,String>{
    #[cfg(windows)]let command={
        let root=std::env::var_os("SystemRoot").ok_or("无法定位系统文件选择器。")?;
        let mut c=Command::new(PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
        let kind=if save{"SaveFileDialog"}else{"OpenFileDialog"};
        // Arguments are fixed application labels, never selected file paths.
        c.args(["-NoLogo","-NoProfile","-NonInteractive","-STA","-Command"]).arg(format!("Add-Type -AssemblyName System.Windows.Forms;[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$d=New-Object Windows.Forms.{kind};$d.Title='{title}';$d.Filter='{filter}';$d.FileName='{suggested}';if($d.ShowDialog() -eq 'OK'){{[Console]::Write($d.FileName)}};$d.Dispose()"));c
    };
    #[cfg(target_os="macos")]let command={let mut c=Command::new("/usr/bin/osascript");let selection=if save{format!("choose file name with prompt \"{title}\" default name \"{suggested}\"")}else{format!("choose file with prompt \"{title}\"")};c.args(["-e",&format!("try\nPOSIX path of ({selection})\non error number -128\nreturn \"\"\nend try")]);c};
    #[cfg(target_os="linux")]let command={let mut c=Command::new("zenity");c.args(["--file-selection","--title",title]);if save{c.args(["--save","--confirm-overwrite","--filename",suggested]);}let (label,patterns)=filter.split_once('|').unwrap_or(("文件","*"));c.arg(format!("--file-filter={label} | {}",patterns.replace(';'," ")));c};
    let (status,out,_)=capture(command,300,32768)?;
    #[cfg(target_os="linux")]if status.code()==Some(1){return Ok(None);}
    if !status.success(){return Err("系统没有完成文件选择。Linux 桌面需要安装 zenity，并在图形会话中运行。".into());}
    let text=String::from_utf8(out).map_err(|_|"文件路径无法读取。")?;let text=text.trim_end_matches(['\r','\n']);
    if text.is_empty(){Ok(None)}else{Ok(Some(PathBuf::from(text)))}
}
fn regular(path:&Path,limit:u64)->Result<(),String>{let m=std::fs::metadata(path).map_err(|_|"选中的文件无法读取，请检查是否仍在原位置。")?;if !m.is_file()||m.len()==0||m.len()>limit{return Err(format!("请选择非空的普通文件，当前文件大小上限为 {} KB。",limit/1024));}Ok(())}

pub(crate) fn checked_summary(bytes:&[u8])->Result<Value,String>{parse_summary(bytes,true)}
pub(crate) fn checked_embed_summary(bytes:&[u8])->Result<Value,String>{parse_summary(bytes,false)}
fn parse_summary(bytes:&[u8],trusted:bool)->Result<Value,String>{
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
    if v["protocol"]!="workproof-c2pa-report/1"||v["trust_policy"]!=(if trusted{"explicit-ca-file"}else{"not-verified"})||!matches!(mime,"image/png"|"image/jpeg")||!matches!(scope,"full"|"selective")||
        !coverage||v["c2pa_trusted"].as_bool()!=Some(trusted)||!["/c2pa_integrity_valid","/original_asset_checked","/workproof/valid","/workproof/file_match","/workproof/signature_valid"].iter().all(|p|yes(p))||
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
fn find_tool(resource:PathBuf)->Result<PathBuf,String>{
    let name=if cfg!(windows){"workproof-c2pa.exe"}else{"workproof-c2pa"};
    let mut candidates=vec![resource.join("c2pa").join(name)];if let Ok(exe)=std::env::current_exe(){if let Some(parent)=exe.parent(){candidates.push(parent.join("c2pa").join(name));}}
    candidates.into_iter().find(|p|p.is_file()).ok_or_else(||"安装包中缺少图片核验工具。请安装包含 C2PA 工具的完整 WorkProof 安装包。".into())
}

pub fn embed(resource:PathBuf,consent:bool)->Result<Value,String>{
    if !consent{return Err("请先确认同意公开所选证书中的过程信息。".into());}
    if BUSY.swap(true,Ordering::AcqRel){return Err("已有图片操作正在进行，请先完成或取消。".into());}let _guard=Guard;
    let tool=find_tool(resource)?;
    let mut inputs=Vec::new();
    for (title,filter,limit) in [
        ("第 1 步：选择原始 PNG 或 JPEG","PNG / JPEG|*.png;*.jpg;*.jpeg",64*1024*1024),
        ("第 2 步：选择与原图匹配的创作证书","WorkProof 证书|*.wproof",8*1024*1024),
        ("第 3 步：选择 ES256 签署证书链","PEM 签名链|*.pem",256*1024),
        ("第 4 步：选择对应的签署私钥","PEM 私钥|*.pem;*.key",64*1024)]{
        let Some(path)=pick(title,filter,false,"")?else{return Ok(json!({"cancelled":true}));};
        regular(&path,limit)?;inputs.push(path);
    }
    let jpeg=inputs[0].extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("jpg")||e.eq_ignore_ascii_case("jpeg"));
    let suggested=if jpeg{"作品-带证书.jpg"}else{"作品-带证书.png"};
    let Some(destination)=pick("第 5 步：选择新图片保存位置（不覆盖已有文件）","PNG / JPEG|*.png;*.jpg;*.jpeg",true,suggested)?else{return Ok(json!({"cancelled":true}));};
    if std::fs::symlink_metadata(&destination).is_ok(){return Err("保存位置已有文件，请重新操作并选择新的文件名。原文件未修改。".into());}
    let mut command=Command::new(tool);command.arg("embed").args(&inputs).arg(&destination).arg("--allow-public-process");
    let (status,out,stderr)=capture(command,60,1024*1024)?;
    if !status.success(){return Err(if String::from_utf8_lossy(&stderr).contains("OUTPUT_ALREADY_EXISTS"){"保存位置已有文件，请选择新文件名。".into()}else{"封装未完成。请核对原图与创作证书是否匹配、签名链与私钥是否对应，并确认它们支持 ES256。已有文件不会覆盖。".into()});}
    checked_embed_summary(&out)
}

pub fn verify(resource:PathBuf)->Result<Value,String>{
    if BUSY.swap(true,Ordering::AcqRel){return Err("已有图片核验正在进行，请完成或取消当前选择。".into());}let _guard=Guard;
    let tool=find_tool(resource)?;
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
    #[test]fn packaging_is_not_independent_ca_trust(){
        let mut report=sample();report["c2pa_trusted"]=json!(false);report["trust_policy"]=json!("not-verified");
        let bytes=serde_json::to_vec(&report).unwrap();assert!(checked_embed_summary(&bytes).is_ok());assert!(checked_summary(&bytes).is_err());
        assert!(checked_embed_summary(&serde_json::to_vec(&sample()).unwrap()).is_err());
        report["workproof"]["valid"]=json!(false);assert!(checked_embed_summary(&serde_json::to_vec(&report).unwrap()).is_err());
    }
    #[test]fn consent_is_required_before_opening_any_files(){assert!(embed(PathBuf::new(),false).unwrap_err().contains("同意"));}
    #[test]fn consume_real_embed_reports(){
        let Some(path)=std::env::var_os("WORKPROOF_C2PA_EMBED_REPORT")else{assert_ne!(std::env::var("GITHUB_ACTIONS").as_deref(),Ok("true"),"CI must supply real embed reports");return;};
        let reports:Vec<Value>=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(reports.len(),6);let mut full=false;let mut selected=false;
        for report in reports{let bytes=serde_json::to_vec(&report).unwrap();let summary=checked_embed_summary(&bytes).expect("real embed report must be accepted without asserting CA trust");assert!(checked_summary(&bytes).is_err());full|=summary["scope"]=="full";selected|=summary["scope"]=="selective";}
        assert!(full&&selected);
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
    #[test]fn timeout_cleans_up_owned_descendant(){
        let path=std::env::temp_dir().join(format!("workproof-image-child-{}-{}.pid",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        #[cfg(windows)]let script="$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30' -WindowStyle Hidden -PassThru;[IO.File]::WriteAllText($env:WORKPROOF_TEST_CHILD_PID,[string]$p.Id);Start-Sleep -Seconds 30";
        #[cfg(unix)]let script="sleep 30 & echo $! > \"$WORKPROOF_TEST_CHILD_PID\"; wait";
        let mut command=helper(script);command.env("WORKPROOF_TEST_CHILD_PID",&path);
        let start=Instant::now();assert!(capture(command,5,4096).is_err());
        assert!(start.elapsed()<Duration::from_secs(9));
        let pid:u32=std::fs::read_to_string(&path).expect("descendant must have started before deadline").trim().parse().unwrap();
        let _=std::fs::remove_file(&path);
        #[cfg(windows)]{
            #[link(name="kernel32")]unsafe extern "system"{
                fn OpenProcess(access:u32,inherit:i32,pid:u32)->*mut std::ffi::c_void;
                fn WaitForSingleObject(handle:*mut std::ffi::c_void,milliseconds:u32)->u32;
                fn CloseHandle(handle:*mut std::ffi::c_void)->i32;
            }
            unsafe{let handle=OpenProcess(0x100000,0,pid);if !handle.is_null(){let status=WaitForSingleObject(handle,3000);CloseHandle(handle);assert_eq!(status,0,"owned descendant must terminate with the job");}}
        }
        #[cfg(unix)]{
            // A killed orphan may briefly remain as a zombie until its reaper
            // runs; it is no longer executing or holding inherited pipe ends.
            let deadline=Instant::now()+Duration::from_secs(3);
            loop{
                let output=Command::new("/bin/ps").args(["-o","stat=","-p",&pid.to_string()]).output().unwrap();
                let state=String::from_utf8_lossy(&output.stdout);
                if !output.status.success()||state.trim().is_empty()||state.trim_start().starts_with('Z'){break;}
                assert!(Instant::now()<deadline,"owned descendant is still running: {state}");
                std::thread::sleep(Duration::from_millis(30));
            }
        }
    }
}
