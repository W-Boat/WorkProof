//! Strict, reproducible incremental PDF packaging. The source is an exact byte prefix.
//! Verification regenerates every appended byte except the authenticated manifest stream.
use super::Result;
use lopdf::{dictionary, Dictionary, Document, LoadOptions, Object};
use std::io::Write;

const MAX_OBJECTS:usize=100_000;
const NAME:&[u8]=b"WorkProof provenance.c2pa";

// lopdf's Writer is private. Serialize only legal direct PDF objects; streams
// remain indirect references, and no original stream is decoded or rewritten.
fn object(bytes:&mut Vec<u8>,value:&Object,depth:usize)->Result<()>{
    if depth>32{return Err("PDF_DIRECT_OBJECT_DEPTH".into());}
    match value {
        Object::Null=>bytes.extend_from_slice(b"null"),
        Object::Boolean(v)=>bytes.extend_from_slice(if *v{b"true"}else{b"false"}),
        Object::Integer(v)=>write!(bytes,"{v}")?,
        Object::Real(v)=>{
            if !v.is_finite(){return Err("PDF_INVALID_REAL".into());}
            let fixed=format!("{v:.50}");let fixed=fixed.trim_end_matches('0').trim_end_matches('.');
            bytes.extend_from_slice(if fixed=="-0"{b"0"}else{fixed.as_bytes()});
        },
        Object::Name(v)=>{bytes.push(b'/');for b in v{write!(bytes,"#{b:02X}")?;}},
        Object::String(v,_)=>{bytes.push(b'<');for b in v{write!(bytes,"{b:02X}")?;}bytes.push(b'>');},
        Object::Reference((id,generation))=>write!(bytes,"{id} {generation} R")?,
        Object::Array(values)=>{bytes.push(b'[');for v in values{object(bytes,v,depth+1)?;bytes.push(b' ');}bytes.push(b']');},
        Object::Dictionary(values)=>{
            bytes.extend_from_slice(b"<<");for (k,v) in values.iter(){object(bytes,&Object::Name(k.clone()),depth+1)?;bytes.push(b' ');object(bytes,v,depth+1)?;bytes.push(b' ');}bytes.extend_from_slice(b">>");
        },
        Object::Stream(_)=>return Err("PDF_DIRECT_STREAM_UNSUPPORTED".into()),
    }Ok(())
}

