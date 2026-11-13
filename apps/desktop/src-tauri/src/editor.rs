use serde_json::{json, Value};
use tauri::WebviewWindow;
use workproof_engine::editor as store;

fn root(window:&WebviewWindow)->Result<std::path::PathBuf,String>{super::workbench_only(window)?;if !workproof_engine::snapshot()?.ready{return Err("记录服务正在准备，请稍后重试。".into());}workproof_engine::data_dir()}
#[tauri::command]
pub async fn editor_list(window:WebviewWindow)->Result<Value,String>{let dir=root(&window)?;tauri::async_runtime::spawn_blocking(move||store::list(&dir)).await.map_err(|_|"文档列表未能读取。")?}
#[tauri::command]
pub async fn editor_create(window:WebviewWindow,title:String,started:String,kind:String)->Result<Value,String>{let dir=root(&window)?;tauri::async_runtime::spawn_blocking(move||store::create(&dir,&title,&started,&kind)).await.map_err(|_|"文档未能创建。")?}
#[tauri::command]
pub async fn editor_load(window:WebviewWindow,id:String)->Result<Value,String>{let dir=root(&window)?;tauri::async_runtime::spawn_blocking(move||store::load(&dir,&id)).await.map_err(|_|"文档未能打开。")?}
#[tauri::command]
pub async fn editor_save(window:WebviewWindow,input:Value)->Result<Value,String>{let dir=root(&window)?;let input:store::Save=serde_json::from_value(input).map_err(|_|"本次保存内容不完整。")?;tauri::async_runtime::spawn_blocking(move||store::save(&dir,input)).await.map_err(|_|"文档未能保存，请重试。")?}
#[tauri::command]
pub async fn editor_version(window:WebviewWindow,id:String,revision:u64)->Result<Value,String>{let dir=root(&window)?;tauri::async_runtime::spawn_blocking(move||store::version(&dir,&id,revision)).await.map_err(|_|"历史版本未能读取。")?}
#[tauri::command]
pub async fn editor_history(window:WebviewWindow,id:String,after:Option<u64>,through:u64)->Result<Value,String>{let dir=root(&window)?;tauri::async_runtime::spawn_blocking(move||store::history(&dir,&id,after,through)).await.map_err(|_|"版本时间轴未能读取。")?}
#[tauri::command]
pub async fn editor_replay_frame(window:WebviewWindow,id:String,revision:u64)->Result<Value,String>{let dir=root(&window)?;tauri::async_runtime::spawn_blocking(move||store::replay_frame(&dir,&id,revision)).await.map_err(|_|"回放版本未能读取。")?}
#[tauri::command]
pub async fn editor_export(window:WebviewWindow,id:String,docx:Option<Vec<u8>>,markdown:Option<String>)->Result<Value,String>{
    let dir=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||{
        let extension=store::desktop_export_extension(&dir,&id,docx.is_some(),markdown.is_some())?;
        // Picker text is fixed: never interpolate a document name into shell code.
        let (filter,suggested)=if extension=="docx"{("Word 作品|*.docx","WorkProof.docx")}else{("Markdown 作品|*.md","WorkProof.md")};
        let Some(path)=super::c2pa::pick("导出作品与证书，请选择新的文件名",filter,true,suggested)?else{return Ok(json!({"cancelled":true}));};
        if !path.is_absolute()||!path.extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case(extension)){return Err(format!("请使用 .{extension} 文件名保存作品。"));}
        let certificate=path.with_extension(format!("{extension}.wproof"));
        let name=path.file_name().and_then(|s|s.to_str()).ok_or("文件名称无法读取。")?;
        let out=if let Some(md)=markdown.as_deref(){store::export_markdown(&dir,&id,name,md)?}else{store::export_artifact(&dir,&id,name,docx.as_deref())?};
        let proof=serde_json::to_vec_pretty(&out.proof).map_err(|_|"证书未能生成。")?;
        use std::io::Write;
        let mut artifact=std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_|"保存位置已有同名作品，或无法写入。请选择新的文件名。")?;
        let result=(||->Result<(),String>{
            let mut cert=std::fs::OpenOptions::new().write(true).create_new(true).open(&certificate).map_err(|_|"保存位置已有同名证书，或无法写入。请选择新的文件名。")?;
            let bytes=docx.as_deref().or_else(||markdown.as_deref().map(str::as_bytes)).unwrap_or(out.html.as_bytes());
            let written=(||{artifact.write_all(bytes)?;artifact.sync_all()?;cert.write_all(&proof)?;cert.sync_all()})().map_err(|_|"文件写入未完成，请检查磁盘空间后重试。".to_string());
            drop(cert);if written.is_err(){let _=std::fs::remove_file(&certificate);}written
        })();
        drop(artifact);if result.is_err(){let _=std::fs::remove_file(&path);}result?;
        Ok(json!({"file_name":name,"html":out.html,"fingerprint":out.proof.manifest.artifact_hash,"event_count":out.proof.manifest.event_count,"report":out.report,"saved":true}))
    }).await.map_err(|_|"作品与证书未能导出。")?
}

