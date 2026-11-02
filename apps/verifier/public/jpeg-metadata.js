// Metadata before the first JPEG scan only. Never decode pixels or follow links.
async function jpegMetadata(file){
  const read=async(start,length)=>new Uint8Array(await file.slice(start,start+length).arrayBuffer());
  const latin=bytes=>Array.from(bytes,b=>String.fromCharCode(b)).join('');
  const clean=value=>value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,160);
  const findings=[],xmp=[];let skipped=0,total=0,pos=2,ended=false;
  const add=(field,value,location)=>{
    if(findings.length>=32){skipped++;return;}
    findings.push({field:clean(field),value:clean(value),location,hint:false});
  };
  function exif(body,location){
    const tiff=body.subarray(6),view=new DataView(tiff.buffer,tiff.byteOffset,tiff.byteLength);
    const bounds=(offset,length)=>{if(!Number.isSafeInteger(offset)||offset<0||offset+length>tiff.length)throw Error('EXIF bounds');};
    bounds(0,8);const order=latin(tiff.subarray(0,2));if(!['II','MM'].includes(order))throw Error('EXIF byte order');
    const little=order==='II',u16=offset=>{bounds(offset,2);return view.getUint16(offset,little);},u32=offset=>{bounds(offset,4);return view.getUint32(offset,little);};
    if(u16(2)!==42)throw Error('EXIF TIFF header');
    const seen=new Set();let entries=0;
    function ifd(offset,isExif){
      if(offset<8||seen.has(offset))throw Error('EXIF directory');seen.add(offset);
      const count=u16(offset);entries+=count;if(entries>256)throw Error('EXIF entry limit');
      bounds(offset+2,count*12+4);let nextExif=null;
      for(let i=0;i<count;i++){
        const at=offset+2+i*12,tag=u16(at),type=u16(at+2),count=u32(at+4);
        if(!isExif&&tag===0x8769){if(type!==4||count!==1||nextExif!==null)throw Error('EXIF pointer');nextExif=u32(at+8);continue;}
        const name=isExif?(tag===0x9286?'UserComment':null):({270:'ImageDescription',305:'Software',315:'Artist',33432:'Copyright'})[tag];
        if(!name)continue;
        if((name==='UserComment'?type!==7:type!==2)||count<1||count>16384){skipped++;continue;}
        const start=count<=4?at+8:u32(at+8);bounds(start,count);const bytes=tiff.subarray(start,start+count);let text;
        if(name==='UserComment'){
          if(count<8){skipped++;continue;}
          const encoding=latin(bytes.subarray(0,8)),payload=bytes.subarray(8);
          if(encoding==='ASCII\0\0\0'){
            if(payload.some(byte=>byte>127)){skipped++;continue;}text=latin(payload);
          }else if(encoding==='UNICODE\0'&&payload.length>=2&&payload.length%2===0){
            const codec=payload[0]===255&&payload[1]===254?'utf-16le':payload[0]===254&&payload[1]===255?'utf-16be':null;
            if(!codec){skipped++;continue;}
            try{text=new TextDecoder(codec,{fatal:true}).decode(payload.subarray(2));}catch{skipped++;continue;}
          }else{skipped++;continue;}
        }else{
          if(bytes.some(byte=>byte>127)){skipped++;continue;}text=latin(bytes);
        }
        add(name,text.replace(/\0+$/g,''),location);
      }
      // No thumbnail, GPS, maker notes, linked directories or image data are read.
      if(!isExif&&nextExif!==null)ifd(nextExif,true);
    }
    const previous=findings.length;
    try{ifd(u32(4),false);}catch(error){findings.splice(previous);throw error;}
  }
  for(let count=0;pos<file.size;count++){
    if(count>=4096||pos>4*1024*1024)throw Error('JPEG 文件头过大或数据段过多，已停止检查。');
    const prefix=await read(pos,2);if(prefix.length!==2||prefix[0]!==255)throw Error('JPEG 数据段不完整或格式不支持。');
    let marker=prefix[1];pos+=2;
    while(marker===255){if(pos>4*1024*1024)throw Error('JPEG 文件头过大，已停止检查。');const next=await read(pos++,1);if(!next.length)throw Error('JPEG 文件不完整。');marker=next[0];}
    if(marker===217){ended=true;break;}
    if(marker===0||marker===216||(marker>=208&&marker<=215)||marker===1)throw Error('JPEG 文件头数据段异常。');
    const size=await read(pos,2);if(size.length!==2)throw Error('JPEG 文件不完整。');
    const length=(size[0]<<8)|size[1];if(length<2||pos+length>file.size)throw Error('JPEG 数据段长度异常。');
    if(pos+length>4*1024*1024)throw Error('JPEG 文件头过大，已停止检查。');
    if(marker===218){if(length<6)throw Error('JPEG 扫描头异常。');ended=true;break;}
    if(marker===225||marker===254){
      total+=length-2;
      if(total>1024*1024){skipped++;}
      else{
        const body=await read(pos+2,length-2),location=`JPEG ${marker===225?'APP1':'COM'} @ ${pos-2}`;
        if(marker===254){
          // JPEG does not define a character encoding for COM. Decode only valid UTF-8.
          try{add('Comment',new TextDecoder('utf-8',{fatal:true}).decode(body),location);}catch{skipped++;}
        }else if(latin(body.subarray(0,6))==='Exif\0\0'){
          try{exif(body,location);}catch{skipped++;}
        }else if(latin(body.subarray(0,29))==='http://ns.adobe.com/xap/1.0/\0'){
          if(xmp.length>=4){skipped++;}
          else{
            try{
              const text=new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(29));
              xmp.push(metadataXmpPacket(text,location));
            }catch{skipped++;}
          }
        }else if(latin(body.subarray(0,35))==='http://ns.adobe.com/xmp/extension/\0'){skipped++;}
      }
    }
    pos+=length;
  }
  if(!ended)throw Error('JPEG 文件不完整。');
  return {ok:true,format:'jpeg',findings,xmp,skipped};
}
