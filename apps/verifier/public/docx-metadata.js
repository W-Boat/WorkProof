// Bounded ZIP reader. Only three property parts are inflated; no document content or relationships.
async function docxMetadata(file){
  const fail=()=>{throw Error('DOCX 结构异常、包含宏或超过安全限制，本次未检查。');};
  if(file.size>64*1024*1024)fail();
  const read=async(start,length)=>new Uint8Array(await file.slice(start,start+length).arrayBuffer());
  const tail=await read(Math.max(0,file.size-65557),65557),e=new DataView(tail.buffer);let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(e.getUint32(i,true)===0x06054b50&&i+22+e.getUint16(i+20,true)===tail.length){end=i;break;}
  if(end<0)fail();
  const count=e.getUint16(end+10,true),size=e.getUint32(end+12,true),offset=e.getUint32(end+16,true);
  if(e.getUint16(end+4,true)||e.getUint16(end+6,true)||e.getUint16(end+8,true)!==count||!count||count>4096||size>4*1024*1024||offset+size!==file.size-tail.length+end)fail();
  const directory=await read(offset,size),view=new DataView(directory.buffer),entries=new Map();let pos=0,total=0;
  for(let n=0;n<count;n++){
    if(pos+46>size||view.getUint32(pos,true)!==0x02014b50)fail();
    const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),compressed=view.getUint32(pos+20,true),expanded=view.getUint32(pos+24,true),length=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),local=view.getUint32(pos+42,true);
    if(pos+46+length+extra+comment>size||view.getUint16(pos+34,true)||flags&1||![0,8].includes(method)||[compressed,expanded,local].includes(0xffffffff))fail();
    const name=new TextDecoder('utf-8',{fatal:true}).decode(directory.slice(pos+46,pos+46+length));
    if(entries.has(name)||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||/vbaProject|vbaData/i.test(name))fail();
    total+=expanded;if(total>128*1024*1024)fail();
    entries.set(name,{flags,method,compressed,expanded,local,crc:view.getUint32(pos+16,true)});pos+=46+length+extra+comment;
  }
  if(pos!==size||!entries.has('[Content_Types].xml')||!entries.has('word/document.xml'))fail();
  const xml=[];let skipped=0;
  for(const name of ['docProps/core.xml','docProps/app.xml','docProps/custom.xml']){
    const item=entries.get(name);if(!item)continue;
    if(item.compressed>256*1024||item.expanded>256*1024||item.expanded>Math.max(1,item.compressed)*200){skipped++;continue;}
    const header=await read(item.local,30);if(header.length!==30)fail();
    const h=new DataView(header.buffer),nl=h.getUint16(26,true),xl=h.getUint16(28,true);
    if(h.getUint32(0,true)!==0x04034b50||h.getUint16(6,true)!==item.flags||h.getUint16(8,true)!==item.method)fail();
    const localValues=[h.getUint32(14,true),h.getUint32(18,true),h.getUint32(22,true)],expected=[item.crc,item.compressed,item.expanded];
    if(localValues.some((value,index)=>value!==expected[index]&&(!(item.flags&8)||value!==0)))fail();
    const localName=new TextDecoder('utf-8',{fatal:true}).decode(await read(item.local+30,nl));
    const start=item.local+30+nl+xl;if(localName!==name||start+item.compressed>offset)fail();
    if(item.flags&8){
      const descriptorStart=start+item.compressed;
      if(descriptorStart+12>offset)fail();
      const raw=await read(descriptorStart,Math.min(16,offset-descriptorStart)),descriptor=new DataView(raw.buffer);
      const matches=(at)=>raw.length>=at+12&&expected.every((value,index)=>descriptor.getUint32(at+index*4,true)===value);
      if(!matches(0)&&!(raw.length>=16&&descriptor.getUint32(0,true)===0x08074b50&&matches(4)))fail();
    }
    const bytes=await read(start,item.compressed);let output=bytes;
    if(item.method===8){
      let decompressor;try{decompressor=new DecompressionStream('deflate-raw');}catch{throw Error('此浏览器不支持 DOCX 解压，请使用较新的浏览器。');}
      const reader=new Blob([bytes]).stream().pipeThrough(decompressor).getReader();const blocks=[];let length=0;
      try{while(true){const value=await reader.read();if(value.done)break;length+=value.value.length;if(length>item.expanded||length>256*1024)fail();blocks.push(value.value);}}finally{await reader.cancel().catch(()=>{});}
      output=new Uint8Array(length);let at=0;for(const block of blocks){output.set(block,at);at+=block.length;}
    }
    if(output.length!==item.expanded)fail();
    let crc=0xffffffff;for(const byte of output){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    if(((crc^0xffffffff)>>>0)!==item.crc)fail();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(output);
    if(text.includes('\0')||/<!DOCTYPE|<!ENTITY/i.test(text)||/encoding\s*=\s*['"](?!utf-8['"])/i.test(text))fail();
    xml.push({name,text});
  }
  return {ok:true,findings:[],skipped,xml};
}