fn parse(bytes:&[u8])->Result<Document>{
    if !bytes.starts_with(b"%PDF-") {return Err("INVALID_PDF_HEADER".into());}
    fn filter(id:(u32,u16),obj:&mut Object)->Option<((u32,u16),Object)>{
        // This hook runs before eager object-stream decompression in lopdf.
        if obj.as_stream().map(|s|s.dict.has_type(b"ObjStm")).unwrap_or(false){
            *obj=Object::Name(b"WorkProofUnsupportedObjectStream".to_vec());
        }Some((id,obj.clone()))
    }
    let doc=Document::load_mem_with_options(bytes,LoadOptions{strict:true,filter:Some(filter),max_decompressed_size:Some(2*1024*1024),..Default::default()})?;
    if doc.is_encrypted() || doc.trailer.has(b"Encrypt") || doc.encryption_state.is_some(){return Err("ENCRYPTED_PDF_UNSUPPORTED".into());}
    if doc.objects.values().any(|v|v.as_name().ok()==Some(b"WorkProofUnsupportedObjectStream")){
        return Err("PDF_OBJECT_STREAM_UNSUPPORTED".into());
    }
    if doc.objects.len()>MAX_OBJECTS || doc.xref_start==0 || doc.xref_start>=bytes.len(){return Err("PDF_STRUCTURE_LIMIT".into());}
    // Never guess where a damaged/trailing revision ends.
    if !bytes.trim_ascii_end().ends_with(b"%%EOF"){return Err("PDF_TRAILING_DATA_UNSUPPORTED".into());}
    Ok(doc)
}
pub fn preflight(bytes:&[u8])->Result<()>{parse(bytes).map(|_|())}
fn resolved<'a>(doc:&'a Document,object:&'a Object)->Result<&'a Object>{
    let mut current=object;
    for _ in 0..32 {
        if let Object::Reference(id)=current {current=doc.objects.get(id).ok_or("PDF_DANGLING_REFERENCE")?;} else{return Ok(current);}
    }
    Err("PDF_REFERENCE_CYCLE".into())
}
fn names(doc:&Document,node:&Object,depth:usize,out:&mut Vec<(Vec<u8>,Object)>)->Result<()>{
    if depth>16 || out.len()>4096{return Err("PDF_NAMES_LIMIT".into());}
    let dict=resolved(doc,node)?.as_dict()?;
    if dict.has(b"Names") && dict.has(b"Kids"){return Err("PDF_AMBIGUOUS_NAME_TREE".into());}
    if let Ok(values)=dict.get(b"Names") {
        let values=resolved(doc,values)?.as_array()?;
        if values.len()%2!=0{return Err("PDF_INVALID_NAME_TREE".into());}
        for pair in values.chunks_exact(2){out.push((pair[0].as_str()?.to_vec(),pair[1].clone()));}
    } else if let Ok(kids)=dict.get(b"Kids") {
        for child in resolved(doc,kids)?.as_array()? {names(doc,child,depth+1,out)?;}
    }
    if out.len()>4096{return Err("PDF_NAMES_LIMIT".into());} Ok(())
}
fn source_objects(value:&Object,depth:usize)->Result<()>{
    if depth>32{return Err("PDF_DIRECT_OBJECT_DEPTH".into());}
    match value {
        Object::Dictionary(d)=>{
            if d.get(b"AFRelationship").and_then(Object::as_name).ok()==Some(b"C2PA_Manifest"){
                return Err("SOURCE_ALREADY_HAS_C2PA_UNSUPPORTED".into());
            }
            if d.get(b"Type").and_then(Object::as_name).ok()==Some(b"Sig") || d.get(b"FT").and_then(Object::as_name).ok()==Some(b"Sig"){
                return Err("PDF_EXISTING_SIGNATURE_UNSUPPORTED".into());
            }
            for (_,v) in d.iter(){source_objects(v,depth+1)?;}
        },
        Object::Stream(s)=>source_objects(&Object::Dictionary(s.dict.clone()),depth+1)?,
        Object::Array(values)=>for v in values{source_objects(v,depth+1)?;},
        _=>{},
    }Ok(())
}

pub struct Package {pub bytes:Vec<u8>,pub manifest_start:usize,pub manifest_len:usize}

