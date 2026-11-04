use std::{path::PathBuf,process::{Command,Stdio}};
fn quiet(command:&mut Command){
 command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
 #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
}
pub fn office_setup(host:&str,install:bool)->Result<serde_json::Value,String>{
    if !matches!(host,"word"|"powerpoint"){return Err("请选择 Word 或 PowerPoint。".into());}
    static SETUP:std::sync::Mutex<()>=std::sync::Mutex::new(());
    let _guard=SETUP.try_lock().map_err(|_|"另一个安装或检查任务正在进行，请稍候再试。")?;
    #[cfg(not(windows))]
    {let _=install;Err("原生加载项自动安装目前支持 Windows Word 和 PowerPoint。".into())}
    #[cfg(windows)]
    {
        let exe=std::env::current_exe().map_err(|_|"无法定位当前安装目录。")?;
        let directory=exe.parent().ok_or("无法定位当前安装目录。")?;
        let nested=directory.join("office/desktop-office-setup.ps1");
        let script=if nested.is_file(){nested}else{directory.join("desktop-office-setup.ps1")};
        if !script.is_file(){return Err("当前安装缺少 Office 配置工具。请使用包含 Word/PPT 加载项的完整配套包。".into());}
        let root=std::env::var_os("SystemRoot").ok_or("无法定位 Windows 系统目录。")?;
        let mut command=Command::new(PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
        command.args(["-NoLogo","-NoProfile","-NonInteractive","-File"]).arg(script)
            .args(["-HostName",if host=="word"{"Word"}else{"PowerPoint"}]);
        if install{command.arg("-Install");}
        quiet(&mut command);command.stdout(Stdio::piped());
        let mut child=command.spawn().map_err(|_|"无法运行 Office 配置工具。")?;
        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(120);
        loop{
            if child.try_wait().map_err(|_|"无法读取安装任务状态。")?.is_some(){break;}
            if std::time::Instant::now()>=deadline{
                let _=child.kill();let _=child.wait();
                return Err("安装超过两分钟，请重新检查安装状态后再试。".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let output=child.wait_with_output().map_err(|_|"无法读取安装任务结果。")?;
        if output.stdout.len()>65536{return Err("安装返回内容异常，请重新检查安装状态。".into());}
        let value:serde_json::Value=serde_json::from_slice(&output.stdout).map_err(|_|"安装未能返回有效状态，请检查完整包和 PowerShell 设置。")?;
        if !output.status.success(){return Err(value.get("error").and_then(|v|v.as_str()).unwrap_or("安装未完成，请重新检查安装状态。").into());}
        Ok(value)
    }
}
