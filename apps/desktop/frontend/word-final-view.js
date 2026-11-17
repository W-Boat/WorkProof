import {unzipSync,zipSync} from 'fflate';

const WORD_NAMESPACES=[
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
];
const REVISION_ELEMENTS=new Set(['ins','del','moveFrom','moveTo','delText','delInstrText']);
const MAIN_PART='word/document.xml';
const PART_LIMIT=8*1024*1024;
const PACKAGE_LIMIT=32*1024*1024;

// The Word add-in fingerprints the final paragraph text. Resolve tracked text
// revisions on a preview copy before passing it to the offline DOCX converter.
export function wordFinalView(buffer){
  const archive=new Uint8Array(buffer);
  let partsSeen=0,total=0;
  const main=unzipSync(archive,{filter:part=>{
    total+=part.originalSize;
    if(++partsSeen>2048||part.originalSize>PART_LIMIT||total>PACKAGE_LIMIT){
      throw new Error('Word 文件解压后过大，请拆分文件。');
    }
    return part.name===MAIN_PART;
  }})[MAIN_PART];
  if(!main)return buffer;

  const xml=new TextDecoder('utf-8',{fatal:true}).decode(main);
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Word 正文包含不支持的 XML 声明。');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(!WORD_NAMESPACES.includes(doc.documentElement.namespaceURI)||doc.documentElement.localName!=='document'){
    throw new Error('无法读取 Word 正文。');
  }
  const namespace=doc.documentElement.namespaceURI;
  const revisions=Array.from(doc.getElementsByTagNameNS(namespace,'*'))
    .filter(element=>REVISION_ELEMENTS.has(element.localName));
  if(!revisions.length)return buffer;
  for(const element of revisions){
    if(element.localName==='ins'||element.localName==='moveTo'){
      while(element.firstChild)element.before(element.firstChild);
    }
    element.remove();
  }
  const parts=unzipSync(archive);
  parts[MAIN_PART]=new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
  return zipSync(parts,{level:1}).buffer;
}
