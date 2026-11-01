//! Byte-preserving JPEG normalization. JPEG XT APP11 packets repeat LBox/TBox
//! on continuation packets (ISO 19566-5); only the identified C2PA store is removed.
use crate::{Result,IMAGE_LIMIT};
use std::collections::BTreeMap;
const UUID:&[u8]=&[0x63,0x32,0x70,0x61,0,0x11,0,0x10,0x80,0,0,0xaa,0,0x38,0x9b,0x71];
struct Group { next:u32, header:[u8;8], bytes:Vec<u8>, ranges:Vec<(usize,usize)> }
pub fn original_jpeg(data:&[u8])->Result<(Vec<u8>,usize)>{
    if !data.starts_with(&[0xff,0xd8])||data.len()>IMAGE_LIMIT{return Err("INVALID_JPEG".into());}
    let mut pos=2;let mut markers=0;let mut scan=false;let mut saw_scan=false;let mut ended=false;
    let mut groups:BTreeMap<u16,Group>=BTreeMap::new();
    while pos<data.len(){
        if scan {
            while pos<data.len(){
                if data[pos]!=0xff{pos+=1;continue;}
                let start=pos;while pos<data.len()&&data[pos]==0xff{pos+=1;}
                let code=*data.get(pos).ok_or("TRUNCATED_JPEG_SCAN")?;
                if code==0 || (0xd0..=0xd7).contains(&code){pos+=1;continue;}
                pos=start;scan=false;break;
            }
            if scan{return Err("JPEG_EOI_REQUIRED".into());}
        }
        markers+=1;if markers>16384{return Err("JPEG_MARKER_LIMIT".into());}
        let start=pos;
        if data.get(pos)!=Some(&0xff){return Err("INVALID_JPEG_MARKER".into());}
        while data.get(pos)==Some(&0xff){pos+=1;}
        let code=*data.get(pos).ok_or("TRUNCATED_JPEG_MARKER")?;pos+=1;
        if code==0xd9{if !saw_scan||pos!=data.len(){return Err("INVALID_JPEG_END".into());}ended=true;break;}
        if code==0||code==0xd8||(0xd0..=0xd7).contains(&code){return Err("INVALID_JPEG_MARKER".into());}
        if code==1{continue;}
        let length=u16::from_be_bytes(data.get(pos..pos+2).ok_or("TRUNCATED_JPEG_LENGTH")?.try_into()?) as usize;
        if length<2{return Err("INVALID_JPEG_LENGTH".into());}
        let end=pos.checked_add(length).ok_or("INVALID_JPEG_LENGTH")?;
        let payload=data.get(pos+2..end).ok_or("TRUNCATED_JPEG_SEGMENT")?;
        if code==0xeb && payload.starts_with(b"JP"){
            if payload.len()<16{return Err("INVALID_JPEG_JUMBF_PACKET".into());}
            let instance=u16::from_be_bytes(payload[2..4].try_into()?);
            let sequence=u32::from_be_bytes(payload[4..8].try_into()?);
            let header:[u8;8]=payload[8..16].try_into()?;
            if sequence==1{
                if groups.contains_key(&instance){return Err("DUPLICATE_JPEG_JUMBF_INSTANCE".into());}
                groups.insert(instance,Group{next:2,header,bytes:payload[8..].to_vec(),ranges:vec![(start,end)]});
            }else{
                let group=groups.get_mut(&instance).ok_or("ORPHAN_JPEG_JUMBF_PACKET")?;
                if sequence!=group.next||header!=group.header{return Err("INVALID_JPEG_JUMBF_SEQUENCE".into());}
                group.next=group.next.checked_add(1).ok_or("INVALID_JPEG_JUMBF_SEQUENCE")?;
                group.bytes.extend_from_slice(&payload[16..]);group.ranges.push((start,end));
            }
        }
        pos=end;
        if code==0xda{scan=true;saw_scan=true;}
    }
    if !ended{return Err("JPEG_EOI_REQUIRED".into());}
    let mut removed=Vec::new();let mut stores=0;
    for group in groups.values(){
        let bytes=&group.bytes;
        // A JUMBF description box starts immediately after the superbox header.
        // Non-C2PA APP11 content is retained, including other JUMBF UUIDs.
        if bytes.len()<38 || &bytes[4..8]!=b"jumb" || &bytes[12..16]!=b"jumd" || &bytes[16..32]!=UUID{continue;}
        let total=u32::from_be_bytes(bytes[..4].try_into()?) as usize;
        let description=u32::from_be_bytes(bytes[8..12].try_into()?) as usize;
        if total!=bytes.len()||description<30||8+description>bytes.len()||bytes[32]&2==0||&bytes[33..38]!=b"c2pa\0"{return Err("INVALID_JPEG_C2PA_STORE".into());}
        stores+=1;if stores>1{return Err("MULTIPLE_JPEG_C2PA_STORES".into());}
        removed.extend_from_slice(&group.ranges);
    }
    removed.sort_unstable();let mut original=Vec::with_capacity(data.len());let mut cursor=0;
    for (start,end) in removed{original.extend_from_slice(&data[cursor..start]);cursor=end;}
    original.extend_from_slice(&data[cursor..]);Ok((original,stores))
}

