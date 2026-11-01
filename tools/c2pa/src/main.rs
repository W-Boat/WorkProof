//! Optional offline C2PA PNG packaging, separate from the lightweight recording engine.
use std::{env,fs::{File,OpenOptions},io::{Cursor,Read,Write},path::Path,process::ExitCode};
use c2pa::{Builder,Context,Reader,SigningAlg,validation_results::ValidationState};
use serde::{Deserialize,Serialize};
use serde_json::json;
use workproof_protocol::{Evidence,Report,digest,verify_evidence};
use zeroize::Zeroizing;
mod jpeg;

type Result<T> = std::result::Result<T,Box<dyn std::error::Error>>;
// Keep the assertion base label unversioned; the SDK normalizes .vN suffixes.
const LABEL:&str="org.workproof.process";
const PNG:&[u8]=b"\x89PNG\r\n\x1a\n";
const IMAGE_LIMIT:usize=96*1024*1024;
const PROOF_LIMIT:usize=8*1024*1024;
fn format(data:&[u8])->Result<(&'static str,&'static str)>{
    if data.starts_with(PNG){Ok(("image/png","png-remove-cabx-v1"))}
    else if data.starts_with(&[0xff,0xd8]){Ok(("image/jpeg","jpeg-remove-c2pa-app11-v1"))}
    else{Err("UNSUPPORTED_IMAGE_FORMAT".into())}
}
fn original_image(data:&[u8])->Result<(Vec<u8>,usize)>{
    match format(data)?.0{"image/png"=>original_png(data),_=>jpeg::original_jpeg(data)}
}

#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding{schema:String,normalization:String,certificate_json:String}

fn read(path:&str,limit:usize)->Result<Vec<u8>>{
    let file=File::open(path)?;
    if !file.metadata()?.is_file(){return Err("REGULAR_FILE_REQUIRED".into());}
    let mut data=Vec::new();file.take(limit as u64+1).read_to_end(&mut data)?;
    if data.len()>limit{return Err("INPUT_TOO_LARGE".into());}Ok(data)
}

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

fn context(roots:Option<&str>)->Result<Context>{
    let mut settings=json!({
        "verify":{"verify_after_reading":true,"verify_after_sign":true,"ocsp_fetch":false,"remote_manifest_fetch":false},
        "core":{"decode_identity_assertions":false,"allowed_network_hosts":[],"allow_redirects":false,"max_decompressed_manifest_size_in_mb":32}
    });
    if let Some(pem)=roots{
        settings["trust"]=json!({"anchors":[{"trust_anchors":pem,"trust_kind":"manifest"}]});
    }
    Context::new().with_settings(settings.to_string()).map_err(|_|"INVALID_C2PA_SETTINGS".into())
}

fn proof_report(certificate:&str,original:&[u8])->Result<Report>{
    if certificate.len()>PROOF_LIMIT{return Err("PROOF_TOO_LARGE".into());}
    let evidence:Evidence=serde_json::from_str(certificate).map_err(|_|"INVALID_WORKPROOF_JSON")?;
    let report=verify_evidence(&evidence,&digest(original),original.len() as u64);
    if !report.valid{return Err("WORKPROOF_OR_ORIGINAL_PNG_MISMATCH".into());}Ok(report)
}

fn inspect(data:&[u8],roots:Option<&str>)->Result<(Report,bool)>{
    let (mime,normalization)=format(data)?;
    let (original,count)=original_image(data)?;
    if count==0{return Err("C2PA_PNG_REQUIRED".into());}
    let reader=Reader::from_context(context(roots)?).with_stream(mime,Cursor::new(data))
        .map_err(|_|"C2PA_READ_FAILED")?;
    let state=reader.validation_state();
    if state==ValidationState::Invalid{return Err("C2PA_INTEGRITY_FAILED".into());}
    let trusted=state==ValidationState::Trusted;
    if roots.is_some()&&!trusted{return Err("C2PA_EXPLICIT_CA_TRUST_FAILED".into());}
    let manifest=reader.active_manifest().ok_or("C2PA_MANIFEST_MISSING")?;
    let assertions:Vec<_>=manifest.assertions().iter().filter(|a|a.label()==LABEL).collect();
    if assertions.len()!=1{return Err("EXACTLY_ONE_WORKPROOF_ASSERTION_REQUIRED".into());}
    let binding:Binding=assertions[0].to_assertion().map_err(|_|"INVALID_WORKPROOF_ASSERTION")?;
    if binding.schema!="workproof-c2pa/1"||binding.normalization!=normalization{return Err("UNSUPPORTED_WORKPROOF_BINDING".into());}
    Ok((proof_report(&binding.certificate_json,&original)?,trusted))
}

fn output(report:Report,trusted:bool,mime:&str){
    println!("{}",json!({"protocol":"workproof-c2pa-report/1","c2pa_integrity_valid":true,"c2pa_trusted":trusted,
        "trust_policy":if trusted{"explicit-ca-file"}else{"not-verified"},"original_png_checked":mime=="image/png",
        "original_jpeg_checked":mime=="image/jpeg","original_asset_checked":true,"media_type":mime,
        "workproof":report,"identity_verified":false,"creation_time_verified":false,"revocation_checked":false,"network_used":false}));
}

