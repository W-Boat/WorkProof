//! Shared strict C2PA/WorkProof verification for native CLI and optional browser Wasm.
use std::io::Cursor;
use c2pa::{Context,Reader,validation_results::ValidationState};
use serde::{Deserialize,Serialize};
use serde_json::json;
use workproof_protocol::{Evidence,Report,digest,verify_evidence};
mod jpeg;
pub mod pdf;

pub type Result<T> = std::result::Result<T,Box<dyn std::error::Error>>;
// Keep the assertion base label unversioned; the SDK normalizes .vN suffixes.
pub const LABEL:&str="org.workproof.process";
const PNG:&[u8]=b"\x89PNG\r\n\x1a\n";
pub const IMAGE_LIMIT:usize=96*1024*1024;
pub const PROOF_LIMIT:usize=8*1024*1024;
pub fn format(data:&[u8])->Result<(&'static str,&'static str)>{
    if data.starts_with(PNG){Ok(("image/png","png-remove-cabx-v1"))}
    else if data.starts_with(&[0xff,0xd8]){Ok(("image/jpeg","jpeg-remove-c2pa-app11-v1"))}
    else if data.starts_with(b"%PDF-"){Ok(("application/pdf","pdf-strict-incremental-v1"))}
    else{Err("UNSUPPORTED_IMAGE_FORMAT".into())}
}
pub fn original_image(data:&[u8])->Result<(Vec<u8>,usize)>{
    match format(data)?.0{"image/png"=>original_png(data),"image/jpeg"=>jpeg::original_jpeg(data),_=>Err("PDF_REQUIRES_SIGNED_ORIGINAL_LENGTH".into())}
}

#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding{pub schema:String,pub normalization:String,pub certificate_json:String,
    #[serde(default,skip_serializing_if="Option::is_none")] pub original_length:Option<u64>}

/// Remove only C2PA caBX chunks, preserving every other original byte, including CRCs.
fn original_png(data:&[u8])->Result<(Vec<u8>,usize)>{
    if !data.starts_with(PNG)||data.len()>IMAGE_LIMIT{return Err("INVALID_PNG".into());}
    let mut original=PNG.to_vec();let mut pos=8usize;let mut cabx=0;let mut chunks=0;
    let mut ihdr=false;let mut idat=false;let mut ended=false;
    while pos<data.len(){
        chunks+=1;if chunks>4096||pos+12>data.len(){return Err("INVALID_PNG_CHUNKS".into());}
        let len=u32::from_be_bytes(data[pos..pos+4].try_into()?) as usize;
        let end=pos.checked_add(12).and_then(|v|v.checked_add(len)).ok_or("INVALID_PNG_LENGTH")?;
        if end>data.len(){return Err("INVALID_PNG_LENGTH".into());}
        let kind=&data[pos+4..pos+8];
        if !kind.iter().all(u8::is_ascii_alphabetic){return Err("INVALID_PNG_TYPE".into());}
        let crc=u32::from_be_bytes(data[end-4..end].try_into()?);
        if crc32fast::hash(&data[pos+4..end-4])!=crc{return Err("INVALID_PNG_CRC".into());}
        match kind{
            b"IHDR"=>{if ihdr||chunks!=1||len!=13{return Err("INVALID_PNG_HEADER".into());}ihdr=true;},
            b"IDAT"=>{if !ihdr{return Err("INVALID_PNG_HEADER".into());}idat=true;},
            b"IEND"=>{if len!=0||end!=data.len()||!idat{return Err("INVALID_PNG_END".into());}ended=true;},
            b"caBX"=>cabx+=1,
            _=>{},
        }
        if kind!=b"caBX"{original.extend_from_slice(&data[pos..end]);}
        pos=end;
    }
    if !ihdr||!ended{return Err("INVALID_PNG".into());}Ok((original,cabx))
}

pub fn context(roots:Option<&str>)->Result<Context>{
    let mut settings=json!({
        "verify":{"verify_after_reading":true,"verify_after_sign":true,"ocsp_fetch":false,"remote_manifest_fetch":false},
        "core":{"decode_identity_assertions":false,"allowed_network_hosts":[],"allow_redirects":false,"max_decompressed_manifest_size_in_mb":32}
    });
    if let Some(pem)=roots{
        settings["trust"]=json!({"anchors":[{"trust_anchors":pem,"trust_kind":"manifest"}]});
    }
    Context::new().with_settings(settings.to_string()).map_err(|_|"INVALID_C2PA_SETTINGS".into())
}

pub fn proof_report(certificate:&str,original:&[u8])->Result<Report>{
    if certificate.len()>PROOF_LIMIT{return Err("PROOF_TOO_LARGE".into());}
    let evidence:Evidence=serde_json::from_str(certificate).map_err(|_|"INVALID_WORKPROOF_JSON")?;
    let report=verify_evidence(&evidence,&digest(original),original.len() as u64);
    if !report.valid{return Err("WORKPROOF_OR_ORIGINAL_ASSET_MISMATCH".into());}Ok(report)
}