#[cfg(test)]mod tests{
    use super::*;
    fn segment(code:u8,payload:&[u8])->Vec<u8>{let mut out=vec![0xff,code];out.extend(((payload.len()+2)as u16).to_be_bytes());out.extend(payload);out}
    fn image()->Vec<u8>{let mut out=vec![0xff,0xd8];out.extend(segment(0xe1,b"Exif\0\0keep"));out.extend(segment(0xeb,b"not JUMBF"));out.extend(segment(0xda,&[1,2]));out.extend([1,0xff,0,2,0xff,0xd0,3]);out.extend(segment(0xda,&[3,4]));out.extend([4,0xff,0xd9]);out}
    fn store()->Vec<u8>{let mut bytes=vec![];bytes.extend(42u32.to_be_bytes());bytes.extend(b"jumb");bytes.extend(34u32.to_be_bytes());bytes.extend(b"jumd");bytes.extend(UUID);bytes.push(3);bytes.extend(b"c2pa\0");bytes.extend([0;4]);bytes}
    fn packet(instance:u16,sequence:u32,box_bytes:&[u8],header:&[u8])->Vec<u8>{let mut p=b"JP".to_vec();p.extend(instance.to_be_bytes());p.extend(sequence.to_be_bytes());p.extend(header);p.extend(box_bytes);segment(0xeb,&p)}
    #[test]fn exact_bytes_and_non_c2pa_app11_survive(){let source=image();assert_eq!(original_jpeg(&source).unwrap(),(source.clone(),0));let bytes=store();let mut signed=source[..2].to_vec();signed.extend(packet(1,1,&bytes,&[]));signed.extend(&source[2..]);assert_eq!(original_jpeg(&signed).unwrap(),(source,1));}
    #[test]fn repeated_header_packets_and_other_jumbf_survive(){let source=image();let bytes=store();let mut other=bytes.clone();other[16]=0x55;let extra=packet(9,1,&other,&[]);let mut original=source[..2].to_vec();original.extend(&extra);original.extend(&source[2..]);let mut signed=original[..2].to_vec();signed.extend(packet(1,1,&bytes[..38],&[]));signed.extend(&extra);signed.extend(packet(1,2,&bytes[38..],&bytes[..8]));signed.extend(&source[2..]);assert_eq!(original_jpeg(&signed).unwrap(),(original,1));}
    #[test]fn rejects_bad_framing_and_packets(){let source=image();for n in 0..source.len(){assert!(original_jpeg(&source[..n]).is_err());}let mut trailing=source.clone();trailing.push(0);assert!(original_jpeg(&trailing).is_err());let bytes=store();for seq in [0,2,3]{let mut bad=source[..2].to_vec();bad.extend(packet(1,seq,&bytes,&[]));bad.extend(&source[2..]);assert!(original_jpeg(&bad).is_err());}let mut short=source[..2].to_vec();short.extend(segment(0xe1,&[]));short[4]=0;short[5]=1;short.extend(&source[2..]);assert!(original_jpeg(&short).is_err());}
    #[test]fn rejects_duplicate_and_truncated_c2pa(){let source=image();let bytes=store();let mut bad=source[..2].to_vec();bad.extend(packet(1,1,&bytes,&[]));bad.extend(packet(1,1,&bytes,&[]));bad.extend(&source[2..]);assert!(original_jpeg(&bad).is_err());let mut bad=source[..2].to_vec();bad.extend(packet(1,1,&bytes[..40],&[]));bad.extend(&source[2..]);assert!(original_jpeg(&bad).is_err());}
}
