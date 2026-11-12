use std::{io::Write,path::{Path,PathBuf}};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use md5::Md5;
use tauri::WebviewWindow;

fn write_bundle(path:&Path,html:&[u8],certificate_id:&str)->Result<Value,String>{
    let name=path.file_name().and_then(|name|name.to_str()).filter(|name|!name.chars().any(char::is_control)).ok_or("请使用不含控制字符的报告文件名。")?;
    if !path.is_absolute()||!path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("html")){return Err("请使用 .html 文件名保存报告。".into());}
    let md5=format!("{:x}",Md5::digest(html));let sha256=format!("{:x}",Sha256::digest(html));
    let append=|suffix:&str|{let mut name=path.as_os_str().to_os_string();name.push(suffix);PathBuf::from(name)};
    let md5_path=append(".md5");let sha_path=append(".sha256");let manifest_path=append(".report.json");
    let md5_text=format!("{md5}  {name}\n");let sha_text=format!("{sha256}  {name}\n");
    let manifest=serde_json::to_vec_pretty(&json!({"schema":"workproof-report-files/1","file":name,"bytes":html.len(),"md5":md5,"sha256":sha256,"source_certificate_id":certificate_id})).map_err(|_|"报告关联清单未能生成。")?;
    let entries=[(path,html),(md5_path.as_path(),md5_text.as_bytes()),(sha_path.as_path(),sha_text.as_bytes()),(manifest_path.as_path(),manifest.as_slice())];
    let mut created:Vec<PathBuf>=vec![];
    let result=(||->Result<(),String>{
        for (target,bytes) in entries{
            let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|_|"报告或配套校验文件已存在，或保存位置无法写入。请使用新的文件名。")?;
            created.push(target.to_path_buf());file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|_|"报告未能完整写入，请检查磁盘空间。")?;
        }Ok(())
    })();
    if let Err(error)=result{for target in created{let _=std::fs::remove_file(target);}return Err(error);}
    Ok(json!({"cancelled":false,"file_name":name,"md5":md5,"sha256":sha256,"bytes":html.len(),"source_certificate_id":certificate_id}))
}

#[tauri::command]
pub async fn save_report(window:WebviewWindow,html:String,certificate_id:String)->Result<Value,String>{
    super::workbench_only(&window)?;
    if html.len()>128*1024*1024||!html.starts_with("<!doctype html>")||!html.contains("workproof-encrypted-report/1")||certificate_id.len()!=64||!certificate_id.bytes().all(|byte|byte.is_ascii_hexdigit()){
        return Err("加密报告不完整或超过 128 MB，请重新生成。".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        let Some(path)=super::c2pa::pick("保存加密核验报告及校验文件，请选择新的文件名","加密 HTML 报告|*.html",true,"WorkProof-report.html")?else{return Ok(json!({"cancelled":true}));};
        write_bundle(&path,html.as_bytes(),&certificate_id)
    }).await.map_err(|_|"报告保存任务未能完成，请重新尝试。")?
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn report_digests_cover_exact_html_and_sidecar_collisions_preserve_existing_files(){
        let root=std::env::temp_dir().join(format!("workproof-report-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&root).unwrap();
        let path=root.join("报告.html");let bytes=b"<!doctype html>workproof-encrypted-report/1";
        let result=write_bundle(&path,bytes,&"a".repeat(64)).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(),bytes);assert_eq!(result["md5"],format!("{:x}",Md5::digest(bytes)));
        let manifest:Value=serde_json::from_slice(&std::fs::read(root.join("报告.html.report.json")).unwrap()).unwrap();assert_eq!(manifest["sha256"],format!("{:x}",Sha256::digest(bytes)));assert_eq!(manifest["source_certificate_id"],"a".repeat(64));
        let conflict=root.join("conflict.html");std::fs::write(root.join("conflict.html.md5"),b"keep existing checksum").unwrap();
        assert!(write_bundle(&conflict,bytes,&"a".repeat(64)).is_err());assert!(!conflict.exists());assert_eq!(std::fs::read(root.join("conflict.html.md5")).unwrap(),b"keep existing checksum");
        assert!(root.is_absolute()&&root.starts_with(std::env::temp_dir()));std::fs::remove_dir_all(root).unwrap();
    }
}