pub fn inspect(data:&[u8],roots:Option<&str>)->Result<(Report,bool)>{
    if data.len()>IMAGE_LIMIT{return Err("INPUT_TOO_LARGE".into());}
    let (mime,normalization)=format(data)?;
    if mime=="application/pdf"{pdf::preflight(data)?;}
    let image_original=if mime!="application/pdf"{
        let (original,count)=original_image(data)?;
        if count==0{return Err("C2PA_MANIFEST_REQUIRED".into());}Some(original)
    }else{None};
    let reader=Reader::from_context(context(roots)?).with_stream(mime,Cursor::new(data))
        .map_err(|_|"C2PA_READ_FAILED")?;
    finish(data,roots.is_some(),reader,mime,normalization,image_original)
}

fn finish(data:&[u8],require_trust:bool,reader:Reader,mime:&str,normalization:&str,image_original:Option<Vec<u8>>)->Result<(Report,bool)>{
    let state=reader.validation_state();
    if state==ValidationState::Invalid{return Err("C2PA_INTEGRITY_FAILED".into());}
    let trusted=state==ValidationState::Trusted;
    if require_trust&&!trusted{
        // Report SDK status codes for platform diagnostics without emitting
        // certificate assertions, asset contents or any private key material.
        if let Some(statuses)=reader.validation_status(){
            for status in statuses{eprintln!("C2PA validation status: {}",status.code());}
        }
        return Err("C2PA_EXPLICIT_CA_TRUST_FAILED".into());
    }
    let manifest=reader.active_manifest().ok_or("C2PA_MANIFEST_MISSING")?;
    let assertions:Vec<_>=manifest.assertions().iter().filter(|a|a.label()==LABEL).collect();
    if assertions.len()!=1{return Err("EXACTLY_ONE_WORKPROOF_ASSERTION_REQUIRED".into());}
    let binding:Binding=assertions[0].to_assertion().map_err(|_|"INVALID_WORKPROOF_ASSERTION")?;
    if binding.normalization!=normalization{return Err("UNSUPPORTED_WORKPROOF_BINDING".into());}
    let original=if mime=="application/pdf"{
        if binding.schema!="workproof-c2pa/2"{return Err("UNSUPPORTED_WORKPROOF_BINDING".into());}
        pdf::original(data,binding.original_length.ok_or("PDF_ORIGINAL_LENGTH_REQUIRED")?)?
    }else{
        if binding.schema!="workproof-c2pa/1"||binding.original_length.is_some(){return Err("UNSUPPORTED_WORKPROOF_BINDING".into());}
        image_original.ok_or("ORIGINAL_IMAGE_REQUIRED")?
    };
    Ok((proof_report(&binding.certificate_json,&original)?,trusted))
}


/// Browser entry point: signatures, asset binding, explicit CA and WorkProof all pass.
pub async fn verify_embedded_async(data:&[u8],roots:&str)->Result<String>{
    if data.len()>IMAGE_LIMIT{return Err("INPUT_TOO_LARGE".into());}
    if roots.is_empty()||roots.len()>256*1024{return Err("EXPLICIT_CA_REQUIRED".into());}
    let (mime,normalization)=format(data)?;
    if mime=="application/pdf"{pdf::preflight(data)?;}
    let image_original=if mime!="application/pdf"{
        let (original,count)=original_image(data)?;
        if count==0{return Err("C2PA_MANIFEST_REQUIRED".into());}Some(original)
    }else{None};
    let reader=Reader::from_context(context(Some(roots))?).with_stream_async(mime,Cursor::new(data)).await
        .map_err(|_|"C2PA_READ_FAILED")?;
    let (report,trusted)=finish(data,true,reader,mime,normalization,image_original)?;
    Ok(report_json(report,trusted,mime).to_string())
}
pub fn report_json(report:Report,trusted:bool,mime:&str)->serde_json::Value{
    json!({"protocol":"workproof-c2pa-report/1","c2pa_integrity_valid":true,"c2pa_trusted":trusted,
        "trust_policy":if trusted{"explicit-ca-file"}else{"not-verified"},"original_png_checked":mime=="image/png",
        "original_jpeg_checked":mime=="image/jpeg","original_pdf_checked":mime=="application/pdf","original_asset_checked":true,"media_type":mime,
        "workproof":report,"identity_verified":false,"creation_time_verified":false,"revocation_checked":false,"network_used":false})
}

#[cfg(test)]mod tests{
    use super::*;
    fn chunk(kind:&[u8;4],data:&[u8])->Vec<u8>{let mut v=(data.len() as u32).to_be_bytes().to_vec();v.extend_from_slice(kind);v.extend_from_slice(data);v.extend_from_slice(&crc32fast::hash(&v[4..]).to_be_bytes());v}
    fn image()->Vec<u8>{let mut v=PNG.to_vec();v.extend(chunk(b"IHDR",&[0;13]));v.extend(chunk(b"IDAT",&[1,2]));v.extend(chunk(b"IEND",&[]));v}
    #[test]fn removes_only_cabx_and_retains_exact_source_bytes(){let original=image();let mut signed=original[..33].to_vec();signed.extend(chunk(b"caBX",b"test manifest"));signed.extend_from_slice(&original[33..]);let (restored,count)=original_png(&signed).unwrap();assert_eq!(restored,original);assert_eq!(count,1);}
    #[test]fn rejects_crc_truncation_and_trailing_bytes(){let original=image();let mut changed=original.clone();changed[20]^=1;assert!(original_png(&changed).is_err());assert!(original_png(&original[..original.len()-1]).is_err());let mut changed=original.clone();changed.push(0);assert!(original_png(&changed).is_err());}
}
