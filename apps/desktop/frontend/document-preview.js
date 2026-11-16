import {blake3} from '@noble/hashes/blake3.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {wordOperation} from './word-operation.js';

export async function previewDocument(file,locations,wordLocations=[]){
  if(file.size>8*1024*1024)throw new Error('文件超过 8 MiB 的内嵌预览范围。');
  if(/\.(png|jpe?g|webp)$/i.test(file.name)){
    const bytes=new Uint8Array(await file.arrayBuffer());
    const png=[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte);
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const header=new TextDecoder().decode(bytes.subarray(0,12));
    const webp=header.startsWith('RIFF')&&header.endsWith('WEBP');
    const type=png?'image/png':jpeg?'image/jpeg':webp?'image/webp':'';
    if(!type)throw new Error('图片文件头不符合受支持的预览格式。');
    const parts=[];
    for(let offset=0;offset<bytes.length;offset+=16384)parts.push(String.fromCharCode(...bytes.subarray(offset,offset+16384)));
    const image='<img alt="已核验的作品" src="data:'+type+';base64,'+btoa(parts.join(''))+'">';
    return {html:previewHtml(image),excerpts:[]};
  }
  const runtime=await import('./editor-runtime.js');
  let content;
  if(/\.docx$/i.test(file.name)){
    content=await wordOperation('import',{bytes:await file.arrayBuffer()});
  }else if(/\.(md|markdown|txt)$/i.test(file.name)){
    const editor=new runtime.Editor({element:document.createElement('div'),extensions:runtime.editorExtensions()});
    try{content=editor.markdown.parse(await file.text());}finally{editor.destroy();}
  }else{
    throw new Error('该格式没有内嵌渲染器。可在记录页查看已采集的操作。');
  }
  const rendered=document.createElement('template');
  rendered.innerHTML=runtime.generateHTML(content,runtime.editorExtensions());
  rendered.content.querySelectorAll('a[href]').forEach(link=>link.removeAttribute('href'));
  const expected=new Map(locations.filter(location=>location.historical_id===undefined).map(location=>[location.ordinal,location.fingerprint]));
  const encoder=new TextEncoder();
  function textOf(node){
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue||'';
    if(node.nodeName==='BR')return '\n';
    return Array.from(node.childNodes,textOf).join('');
  }
  const excerpts=[];
  const blocks=Array.from(rendered.content.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre'));
  blocks.forEach((block,index)=>{
    const ordinal=index+1, fingerprint=expected.get(ordinal);
    if(fingerprint&&bytesToHex(blake3(encoder.encode(textOf(block))))===fingerprint){
      excerpts.push({ordinal,text:Array.from(textOf(block)).slice(0,160).join('')});
      block.classList.add('located');block.id='paragraph-'+ordinal;
    }
  });
  if(wordLocations.length&&blocks.length<=4096){
    const matches=new Map();
    const candidateHashes=new Set(wordLocations.map(item=>item.fingerprint));
    const buffer=new Uint8Array(2*262144);
    let scanned=0;
    for(const block of blocks){
      const text=textOf(block).replaceAll('\n','\v');
      scanned+=text.length;
      if(scanned>262144){matches.clear();break;}
      const bytes=buffer.subarray(0,text.length*2);
      const units=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      for(let index=0;index<text.length;index++)units.setUint16(index*2,text.charCodeAt(index),true);
      const hash=bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
      if(candidateHashes.has(hash))matches.set(hash,matches.has(hash)?null:block);
    }
    const seen=new Set();
    for(const item of wordLocations){
      const block=matches.get(item.fingerprint);
      if(!block||seen.has(block))continue;
      seen.add(block);block.classList.add('located');block.id='word-paragraph-'+item.fingerprint;
      const ordinal=blocks.indexOf(block)+1;
      excerpts.push({ordinal,text:Array.from(textOf(block)).slice(0,160).join('')});
    }
  }
  return {html:previewHtml(rendered.innerHTML),excerpts};
}

function previewHtml(body){
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; form-action \'none\'">'+
    '<style>body{max-width:48rem;margin:24px auto;padding:0 24px;font:16px/1.7 system-ui;color:#242424;background:#fff}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:.3rem}pre{white-space:pre-wrap}.located{background:#e5f4ff;outline:1px solid #1672b2;outline-offset:3px}</style></head><body>'+
    body+'</body></html>';
}
