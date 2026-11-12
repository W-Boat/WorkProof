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

fn write_certificate(path:&Path,bytes:&[u8],certificate_id:&str,sha256:&str)->Result<Value,String>{
    if bytes.is_empty()||bytes.len()>32*1024*1024||format!("{:x}",Sha256::digest(bytes))!=sha256{return Err("原始证书数据不完整，请重新核验后保存。".into());}
    let value:Value=serde_json::from_slice(bytes).map_err(|_|"原始证书不是有效的 JSON 文件。")?;
    let signature=value["signature"].as_str().filter(|s|s.len()==128&&s.bytes().all(|b|b.is_ascii_hexdigit())).ok_or("原始证书缺少签名。")?;
    let signature:Vec<u8>=signature.as_bytes().chunks_exact(2).map(|pair|u8::from_str_radix(std::str::from_utf8(pair).unwrap(),16).unwrap()).collect();
    if format!("{:x}",Sha256::digest(&signature))!=certificate_id{return Err("原文件与已核验的证书指纹不一致，请重新核验。".into());}
    if !path.is_absolute()||!path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("wproof")){return Err("请使用 .wproof 文件名保存证书。".into());}
    let name=path.file_name().and_then(|s|s.to_str()).filter(|s|!s.chars().any(char::is_control)).ok_or("请使用有效的证书文件名。")?;
    let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_|"文件已存在或无法写入，请选择新的文件名。")?;
    let result=file.write_all(bytes).and_then(|_|file.sync_all());drop(file);
    if result.is_err(){let _=std::fs::remove_file(path);return Err("证书未能完整保存，请检查磁盘空间。".into());}
    Ok(json!({"cancelled":false,"file_name":name,"bytes":bytes.len(),"sha256":sha256,"source_certificate_id":certificate_id}))
}

#[tauri::command]
pub async fn save_certificate(window:WebviewWindow,certificate:Vec<u8>,certificate_id:String,sha256:String)->Result<Value,String>{
    super::workbench_only(&window)?;
    if certificate.is_empty()||certificate.len()>32*1024*1024{return Err("证书超过保存范围（最多 32 MB）。".into());}
    if [&certificate_id,&sha256].iter().any(|value|value.len()!=64||!value.bytes().all(|byte|byte.is_ascii_hexdigit())){return Err("原始证书摘要不完整，请重新核验后保存。".into());}
    tauri::async_runtime::spawn_blocking(move||{
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"系统时间无效。")?.as_secs();
        let suggested=format!("WorkProof-certificate-{stamp}.wproof");
        let Some(path)=super::c2pa::pick("保存原始证书（请选择新的文件名）","WorkProof 证书|*.wproof",true,&suggested)?else{return Ok(json!({"cancelled":true}));};
        write_certificate(&path,&certificate,&certificate_id,&sha256)
    }).await.map_err(|_|"原始证书保存任务未能完成，请重试。")?
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
    #[test]fn certificate_save_preserves_original_bytes_and_rejects_mismatches_and_existing_files(){
        let root=std::env::temp_dir().join(format!("workproof-certificate-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&root).unwrap();
        let path=root.join("original.wproof");let bytes=format!(" {{\n  \"signature\": \"{}\", \"extra\": \"preserve whitespace\"\n}}\n","00".repeat(64)).into_bytes();
        let id=format!("{:x}",Sha256::digest([0u8;64]));let hash=format!("{:x}",Sha256::digest(&bytes));
        assert!(write_certificate(&path,&bytes,&"f".repeat(64),&hash).is_err());assert!(!path.exists());
        assert!(write_certificate(&path,&bytes,&id,&"f".repeat(64)).is_err());assert!(!path.exists());
        let result=write_certificate(&path,&bytes,&id,&hash).unwrap();assert_eq!(std::fs::read(&path).unwrap(),bytes);assert_eq!(result["sha256"],hash);assert_eq!(result["source_certificate_id"],id);
        assert!(write_certificate(&path,&bytes,&id,&hash).is_err());assert_eq!(std::fs::read(&path).unwrap(),bytes);
        assert!(root.is_absolute()&&root.starts_with(std::env::temp_dir()));std::fs::remove_dir_all(root).unwrap();
    }
}
