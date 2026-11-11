use std::path::{Path,PathBuf};
use serde_json::Value;
use tauri::WebviewWindow;
use workproof_engine::catalog;

fn root(window:&WebviewWindow)->Result<PathBuf,String>{
    super::workbench_only(window)?;
    if !workproof_engine::snapshot()?.ready{return Err("记录服务正在准备，请稍后重试。".into());}
    workproof_engine::data_dir()
}

fn opens_as_document(path:&Path)->bool{
    let Some(extension)=path.extension().and_then(|value|value.to_str())else{return false;};
    matches!(extension.to_ascii_lowercase().as_str(),"doc"|"docx"|"docm"|"dotx"|"dotm"|"rtf"|"odt"|"wps"|"wpt"|"ppt"|"pptx"|"pptm"|"pps"|"ppsx"|"potx"|"pdf"|"txt"|"md"|"markdown"|"psd"|"psb"|"blend"|"png"|"jpg"|"jpeg"|"webp"|"gif"|"bmp"|"tif"|"tiff")
}

fn annotate(document:&catalog::ExternalDocument)->Result<Value,String>{
    let mut value=serde_json::to_value(document).map_err(|_|"无法显示文档信息。")?;
    let path=document.local_path.as_deref().map(Path::new);
    let available=path.is_some_and(|path|path.is_absolute()&&path.is_file());
    let can_open=available&&path.is_some_and(opens_as_document);
    value["file_available"]=available.into();value["can_open"]=can_open.into();
    Ok(value)
}

#[tauri::command]
pub async fn external_documents_list(window:WebviewWindow)->Result<Value,String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||{
        catalog::list(&root)?.iter().map(annotate).collect::<Result<Vec<_>,_>>().map(Value::from)
    }).await.map_err(|_|"无法读取外部文档列表。")?
}

#[tauri::command]
pub async fn external_document_load(window:WebviewWindow,id:String,before_seq:Option<u64>,limit:Option<usize>)->Result<Value,String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||{
        let history=catalog::load(&root,&id,before_seq,limit.unwrap_or(200))?;
        let document=annotate(&history.document)?;
        let mut value=serde_json::to_value(history).map_err(|_|"无法显示创作记录。")?;
        value["document"]=document;Ok(value)
    }).await.map_err(|_|"无法读取创作记录。")?
}

#[tauri::command]
pub async fn external_document_locate(window:WebviewWindow,id:String)->Result<Value,String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||{
        let history=catalog::load(&root,&id,None,1)?;
        let filter=match history.document.source.as_str(){
            "word"|"wps"=>"文档作品|*.doc;*.docx;*.docm;*.odt;*.rtf;*.wps",
            "powerpoint"=>"演示文稿|*.ppt;*.pptx;*.pptm;*.pps;*.ppsx",
            "photoshop"=>"设计作品|*.psd;*.psb;*.png;*.jpg;*.jpeg;*.webp",
            "blender"=>"Blender 工程|*.blend",
            _=>"作品文件|*.*",
        };
        let Some(path)=super::c2pa::pick("定位原文件，仅更新本机文件位置",filter,false,"")?else{return Ok(serde_json::json!({"cancelled":true}));};
        let document=catalog::locate(&root,&id,&path)?;
        Ok(serde_json::json!({"cancelled":false,"document":annotate(&document)?}))
    }).await.map_err(|_|"文件位置未更新，请重试。")?
}

#[tauri::command]
pub async fn external_document_open(window:WebviewWindow,id:String)->Result<(),String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||{
        let history=catalog::load(&root,&id,None,1)?;
        let path=PathBuf::from(history.document.local_path.ok_or("这份记录未保存文件位置，请在原应用中打开作品。")?);
        if !path.is_absolute()||!opens_as_document(&path){return Err("请在原应用中打开此类文件。".into());}
        let resolved=path.canonicalize().map_err(|_|"文件已移动、改名或当前无法访问，请在原应用中打开。")?;
        if !resolved.is_file()||!opens_as_document(&resolved){return Err("请在原应用中打开此类文件。".into());}
        super::platform::open_document(&path)
    }).await.map_err(|_|"无法打开原文件，请在原应用中打开。")?
}

#[cfg(test)]
mod embedded_tests{
    use super::*;
    #[test]
    fn workbench_permissions_cover_the_external_library(){
        let permissions=include_str!("../permissions/workbench.toml");
        for command in ["external_documents_list","external_document_load","external_document_locate","external_document_open","external_document_read","library_states","library_set_state","library_delete"]{
            assert!(permissions.contains(&format!("\"{command}\"")),"Missing workbench permission: {command}");
        }
    }
    #[test]
    fn document_opening_excludes_programs_and_shortcuts(){
        for path in ["report.DOCX","slides.pptx","drawing.psd","model.blend","notes.md"]{assert!(opens_as_document(Path::new(path)));}
        for path in ["app.exe","file.docx.lnk","script.js","script.ps1","script.bat","site.url","file"]{assert!(!opens_as_document(Path::new(path)));}
    }
}

#[tauri::command]
pub async fn library_states(window:WebviewWindow)->Result<Value,String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||workproof_engine::library_state::list(&root)).await.map_err(|_|"无法读取文档状态。")?
}
#[tauri::command]
pub async fn library_delete(window:WebviewWindow,kind:String,ids:Vec<String>)->Result<Value,String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||workproof_engine::library_state::delete(&root,&kind,&ids)).await.map_err(|_|"删除未能完成，请重试。")?
}
#[tauri::command]
pub async fn library_set_state(window:WebviewWindow,kind:String,ids:Vec<String>,state:String)->Result<Value,String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||workproof_engine::library_state::set(&root,&kind,&ids,&state)).await.map_err(|_|"无法更新文档状态。")?
}

#[tauri::command]
pub async fn external_document_read(window:WebviewWindow,id:String)->Result<Value,String>{
    let root=root(&window)?;
    tauri::async_runtime::spawn_blocking(move||{
        use std::io::Read;
        let document=catalog::load(&root,&id,None,1)?.document;
        let path=PathBuf::from(document.local_path.ok_or("请先定位原文件。")?);
        if !path.is_absolute(){return Err("原文件位置无效。".into());}
        let path=path.canonicalize().map_err(|_|"原文件已移动，请重新定位。")?;
        let extension=path.extension().and_then(|value|value.to_str()).unwrap_or("").to_ascii_lowercase();
        let limit=match extension.as_str(){
            "docx"=>8*1024*1024,
            "md"|"markdown"|"txt"=>512*1024,
            _=>return Err("此文件请使用原应用打开。".into()),
        };
        let file=std::fs::File::open(&path).map_err(|_|"无法读取原文件，请检查文件权限。")?;
        let before=file.metadata().map_err(|_|"无法读取文件信息。")?;
        if !before.is_file()||before.len()>limit{return Err("文件超过导入范围。".into());}
        let mut bytes=Vec::new();
        file.take(limit+1).read_to_end(&mut bytes).map_err(|_|"原文件读取失败。")?;
        let after=path.metadata().map_err(|_|"原文件在读取期间发生变化。")?;
        if bytes.len() as u64>limit||before.len()!=bytes.len() as u64||before.len()!=after.len()||before.modified().ok()!=after.modified().ok(){
            return Err("原文件在读取期间发生变化，请重试。".into());
        }
        Ok(serde_json::json!({"name":path.file_name().and_then(|name|name.to_str()).unwrap_or("文档"),"bytes":bytes}))
    }).await.map_err(|_|"读取原文件失败。")?
}
