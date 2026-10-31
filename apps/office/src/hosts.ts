import {blake3} from '@noble/hashes/blake3.js';
declare const Office:any;
declare const Word:any;
type HostGlobals=Window&{wps?:any;Application?:any};
export const fingerprint=(bytes:Uint8Array)=>Array.from(blake3(bytes),n=>n.toString(16).padStart(2,'0')).join('');
export type Snapshot={name:string;identity:string;characters:number;paragraphs:number;contentHash:string};
export interface Host {source:'word'|'wps';label:string;snapshot():Promise<Snapshot>;artifact():Promise<{name:string;bytes:Uint8Array}>}
function callback<T>(operation:(done:(result:any)=>void)=>void):Promise<T>{return new Promise((resolve,reject)=>operation(result=>result.status==='succeeded'?resolve(result.value):reject(new Error(result.error?.message||'宿主接口调用失败'))));}
function summarize(name:string,identity:string,text:string,paragraphs:number):Snapshot{
  if(text.length>20_000_000)throw new Error('当前原型的文档统计上限为 2000 万字符。');
  return {name,identity,characters:text.length,paragraphs,contentHash:fingerprint(new TextEncoder().encode(text))};
}
export async function detectHost():Promise<Host>{
  const w=window as HostGlobals;
  const application=w.Application||w.wps?.Application||(typeof w.wps?.WpsApplication==='function'?w.wps.WpsApplication():undefined);
  if(application?.ActiveDocument){
    return {source:'wps',label:'WPS 文字',async snapshot(){const doc=application.ActiveDocument;return summarize(String(doc.Name),String(doc.FullName||doc.Name),String(doc.Content.Text),Number(doc.Paragraphs.Count));},async artifact(){
      const doc=application.ActiveDocument;
      if(!doc.Path)throw new Error('请先保存 WPS 文档，再导出交付件。');
      doc.Save();
      const fileSystem=application.FileSystem||w.wps?.FileSystem;
      if(typeof fileSystem?.readAsBinaryString!=='function')throw new Error('当前 WPS 版本未提供二进制读取接口，无法绑定交付文件。');
      const binary=String(fileSystem.readAsBinaryString(String(doc.FullName)));
      if(binary.length>128*1024*1024)throw new Error('当前原型支持不超过 128 MB 的交付文件。');
      const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)&255);
      return {name:String(doc.Name),bytes};
    }};
  }
  if(typeof Office==='undefined'){
    await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src='https://appsforoffice.microsoft.com/lib/1/hosted/office.js';script.onload=()=>resolve();script.onerror=()=>reject(new Error('无法加载 Word 官方宿主接口，请检查网络。'));document.head.append(script);});
  }
  await Office.onReady();
  if(Office.context.host!=='Word'||typeof Word==='undefined')throw new Error('请在 Word 或 WPS 文字加载项中打开 WorkProof。');
  return {source:'word',label:'Microsoft Word',async snapshot(){
    return Word.run(async(context:any)=>{const body=context.document.body;body.load('text');body.paragraphs.load('items');await context.sync();const url=String(Office.context.document.url||'');const name=decodeURIComponent(url.split(/[\\/]/).at(-1)||'document.docx').replace(/\?.*$/,'');return summarize(name,url||name,String(body.text),body.paragraphs.items.length);});
  },async artifact(){
    if(!Office.context.requirements.isSetSupported('CompressedFile','1.1'))throw new Error('当前 Word 版本不支持压缩交付文件导出。');
    const file:any=await callback(done=>Office.context.document.getFileAsync('compressed',{sliceSize:65536},done));
    try{
      if(file.size>128*1024*1024)throw new Error('当前原型支持不超过 128 MB 的交付文件。');
      const bytes=new Uint8Array(file.size);let offset=0;
      for(let index=0;index<file.sliceCount;index++){
        const slice:any=await callback(done=>file.getSliceAsync(index,done));const chunk=Uint8Array.from(slice.data as number[]);bytes.set(chunk,offset);offset+=chunk.length;
      }
      if(offset!==file.size)throw new Error('Word 导出文件切片不完整，请重试。');
      const current=await this.snapshot();return {name:current.name.replace(/\.[^.]*$/,'')+'.docx',bytes};
    }finally{await callback(done=>file.closeAsync(done));}
  }};
}
