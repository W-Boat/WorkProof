//! Optional native exporter and CLI; file I/O and signing keys stay out of browser exports.
use std::{env,fs::{File,OpenOptions},io::{Cursor,Read,Write},path::Path,process::ExitCode};
use c2pa::{Builder,SigningAlg};
use serde_json::json;
use zeroize::Zeroizing;
use workproof_c2pa::*;
use workproof_protocol::Report;

fn read(path:&str,limit:usize)->Result<Vec<u8>>{
    let file=File::open(path)?;
    if !file.metadata()?.is_file(){return Err("REGULAR_FILE_REQUIRED".into());}
    let mut data=Vec::new();file.take(limit as u64+1).read_to_end(&mut data)?;
    if data.len()>limit{return Err("INPUT_TOO_LARGE".into());}Ok(data)
}

fn output(report:Report,trusted:bool,mime:&str){println!("{}",report_json(report,trusted,mime));}
fn embed(args:&[String])->Result<()>{
    if args.len()!=7||args[6]!="--allow-public-process"{return Err("Usage: workproof-c2pa embed ORIGINAL.png|jpg|pdf CERTIFICATE.wproof CHAIN.pem KEY.pem OUTPUT.png|jpg|pdf --allow-public-process".into());}
    if Path::new(&args[5]).exists(){return Err("OUTPUT_ALREADY_EXISTS".into());}
    let original=read(&args[1],64*1024*1024)?;
    let (mime,normalization)=format(&original)?;
    if mime!="application/pdf" && original_image(&original)?.1!=0{return Err("SOURCE_ALREADY_HAS_C2PA_UNSUPPORTED".into());}
    if mime=="application/pdf" {pdf::append(&original,b"preflight")?;}
    let certificate=String::from_utf8(read(&args[2],PROOF_LIMIT)?)?;
    proof_report(&certificate,&original)?;
    let certs=read(&args[3],256*1024)?;
    let key=Zeroizing::new(read(&args[4],64*1024)?);
    let signer=c2pa::create_signer::from_keys(&certs,&key,SigningAlg::Es256,None).map_err(|_|"C2PA_SIGNER_FAILED")?;
    let builder_context=if mime=="application/pdf"{
        context(None)?.with_signer(c2pa::create_signer::from_keys(&certs,&key,SigningAlg::Es256,None).map_err(|_|"C2PA_SIGNER_FAILED")?)
    }else{context(None)?};
    let mut builder=Builder::from_context(builder_context).with_definition(json!({
        "title":"WorkProof asset package","format":mime,
        "claim_generator_info":[{"name":"WorkProof","version":env!("CARGO_PKG_VERSION")}]
    }).to_string()).map_err(|_|"C2PA_BUILDER_FAILED")?;
    builder.add_assertion(LABEL,&Binding{schema:if mime=="application/pdf"{"workproof-c2pa/2"}else{"workproof-c2pa/1"}.into(),normalization:normalization.into(),certificate_json:certificate,
        original_length:if mime=="application/pdf"{Some(original.len() as u64)}else{None}})
        .map_err(|_|"C2PA_ASSERTION_FAILED")?;
    builder.add_ingredient_from_stream(json!({"title":"Original asset","relationship":"parentOf","label":"workproof_source"}).to_string(),mime,&mut Cursor::new(&original))
        .map_err(|_|"C2PA_INGREDIENT_FAILED")?;
    builder.add_action(json!({"action":"c2pa.opened","parameters":{"ingredientIds":["workproof_source"]}})).map_err(|_|"C2PA_ACTION_FAILED")?;
    let signed=if mime=="application/pdf"{
        let placeholder=builder.placeholder(mime).map_err(|_|"PDF_PLACEHOLDER_FAILED")?;
        let mut package=pdf::append(&original,&placeholder)?;
        builder.set_data_hash_exclusions(vec![c2pa::HashRange::new(package.manifest_start as u64,package.manifest_len as u64)])?;
        builder.update_hash_from_stream(mime,&mut Cursor::new(&package.bytes))?;
        let manifest=builder.sign_embeddable(mime).map_err(|_|"PDF_SIGN_FAILED")?;
        if manifest.len()!=package.manifest_len{return Err("PDF_MANIFEST_SIZE_CHANGED".into());}
        package.bytes[package.manifest_start..package.manifest_start+manifest.len()].copy_from_slice(&manifest);
        if pdf::original(&package.bytes,original.len() as u64)?!=original{return Err("PDF_SOURCE_BYTES_CHANGED".into());}
        package.bytes
    }else{
        let mut destination=Cursor::new(Vec::new());
        builder.sign(signer.as_ref(),mime,&mut Cursor::new(&original),&mut destination).map_err(|_|"C2PA_SIGN_FAILED")?;
        let signed=destination.into_inner();
        if original_image(&signed)?.0!=original{return Err("SDK_CHANGED_ORIGINAL_IMAGE_BYTES".into());}signed
    };
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
        _=>Err("Usage: workproof-c2pa embed ... | verify SIGNED.png|jpg|pdf TRUSTED-ROOTS.pem".into()),
    }
}
fn main()->ExitCode{
    match execute(){Ok(())=>ExitCode::SUCCESS,Err(error)=>{eprintln!("WorkProof C2PA: {error}");ExitCode::FAILURE}}
}

