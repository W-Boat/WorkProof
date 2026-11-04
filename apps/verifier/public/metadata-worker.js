// Optional local PNG / JPEG / DOCX / PPTX metadata inspection. No network or external relationships.
// PNG text layout: https://www.w3.org/TR/png-3/#11textinfo
importScripts('/docx-metadata.js','/metadata-common.js','/jpeg-metadata.js');
self.onmessage=async({data:{file}})=>{
  try{
    if(file.size>256*1024*1024)throw Error('文件超过 256 MB，请选择较小的文件。');
    const read=async(start,length)=>new Uint8Array(await file.slice(start,start+length).arrayBuffer());
    const signature=await read(0,8);
    if(signature[0]===80&&signature[1]===75){self.postMessage(await docxMetadata(file));return;}
    if(signature[0]===255&&signature[1]===216){self.postMessage(await jpegMetadata(file));return;}
    if(signature.join(',')!=='137,80,78,71,13,10,26,10')throw Error('目前只支持 PNG、JPEG、DOCX 和 PPTX 元数据检查；其他格式尚未分析。');
    const latin=value=>Array.from(value,b=>String.fromCharCode(b)).join('');
    const clean=value=>value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,160);
    const findings=[],xmp=[];let skipped=0,pos=8,total=0,expandedTotal=0,ended=false,header=false;
    const inflate=async bytes=>{
      if(expandedTotal>=1024*1024)throw Error('PNG text expansion budget');
      const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
      const blocks=[];let length=0;
      try{
        while(true){
          const {done,value}=await reader.read();if(done)break;
          length+=value.length;expandedTotal+=value.length;
          if(length>256*1024||expandedTotal>1024*1024)throw Error('PNG text expansion budget');
          blocks.push(value);
        }
      }finally{await reader.cancel().catch(()=>{});}
      const output=new Uint8Array(length);let at=0;
      for(const block of blocks){output.set(block,at);at+=block.length;}
      return output;
    };
    for(let count=0;pos<file.size;count++){
      if(count>=4096)throw Error('PNG 数据块过多，已停止分析。');
      const bytes=await read(pos,8);if(bytes.length!==8)throw Error('PNG 文件不完整。');
      const length=new DataView(bytes.buffer).getUint32(0),kind=latin(bytes.slice(4));
      if(pos+12+length>file.size||!/^[A-Za-z]{4}$/.test(kind))throw Error('PNG 数据块长度或类型异常。');
      if(count===0){if(kind!=='IHDR'||length!==13)throw Error('PNG 文件头异常。');header=true;}
      if(kind==='caBX'&&findings.length<32)findings.push({field:'C2PA',location:`caBX @ ${pos}`,value:'包含来源凭据；此处尚未核验其签名。',hint:false});
      if(['tEXt','iTXt','zTXt'].includes(kind)){
        total+=length;
        if(length>256*1024||total>1024*1024){skipped++;}
        else{
          const body=await read(pos+8,length),checksum=await read(pos+8+length,4),separator=body.indexOf(0);
          let crc=0xffffffff;
          for(const segment of [bytes.subarray(4),body])for(const byte of segment){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
          if(((crc^0xffffffff)>>>0)!==new DataView(checksum.buffer).getUint32(0)){skipped++;}
          else if(separator<1||separator>79){skipped++;}
          else{
            const field=latin(body.slice(0,separator));let text;
            if(kind==='zTXt'){
              if(separator+2>body.length||body[separator+1]!==0){skipped++;}
              else{try{text=latin(await inflate(body.slice(separator+2)));}catch{skipped++;}}
            }
            else if(kind==='tEXt')text=latin(body.slice(separator+1));
            else{
              let offset=separator+1;
              const compressed=body[offset];
              if(offset+2>body.length||![0,1].includes(compressed)||(compressed===1&&body[offset+1]!==0)){skipped++;}
              else{
                offset+=2;const languageEnd=body.indexOf(0,offset),translationEnd=languageEnd<0?-1:body.indexOf(0,languageEnd+1);
                if(translationEnd<0){skipped++;}
                else{try{const payload=body.slice(translationEnd+1);text=new TextDecoder('utf-8',{fatal:true}).decode(compressed===1?await inflate(payload):payload);}catch{skipped++;}}
              }
            }
            if(text!==undefined){
              const hint=['parameters','prompt','workflow'].includes(field.toLowerCase());
              if(kind==='iTXt'&&field==='XML:com.adobe.xmp'){
                if(xmp.length>=4){skipped++;}
                else{try{xmp.push(metadataXmpPacket(text,`${kind} @ ${pos}`));}catch{skipped++;}}
              }else if(findings.length<32)findings.push({field:clean(field),location:`${kind} @ ${pos}`,value:clean(text),hint});else skipped++;
            }
          }
        }
      }
      pos+=length+12;
      if(kind==='IEND'){if(length!==0||pos!==file.size)throw Error('PNG 结束位置异常。');ended=true;break;}
    }
    if(!header||!ended)throw Error('PNG 文件不完整。');
    self.postMessage({ok:true,format:'png',findings,xmp,skipped});
  }catch(error){self.postMessage({ok:false,message:error instanceof Error&&/[\u4e00-\u9fff]/.test(error.message)?error.message:'无法读取元数据，请重新选择文件。'});}
};