#[tauri::command]
pub async fn recording_limit(window: WebviewWindow) -> Result<Option<u64>, String> {
    let dir = root(&window)?;
    tauri::async_runtime::spawn_blocking(move || workproof_engine::recording_settings::load(&dir))
        .await.map_err(|_| "无法读取记录设置。")?
}

#[tauri::command]
pub async fn set_recording_limit(window: WebviewWindow, limit: Option<u64>) -> Result<(), String> {
    let dir = root(&window)?;
    tauri::async_runtime::spawn_blocking(move || workproof_engine::recording_settings::save(&dir, limit))
        .await.map_err(|_| "无法保存记录设置。")?
}

#[cfg(windows)]
fn office_registry() -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut command = std::process::Command::new("reg.exe");
    command.creation_flags(0x08000000);
    command
}

#[tauri::command]
pub async fn office_reconnect(window: WebviewWindow) -> Result<Value, String> {
    super::workbench_only(&window)?;
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(|| {
        let output = office_registry().args(["query", r"HKCU\Software\WorkProof", "/v", "OfficeReconnect"]).output()
            .map_err(|_| "无法读取 Office 重连设置。")?;
        let raw = String::from_utf8_lossy(&output.stdout);
        let packed = raw.lines().find_map(|line| {
            let (name, value) = line.split_once("REG_DWORD")?;
            if name.trim() != "OfficeReconnect" { return None; }
            u32::from_str_radix(value.trim().strip_prefix("0x")?, 16).ok()
        }).filter(|value| (1..=60).contains(&(value & 0xffff)) && (value >> 16) <= 10)
          .unwrap_or((3 << 16) | 5);
        Ok(json!({"seconds": packed & 0xffff, "attempts": packed >> 16}))
    }).await.map_err(|_| "无法读取 Office 重连设置。")?;
    #[cfg(not(windows))]
    Ok(Value::Null)
}

#[tauri::command]
pub async fn set_office_reconnect(window: WebviewWindow, seconds: u32, attempts: u32) -> Result<(), String> {
    super::workbench_only(&window)?;
    if !(1..=60).contains(&seconds) || attempts > 10 {
        return Err("重连间隔须为 1 至 60 秒，重试次数须为 0 至 10 次。".into());
    }
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || {
        let value = ((attempts << 16) | seconds).to_string();
        let status = office_registry().args(["add", r"HKCU\Software\WorkProof", "/v", "OfficeReconnect", "/t", "REG_DWORD", "/d", &value, "/f"])
            .output().map_err(|_| "无法保存 Office 重连设置。")?;
        if status.status.success() { Ok(()) } else { Err("无法保存 Office 重连设置。".into()) }
    }).await.map_err(|_| "无法保存 Office 重连设置。")?;
    #[cfg(not(windows))]
    Err("当前平台不支持原生 Office 重连设置。".into())
}
