// Existing offline DOCX converter. No network, credentials, or format codec here.
import {parseDOCX,generateDOCXSync} from '@docen/docx/core';

function checkZip(bytes){
  if(bytes.byteLength>8*1024*1024)throw new Error('Word 文件超过 8 MB，请先缩小文件。');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('请选择完整的 .docx 文件。');
  const entries=v.getUint16(end+10,true),offset=v.getUint32(end+16,true);if(entries>2048||offset>=bytes.length)throw new Error('Word 文件结构过于复杂。');
  let p=offset,total=0;
  for(let i=0;i<entries;i++){if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw new Error('Word 文件结构不完整。');const size=v.getUint32(p+24,true);total+=size;if(size>8*1024*1024||total>32*1024*1024)throw new Error('Word 文件解压后过大，请拆分文件。');p+=46+v.getUint16(p+28,true)+v.getUint16(p+30,true)+v.getUint16(p+32,true);}
}
// Schema bridge only. DOCX parsing and writing stay in the upstream package.
const supported=new Set(['doc','paragraph','heading','text','bulletList','orderedList','listItem','blockquote','codeBlock','hardBreak','horizontalRule','table','tableRow','tableHeader','tableCell','pageBreak']);
function normalize(node,depth=0){
  if(depth>48)throw new Error('Word 文件嵌套过深。');
  const content=(node.content||[]).flatMap(n=>normalize(n,depth+1));
  if(!supported.has(node.type))return content;
  const n={type:node.type};
  if(node.type==='text')n.text=String(node.text||'');
  if(content.length)n.content=content;
  if(node.marks)n.marks=node.marks.filter(m=>['bold','italic','underline','strike','code'].includes(m.type)).map(m=>({type:m.type}));
  const a=node.attrs||{},attrs={};
  if(node.type==='heading')attrs.level=Math.max(1,Math.min(3,Number(a.level)||1));
  if(['left','center','right','justify'].includes(a.textAlign))attrs.textAlign=a.textAlign;
  if(['tableCell','tableHeader'].includes(node.type)){attrs.colspan=Math.max(1,Math.min(30,Number(a.colspan)||1));attrs.rowspan=Math.max(1,Math.min(30,Number(a.rowspan)||1));}
  if(Object.keys(attrs).length)n.attrs=attrs;
  return [n];
}
self.onmessage=async({data})=>{
  try{
    if(data.action==='import'){
      const bytes=new Uint8Array(data.bytes);checkZip(bytes);const parsed=await parseDOCX(bytes);const result=normalize(parsed)[0];if(result?.type!=='doc')throw new Error('Word 插件未返回有效文档。');
      if(JSON.stringify(result).length>2*1024*1024)throw new Error('Word 正文过大，请拆分文件。');self.postMessage({result});
    }else if(data.action==='export'){
      const output=await generateDOCXSync(data.content,{packer:{type:'uint8array'}});const result=Uint8Array.from(output);if(result.length>8*1024*1024)throw new Error('导出的 Word 文件超过 8 MB。');self.postMessage({result},[result.buffer]);
    }else throw new Error('不支持的 Word 操作。');
  }catch(error){self.postMessage({error:error instanceof Error?error.message:'Word 插件未能完成转换。'});}
};