fn embed(args:&[String])->Result<()>{
    if args.len()!=7||args[6]!="--allow-public-process"{return Err("Usage: workproof-c2pa embed ORIGINAL.png CERTIFICATE.wproof CHAIN.pem KEY.pem OUTPUT.png --allow-public-process".into());}
    if Path::new(&args[5]).exists(){return Err("OUTPUT_ALREADY_EXISTS".into());}
    let original=read(&args[1],64*1024*1024)?;
    let (mime,normalization)=format(&original)?;
    if original_image(&original)?.1!=0{return Err("SOURCE_ALREADY_HAS_C2PA_UNSUPPORTED".into());}
    let certificate=String::from_utf8(read(&args[2],PROOF_LIMIT)?)?;
    proof_report(&certificate,&original)?;
    let certs=read(&args[3],256*1024)?;
    let key=Zeroizing::new(read(&args[4],64*1024)?);
    let signer=c2pa::create_signer::from_keys(&certs,&key,SigningAlg::Es256,None).map_err(|_|"C2PA_SIGNER_FAILED")?;
    let mut builder=Builder::from_context(context(None)?).with_definition(json!({
        "title":"WorkProof image package","format":mime,
        "claim_generator_info":[{"name":"WorkProof","version":env!("CARGO_PKG_VERSION")}]
    }).to_string()).map_err(|_|"C2PA_BUILDER_FAILED")?;
    builder.add_assertion(LABEL,&Binding{schema:"workproof-c2pa/1".into(),normalization:normalization.into(),certificate_json:certificate})
        .map_err(|_|"C2PA_ASSERTION_FAILED")?;
    builder.add_ingredient_from_stream(json!({"title":"Original image","relationship":"parentOf","label":"workproof_source"}).to_string(),mime,&mut Cursor::new(&original))
        .map_err(|_|"C2PA_INGREDIENT_FAILED")?;
    builder.add_action(json!({"action":"c2pa.opened","parameters":{"ingredientIds":["workproof_source"]}})).map_err(|_|"C2PA_ACTION_FAILED")?;
    let mut destination=Cursor::new(Vec::new());
    builder.sign(signer.as_ref(),mime,&mut Cursor::new(&original),&mut destination).map_err(|_|"C2PA_SIGN_FAILED")?;
    let signed=destination.into_inner();
    if original_image(&signed)?.0!=original{return Err("SDK_CHANGED_ORIGINAL_IMAGE_BYTES".into());}
    let (report,_)=inspect(&signed,None)?;
    // Create only after all validations, and never overwrite an existing file or symlink.
    let mut file=OpenOptions::new().write(true).create_new(true).open(&args[5])?;
    file.write_all(&signed)?;file.sync_all()?;output(report,false,mime);Ok(())
}

fn execute()->Result<()>{
    let args:Vec<String>=env::args().skip(1).collect();
    match args.first().map(String::as_str){
        Some("embed")=>embed(&args),
        Some("verify") if args.len()==3=>{
            let signed=read(&args[1],IMAGE_LIMIT)?;
            let roots=String::from_utf8(read(&args[2],256*1024)?)?;
            let (report,trusted)=inspect(&signed,Some(&roots))?;output(report,trusted,format(&signed)?.0);Ok(())
        },
        _=>Err("Usage: workproof-c2pa embed ... | verify SIGNED.png TRUSTED-ROOTS.pem".into()),
    }
}
fn main()->ExitCode{
    match execute(){Ok(())=>ExitCode::SUCCESS,Err(error)=>{eprintln!("WorkProof C2PA: {error}");ExitCode::FAILURE}}
}

#[cfg(test)]mod tests{
    use super::*;
    fn chunk(kind:&[u8;4],data:&[u8])->Vec<u8>{let mut v=(data.len() as u32).to_be_bytes().to_vec();v.extend_from_slice(kind);v.extend_from_slice(data);v.extend_from_slice(&crc32fast::hash(&v[4..]).to_be_bytes());v}
    fn image()->Vec<u8>{let mut v=PNG.to_vec();v.extend(chunk(b"IHDR",&[0;13]));v.extend(chunk(b"IDAT",&[1,2]));v.extend(chunk(b"IEND",&[]));v}
    #[test]fn removes_only_cabx_and_retains_exact_source_bytes(){let original=image();let mut signed=original[..33].to_vec();signed.extend(chunk(b"caBX",b"test manifest"));signed.extend_from_slice(&original[33..]);let (restored,count)=original_png(&signed).unwrap();assert_eq!(restored,original);assert_eq!(count,1);}
    #[test]fn rejects_crc_truncation_and_trailing_bytes(){let original=image();let mut changed=original.clone();changed[20]^=1;assert!(original_png(&changed).is_err());assert!(original_png(&original[..original.len()-1]).is_err());let mut changed=original.clone();changed.push(0);assert!(original_png(&changed).is_err());}
}
