import {blake3} from '@noble/hashes/blake3.js';
declare const Office:any;
declare const Word:any;
type HostGlobals=Window&{wps?:any;Application?:any};
export const fingerprint=(bytes:Uint8Array)=>Array.from(blake3(bytes),n=>n.toString(16).padStart(2,'0')).join('');
export type Snapshot={name:string;identity:string;characters:number;paragraphs:number;contentHash:string;metrics?:Record<string,number>};
export interface Host {source:'word'|'wps'|'wps-presentation'|'wps-spreadsheets';label:string;snapshot():Promise<Snapshot>;artifact():Promise<{name:string;bytes:Uint8Array}>}
function callback<T>(operation:(done:(result:any)=>void)=>void):Promise<T>{return new Promise((resolve,reject)=>operation(result=>result.status==='succeeded'?resolve(result.value):reject(new Error(result.error?.message||'宿主接口调用失败'))));}
function summarize(name:string,identity:string,text:string,paragraphs:number):Snapshot{
  if(text.length>20_000_000)throw new Error('当前原型的文档统计上限为 2000 万字符。');
  return {name,identity,characters:text.length,paragraphs,contentHash:fingerprint(new TextEncoder().encode(text))};
}
export async function detectHost():Promise<Host>{
  const w=window as HostGlobals;
  const mode=new URLSearchParams(window.location.search).get('host');
  const sources=[w.Application,w.wps?.Application,w.wps];
  if(mode==='wps-presentation'||mode==='wps-spreadsheets'){
    const presentation=mode==='wps-presentation';
    const property=presentation?'ActivePresentation':'ActiveWorkbook';
    const application=sources.find(api=>api?.[property]);
    const label=presentation?'WPS 演示':'WPS 表格';
    const active=()=>{
      const document=application?.[property];
      if(!document?.Path||!document.FullName)throw new Error('请在'+label+'打开并保存一份本地文件。');
      return document;
    };
    return {source:mode,label,async snapshot():Promise<Snapshot>{
      const document=active();
      const collection=presentation?document.Slides:document.Worksheets;
      const count=Number(collection.Count);
      if(!Number.isSafeInteger(count)||count<0||count>128)throw new Error('当前最多支持 128 张幻灯片或工作表。');
      const chunks:string[]=[];
      let objects=0,totalChars=0;
      for(let index=1;index<=count;index++){
        const item=collection.Item(index);
        if(presentation){
          const shapes=item.Shapes;
          const shapeCount=Number(shapes.Count);
          if(!Number.isSafeInteger(shapeCount)||shapeCount<0||objects+shapeCount>4096)throw new Error('当前最多支持 4096 个幻灯片对象。');
          const rows=[];
          for(let k=1;k<=shapeCount;k++){
            const shape=shapes.Item(k);
            const text=shape.HasTextFrame?String(shape.TextFrame.TextRange.Text||''):'';
            totalChars+=text.length;
            if(totalChars>2_000_000)throw new Error('演示文稿超出可采样文字范围。');
            rows.push([shape.Type,shape.Left,shape.Top,shape.Width,shape.Height,shape.Rotation,text]);
          }
          chunks.push(JSON.stringify(rows));objects+=shapeCount;
        }else{
          const range=item.UsedRange;
          const cells=Number(range.Rows.Count)*Number(range.Columns.Count);
          if(!Number.isSafeInteger(cells)||cells<0||objects+cells>20000)throw new Error('当前最多支持 2 万个使用区域单元格。');
          const formulas=range.Formula;
          if(formulas===undefined)throw new Error('当前 WPS 版本未提供可用的区域公式接口。');
          const rows=JSON.stringify([String(item.Name),range.Row,range.Column,formulas]);
          totalChars+=rows.length;
          if(totalChars>2_000_000)throw new Error('工作簿超出可采样内容范围。');
          chunks.push(rows);objects+=cells;
        }
      }
      return {name:String(document.Name),identity:String(document.FullName),characters:0,paragraphs:0,
        contentHash:fingerprint(new TextEncoder().encode(JSON.stringify(chunks))),
        metrics:presentation?{slides:count,shapes:objects}:{sheets:count,used_cells:objects}};
    },artifact:()=>wpsArtifact(active(),application,w)};
  }
  const application=sources.find(api=>api?.ActiveDocument)||
    (typeof w.wps?.WpsApplication==='function'?w.wps.WpsApplication():undefined);
  if(application?.ActiveDocument){
    return {source:'wps',label:'WPS 文字',async snapshot(){const doc=application.ActiveDocument;return summarize(String(doc.Name),String(doc.FullName||doc.Name),String(doc.Content.Text),Number(doc.Paragraphs.Count));},artifact:()=>wpsArtifact(application.ActiveDocument,application,w)};
  }
  if(mode==='wps')throw new Error('当前 WPS 未提供可用的文档接口，请打开文字文档并确认加载项权限。');
  return detectWord();
}

