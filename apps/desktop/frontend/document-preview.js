import {blake3} from '@noble/hashes/blake3.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {wordOperation} from './word-operation.js';

export async function previewDocument(file,locations){
  if(file.size>8*1024*1024)throw new Error('文件超过 8 MiB 的内嵌预览范围。');
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
  const rendered=new DOMParser().parseFromString(runtime.generateHTML(content,runtime.editorExtensions()),'text/html');
  rendered.body.querySelectorAll('a[href]').forEach(link=>link.removeAttribute('href'));
  const expected=new Map(locations.map(location=>[location.ordinal,location.fingerprint]));
  const encoder=new TextEncoder();
  function textOf(node){
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue||'';
    if(node.nodeName==='BR')return '\n';
    return Array.from(node.childNodes,textOf).join('');
  }
  rendered.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre').forEach((block,index)=>{
    const ordinal=index+1, fingerprint=expected.get(ordinal);
    if(fingerprint&&bytesToHex(blake3(encoder.encode(textOf(block))))===fingerprint){
      block.classList.add('located');block.id='paragraph-'+ordinal;
    }
  });
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; form-action \'none\'">'+
    '<style>body{max-width:48rem;margin:24px auto;padding:0 24px;font:16px/1.7 system-ui;color:#242424;background:#fff}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:.3rem}pre{white-space:pre-wrap}.located{background:#e5f4ff;outline:1px solid #1672b2;outline-offset:3px}</style></head><body>'+
    rendered.body.innerHTML+'</body></html>';
}
