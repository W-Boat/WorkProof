use std::io::Write;
use tauri::{Url, WebviewWindow};

fn manifest(input: &str) -> Result<String, String> {
    if input.len() > 2048 { return Err("机构地址过长。".into()); }
    let url = Url::parse(input.trim()).map_err(|_| "请输入有效的机构 HTTPS 地址。")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty()
        || url.password().is_some() || url.path() != "/" || url.query().is_some() || url.fragment().is_some()
    {
        return Err("请输入机构站点的 HTTPS 根地址，不含路径、参数或账号。".into());
    }
    let origin = url.origin().ascii_serialization().replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\"', "&quot;");
    Ok(include_str!("../../../office/manifest-excel.template.xml")
        .replace("__WORKPROOF_HTTPS_ORIGIN__", &origin))
}

#[tauri::command]
pub async fn save_excel_manifest(window: WebviewWindow, origin: String) -> Result<bool, String> {
    super::workbench_only(&window)?;
    let xml = manifest(&origin)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = super::c2pa::pick("保存 Excel 加载项清单", "Excel 加载项清单|*.xml", true, "WorkProof-Excel.xml")?
            else { return Ok(false); };
        if !path.is_absolute() || !path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("xml")) {
            return Err("请使用 .xml 文件名保存 Excel 加载项清单。".into());
        }
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|_| "该文件已存在或无法写入，请选择新的文件名。")?;
        let result = file.write_all(xml.as_bytes()).and_then(|_| file.sync_all());
        drop(file);
        if result.is_err() {
            let _ = std::fs::remove_file(path);
            return Err("Excel 加载项清单未能完整保存。".into());
        }
        Ok(true)
    }).await.map_err(|_| "Excel 加载项清单保存未完成。")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_uses_only_an_https_institution_origin() {
        let xml = manifest("https://office.example:8443/").unwrap();
        assert!(xml.contains("https://office.example:8443/office/index.html?host=excel"));
        assert!(xml.contains("Host Name=\"Workbook\""));
        for invalid in ["http://office.example", "https://user@office.example", "https://office.example/other",
                        "https://office.example/?x=1", "https://office.example/#section", "file:///example"] {
            assert!(manifest(invalid).is_err(), "{invalid}");
        }
    }
}
