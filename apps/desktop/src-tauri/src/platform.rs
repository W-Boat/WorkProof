use std::{path::{Path,PathBuf},process::{Child,Command,Stdio},time::{Duration,Instant}};

fn quiet(command:&mut Command){
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
}
// This fixed script is only invoked by the user's explicit desktop button. No
// document path, document metadata or web input is interpolated as PowerShell.
#[cfg(windows)]
const WORD_LAUNCH_SCRIPT:&str=r#"
$ErrorActionPreference='Stop'
try {
  try {$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')}
  catch {$word=New-Object -ComObject Word.Application}
  $word.Visible=$true
  if ($word.Documents.Count -eq 0) {[void]$word.Documents.Add()}
  $word.Activate()
  try {$addin=$word.COMAddIns.Item('WorkProof.WordNative.Connect'); $addin.Connect=$true}
  catch {exit 20}
  $until=[DateTime]::UtcNow.AddSeconds(20)
  do {
    try {$bridge=$addin.Object} catch {$bridge=$null}
    if ($null -ne $bridge) {break}
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $until)
  if ($null -eq $bridge) {exit 21}
  try {[void]$bridge.LaunchRecording()} catch {exit 22}
  exit 0
} catch {exit 23}
"#;

pub fn open_word()->Result<(),String>{
    #[cfg(not(windows))]
    {Err("直接打开 Word 目前支持 Windows 桌面版。其他系统请在 Word 中打开 WorkProof 加载项。".into())}
    #[cfg(windows)]
    {
        let root=std::env::var_os("SystemRoot").ok_or("无法定位 Windows 系统目录。")?;
        let mut command=Command::new(PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
        command.args(["-NoLogo","-NoProfile","-NonInteractive","-STA","-Command",WORD_LAUNCH_SCRIPT]);
        quiet(&mut command);
        let mut child=command.spawn().map_err(|_|"无法打开 Word，请确认 Windows PowerShell 可用。")?;
        let deadline=Instant::now()+Duration::from_secs(45);
        loop {
            match child.try_wait(){
                Ok(Some(status))=>return match status.code(){
                    Some(0)=>Ok(()),
                    Some(20)|Some(21)=>Err("Word 已打开，但没有加载 WorkProof。请先运行安装包中的 Install Word.cmd，再保存文档并重新打开 Word。".into()),
                    Some(22)=>Err("Word 中的 WorkProof 版本不支持直接开始，请更新完整安装包。".into()),
                    _=>Err("Word 未能接受请求。请关闭 Word 中的对话框，再重试；也请确认已安装桌面版 Word。".into())
                },
                Err(_)=>return Err("无法确认 Word 的启动结果，请在 Word 中查看 WorkProof 侧栏。".into()),
                _ if Instant::now()>=deadline=>{
                    // Kill only the automation helper: never close the user's Word.
                    let _=child.kill();let _=child.wait();
                    return Err("Word 响应较慢。请关闭 Word 中的对话框，并查看 WorkProof 侧栏是否已开始记录。".into());
                },
                _=>std::thread::sleep(Duration::from_millis(100))
            }
        }
    }
}
fn browser_command(port:u16)->Result<Command,String>{
    if port==0{return Err("核验页面尚未就绪，请稍后重试。".into());}
    let url=format!("http://127.0.0.1:{port}/");
    #[cfg(windows)]let mut command={let mut c=Command::new("rundll32.exe");c.arg("url.dll,FileProtocolHandler");c};
    #[cfg(target_os="macos")]let mut command=Command::new("/usr/bin/open");
    #[cfg(target_os="linux")]let mut command=Command::new("xdg-open");
    command.arg(url);quiet(&mut command);Ok(command)
}
pub fn open_verifier(port:u16)->Result<(),String>{
    let mut child=browser_command(port)?.spawn().map_err(|_|"无法打开默认浏览器，请检查系统的默认浏览器设置。".to_string())?;
    let until=Instant::now()+Duration::from_millis(300);
    loop{
        match child.try_wait(){
            Ok(Some(status))=>return if status.success(){Ok(())}else{Err("系统未能打开核验页，请检查默认浏览器设置。".into())},
            Err(_)=>return Err("无法读取浏览器启动结果，请重试。".into()),
            Ok(None) if Instant::now()>=until=>{
                // Some desktop launchers wait for the browser. Do not kill the user's browser.
                std::thread::spawn(move||{let _=child.wait();});return Ok(());
            },
            _=>std::thread::sleep(Duration::from_millis(20)),
        }
    }
}
fn vscode_candidates()->Vec<PathBuf>{
    #[cfg(windows)]let mut paths=vec![PathBuf::from("code.cmd")];
    #[cfg(not(windows))]let mut paths=vec![PathBuf::from("code")];
    #[cfg(windows)]{
        for (key,suffix) in [("LOCALAPPDATA","Programs/Microsoft VS Code/bin/code.cmd"),("PROGRAMFILES","Microsoft VS Code/bin/code.cmd")]{
            if let Some(root)=std::env::var_os(key){paths.push(PathBuf::from(root).join(suffix));}
        }
    }
    #[cfg(target_os="macos")]{
        let suffix="Visual Studio Code.app/Contents/Resources/app/bin/code";
        paths.push(PathBuf::from("/Applications").join(suffix));
        if let Some(home)=std::env::var_os("HOME"){paths.push(PathBuf::from(home).join("Applications").join(suffix));}
    }
    paths
}
fn installer(program:&Path,vsix:&Path)->Command{
    let mut command=Command::new(program);command.arg("--install-extension").arg(vsix).arg("--force");quiet(&mut command);command
}
fn wait_install(mut child:Child)->Result<(),String>{
    let deadline=Instant::now()+Duration::from_secs(60);
    loop{
        match child.try_wait(){
            Ok(Some(status))=>return if status.success(){Ok(())}else{Err("VS Code 没有完成插件安装。请关闭其他安装任务后重试，或在 VS Code 中手动安装 VSIX。".into())},
            Err(_)=>return Err("无法读取插件安装结果，请重试。".into()),
            _ if Instant::now()>=deadline=>{let _=child.kill();let _=child.wait();return Err("插件安装超过一分钟。请在 VS Code 中检查结果，或手动安装 VSIX。".into());},
            _=>std::thread::sleep(Duration::from_millis(100)),
        }
    }
}
pub fn install_vscode(vsix:&Path)->Result<(),String>{
    if !vsix.is_file(){return Err("安装文件不完整，请重新下载 WorkProof 安装包。".into());}
    for candidate in vscode_candidates(){
        match installer(&candidate,vsix).spawn(){
            Ok(child)=>return wait_install(child),
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>continue,
            Err(_)=>return Err("无法启动 VS Code，请确认它已安装且可以打开。".into()),
        }
    }
    Err("没有找到 VS Code。请先安装 VS Code；Mac 也可安装在“应用程序”文件夹。".into())
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn browser_only_opens_a_local_port(){
        assert!(browser_command(0).is_err());
        let c=browser_command(4173).unwrap();let args:Vec<_>=c.get_args().collect();assert_eq!(args.last().unwrap(),&"http://127.0.0.1:4173/");
        #[cfg(windows)]assert_eq!(c.get_program(),"rundll32.exe");
        #[cfg(target_os="macos")]assert_eq!(c.get_program(),"/usr/bin/open");
        #[cfg(target_os="linux")]assert_eq!(c.get_program(),"xdg-open");
    }
    #[test]fn install_path_is_one_literal_argument(){
        let p=Path::new("a path with spaces & dollar$.vsix");let c=installer(Path::new("code"),p);let args:Vec<_>=c.get_args().collect();
        assert_eq!(args,vec![std::ffi::OsStr::new("--install-extension"),p.as_os_str(),std::ffi::OsStr::new("--force")]);
    }
    #[test]fn failed_install_is_not_reported_as_success(){
        let exe=std::env::current_exe().unwrap();let mut command=Command::new(exe);command.arg("--not-a-real-test-runner-option");quiet(&mut command);
        assert!(wait_install(command.spawn().unwrap()).is_err());
    }
}