/// The manifest is supplied separately so both signing and verification use one layout.
pub fn append(original:&[u8],manifest:&[u8])->Result<Package>{
    let doc=parse(original)?;
    let root=doc.trailer.get(b"Root")?;
    let mut catalog=resolved(&doc,root)?.as_dict()?.clone();
    if catalog.get(b"Type")?.as_name()?!=b"Catalog" {return Err("PDF_CATALOG_REQUIRED".into());}
    // Recognize C2PA file specifications even when not reachable through /AF.
    for object in doc.objects.values(){source_objects(object,0)?;}
    let size=doc.trailer.get(b"Size")?.as_i64()?;
    if !(1..=1_000_000).contains(&size){return Err("PDF_OBJECT_ID_LIMIT".into());}
    let first=(doc.max_id.checked_add(1).ok_or("PDF_OBJECT_ID_LIMIT")?).max(size as u32);
    if first>1_000_000{return Err("PDF_OBJECT_ID_LIMIT".into());}
    let stream_id=(first,0);let spec_id=(first+1,0);let catalog_id=(first+2,0);
    let spec=Object::Dictionary(dictionary!{
        "Type"=>"Filespec","F"=>Object::string_literal(NAME),"UF"=>Object::string_literal(NAME),
        "Desc"=>Object::string_literal(b"WorkProof Content Credentials".as_slice()),
        "AFRelationship"=>"C2PA_Manifest","Subtype"=>"application/c2pa",
        "EF"=>dictionary!{"F"=>Object::Reference(stream_id),"UF"=>Object::Reference(stream_id)}
    });
    let mut af=match catalog.get(b"AF"){Ok(v)=>resolved(&doc,v)?.as_array()?.clone(),Err(_)=>Vec::new()};
    if af.len()>4096{return Err("PDF_ASSOCIATED_FILES_LIMIT".into());}
    af.push(Object::Reference(spec_id));catalog.set("AF",Object::Array(af));
    let mut name_dict=match catalog.get(b"Names"){Ok(v)=>resolved(&doc,v)?.as_dict()?.clone(),Err(_)=>Dictionary::new()};
    let mut entries=Vec::new();
    if let Ok(tree)=name_dict.get(b"EmbeddedFiles"){names(&doc,tree,0,&mut entries)?;}
    entries.push((NAME.to_vec(),Object::Reference(spec_id)));entries.sort_by(|a,b|a.0.cmp(&b.0));
    if entries.windows(2).any(|v|v[0].0==v[1].0){return Err("PDF_DUPLICATE_EMBEDDED_NAME".into());}
    let flattened=entries.into_iter().flat_map(|(key,value)|[Object::string_literal(key),value]).collect();
    name_dict.set("EmbeddedFiles",dictionary!{"Names"=>Object::Array(flattened)});
    catalog.set("Names",Object::Dictionary(name_dict));
    let mut bytes=original.to_vec();
    // A fixed comment distinguishes this strict export from arbitrary incremental edits.
    bytes.extend_from_slice(b"\n%WorkProof PDF incremental v1\n");
    let mut offsets=Vec::new();offsets.push(bytes.len());
    write!(bytes,"{} 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fc2pa /Length {} >>\nstream\n",stream_id.0,manifest.len())?;
    let manifest_start=bytes.len();bytes.extend_from_slice(manifest);bytes.extend_from_slice(b"\nendstream\nendobj\n");
    for (id,object) in [(spec_id,spec),(catalog_id,Object::Dictionary(catalog))] {
        offsets.push(bytes.len());write!(bytes,"{} 0 obj\n",id.0)?;self::object(&mut bytes,&object,0)?;bytes.extend_from_slice(b"\nendobj\n");
    }
    let xref=bytes.len();write!(bytes,"xref\n{} 3\n",first)?;
    for offset in offsets {if u64::try_from(offset)?>9_999_999_999u64{return Err("PDF_OFFSET_LIMIT".into());}write!(bytes,"{offset:010} 00000 n \n")?;}
    let mut trailer=doc.trailer.clone();
    for key in [b"XRefStm".as_slice(),b"Type",b"W",b"Index",b"Filter",b"Length",b"DecodeParms"]{trailer.remove(key);}
    trailer.set("Root",Object::Reference(catalog_id));trailer.set("Size",(first+3) as i64);trailer.set("Prev",doc.xref_start as i64);
    bytes.extend_from_slice(b"trailer\n");object(&mut bytes,&Object::Dictionary(trailer),0)?;
    write!(bytes,"\nstartxref\n{xref}\n%%EOF\n")?;
    Ok(Package{bytes,manifest_start,manifest_len:manifest.len()})
}