async function wpsArtifact(doc:any,application:any,w:HostGlobals){
      if(!doc.Path)throw new Error('请先保存 WPS 文档，再导出交付件。');
      const fullName=String(doc.FullName);
      await doc.Save();
      if(doc.Saved===false)throw new Error('WPS 文档保存未完成，请保存后重试。');
      const fileSystem=application.FileSystem||w.wps?.FileSystem;
      if(typeof fileSystem?.readAsBinaryString!=='function')throw new Error('当前 WPS 版本未提供二进制读取接口，无法绑定交付文件。');
      if(String(doc.FullName)!==fullName)throw new Error('保存期间文档路径发生变化，请重新开始记录。');
      const binary=fileSystem.readAsBinaryString(fullName);
      if(typeof binary!=='string'||!binary.length)throw new Error('WPS 未返回有效交付文件，请保存后重试。');
      if(binary.length>128*1024*1024)throw new Error('当前原型支持不超过 128 MB 的交付文件。');
      const bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++){
        const value=binary.charCodeAt(i);
        if(value>255)throw new Error('WPS 返回的数据不是二进制字节，已取消交付件导出。');
        bytes[i]=value;
      }
      return {name:String(doc.Name),bytes};
}

async function detectWord():Promise<Host>{
  if(typeof Office==='undefined'){
    await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src='https://appsforoffice.microsoft.com/lib/1/hosted/office.js';script.onload=()=>resolve();script.onerror=()=>reject(new Error('无法加载 Word 官方宿主接口，请检查网络。'));document.head.append(script);});
  }
  await Office.onReady();
  if(Office.context.host!=='Word'||typeof Word==='undefined')throw new Error('请在 Word 或 WPS 文字加载项中打开 WorkProof。');
  const wordSnapshot=async():Promise<Snapshot>=>{
    return Word.run(async(context:any)=>{const body=context.document.body;body.load('text');body.paragraphs.load('items');await context.sync();const url=String(Office.context.document.url||'');const name=decodeURIComponent(url.split(/[\\/]/).at(-1)||'document.docx').replace(/\?.*$/,'');return summarize(name,url||name,String(body.text),body.paragraphs.items.length);});
  };
  return {source:'word',label:'Microsoft Word',snapshot:wordSnapshot,async artifact(){
    if(!Office.context.requirements.isSetSupported('CompressedFile','1.1'))throw new Error('当前 Word 版本不支持压缩交付文件导出。');
    const file:any=await callback(done=>Office.context.document.getFileAsync('compressed',{sliceSize:65536},done));
    try{
      if(file.size>128*1024*1024)throw new Error('当前原型支持不超过 128 MB 的交付文件。');
      const bytes=new Uint8Array(file.size);let offset=0;
      for(let index=0;index<file.sliceCount;index++){
        const slice:any=await callback(done=>file.getSliceAsync(index,done));const chunk=Uint8Array.from(slice.data as number[]);bytes.set(chunk,offset);offset+=chunk.length;
      }
      if(offset!==file.size)throw new Error('Word 导出文件切片不完整，请重试。');
      const current=await wordSnapshot();return {name:current.name.replace(/\.[^.]*$/,'')+'.docx',bytes};
    }finally{await callback(done=>file.closeAsync(done));}
  }};
}