/// Signed original length is necessary, but never sufficient: compare the complete export.
pub fn original(signed:&[u8],length:u64)->Result<Vec<u8>>{
    let length=usize::try_from(length)?;
    if length==0 || length>=signed.len(){return Err("PDF_INVALID_ORIGINAL_LENGTH".into());}
    // Obtain the sole manifest via the SDK only after its normal signature/hash validation.
    let document=parse(signed)?;
    let mut matches=Vec::new();
    for object in document.objects.values(){
        if let Ok(stream)=object.as_stream(){
            if stream.dict.get(b"Type").and_then(Object::as_name).ok()==Some(b"EmbeddedFile") &&
               stream.dict.get(b"Subtype").and_then(Object::as_name).ok()==Some(b"application/c2pa") {
                if stream.dict.has(b"Filter"){return Err("PDF_COMPRESSED_MANIFEST_UNSUPPORTED".into());}
                matches.push(&stream.content);
            }
        }
    }
    if matches.len()!=1{return Err("PDF_EXACTLY_ONE_MANIFEST_REQUIRED".into());}
    let expected=append(&signed[..length],matches[0])?;
    if expected.bytes!=signed{return Err("PDF_UNEXPECTED_INCREMENTAL_CONTENT".into());}
    Ok(signed[..length].to_vec())
}

#[cfg(test)]mod tests {
    use super::*;
    fn fixture()->Vec<u8>{
        let mut doc=Document::with_version("1.7");
        let attachment=doc.add_object(dictionary!{"Type"=>"Filespec","F"=>Object::string_literal(b"existing.txt".as_slice()),"AFRelationship"=>"Data"});
        let pages=doc.new_object_id();
        let page=doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages,"MediaBox"=>vec![0.into(),0.into(),300.into(),300.into()]});
        doc.objects.insert(pages,Object::Dictionary(dictionary!{"Type"=>"Pages","Kids"=>vec![Object::Reference(page)],"Count"=>1}));
        let catalog=doc.add_object(dictionary!{"Type"=>"Catalog","Pages"=>pages,"AF"=>vec![Object::Reference(attachment)],
            "Names"=>dictionary!{"Dests"=>dictionary!{"Names"=>Vec::<Object>::new()},"EmbeddedFiles"=>dictionary!{"Names"=>vec![Object::string_literal(b"existing.txt".as_slice()),Object::Reference(attachment)]}}});
        doc.trailer.set("Root",catalog);let mut bytes=Vec::new();doc.save_to(&mut bytes).unwrap();bytes
    }
    #[test]fn exact_prefix_and_catalog_attachment_preservation(){
        let source=fixture();let export=append(&source,b"synthetic manifest bytes").unwrap();
        assert!(export.bytes.starts_with(&source));assert_eq!(original(&export.bytes,source.len() as u64).unwrap(),source);
        let parsed=parse(&export.bytes).unwrap();let root=parsed.trailer.get(b"Root").unwrap();let catalog=resolved(&parsed,root).unwrap().as_dict().unwrap();
        assert_eq!(catalog.get(b"AF").unwrap().as_array().unwrap().len(),2);
        let name_dict=catalog.get(b"Names").unwrap().as_dict().unwrap();assert!(name_dict.has(b"Dests"));
        let mut files=Vec::new();names(&parsed,name_dict.get(b"EmbeddedFiles").unwrap(),0,&mut files).unwrap();
        assert_eq!(files.len(),2);assert!(files.iter().any(|(name,_)|name==b"existing.txt"));
        assert!(append(&export.bytes,b"second manifest").is_err());
    }
    #[test]fn rejects_modified_incremental_catalog_even_with_unchanged_source(){
        let source=fixture();let export=append(&source,b"synthetic manifest bytes").unwrap();
        let mut changed=export.bytes.clone();
        let needle=b"/#50#61#67#65#73 ";
        let at=changed[source.len()..].windows(needle.len()).position(|s|s==needle).unwrap()+source.len()+needle.len();
        assert!(changed[at].is_ascii_digit());changed[at]=if changed[at]==b'1'{b'2'}else{b'1'};
        // PDF still parses and the source prefix is identical; strict export comparison rejects it.
        assert!(parse(&changed).is_ok());assert_eq!(&changed[..source.len()],&source);
        assert!(original(&changed,source.len() as u64).is_err());
        assert!(original(&export.bytes,(source.len()-1) as u64).is_err());
    }
}
