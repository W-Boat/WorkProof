'use client';
import {useEffect,useRef,useState} from 'react';
import {Panel,Tag} from './institution-ui';
import {Button} from './button';
type Finding={field:string;location:string;value:string;hint:boolean};
const fieldLabels:Record<string,string>={software:'编辑软件',application:'编辑软件',creatortool:'创建工具',usercomment:'图片注释',comment:'文件注释',imagedescription:'图片说明',artist:'作者署名',creator:'作者署名',lastmodifiedby:'最后修改者',copyright:'版权说明',title:'标题',subject:'主题',description:'说明',keywords:'关键词',created:'创建时间',modified:'修改时间',prompt:'提示词',workflow:'工作流程',parameters:'生成参数',aigenerator:'生成工具',revision:'文档修订次数',pages:'页数',slides:'幻灯片数',words:'字数',company:'单位',manager:'负责人',totaltime:'编辑时长记录',template:'文档模板'};
function fieldLabel(field:string){const key=field.toLowerCase();return Object.prototype.hasOwnProperty.call(fieldLabels,key)?fieldLabels[key]:field;}
function jpegProperties(data:{findings:Finding[];skipped:number;xmp:{location:string;text:string}[]}){
  const findings=[...data.findings];let skipped=data.skipped;
  const clean=(value:string)=>value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,160);
  const rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  for(const packet of data.xmp){
    const xml=new DOMParser().parseFromString(packet.text,'application/xml'),root=xml.documentElement;
    if(xml.querySelector('parsererror')||xml.getElementsByTagName('*').length>4096){skipped++;continue;}
    const graph=root.namespaceURI===rdf&&root.localName==='RDF'?root:
      root.namespaceURI==='adobe:ns:meta/'&&root.localName==='xmpmeta'&&root.children.length===1?root.children[0]:null;
    if(!graph||graph.namespaceURI!==rdf||graph.localName!=='RDF'){skipped++;continue;}
    const add=(field:string,value:string,namespace:string)=>{
      if(findings.length>=32){skipped++;return;}
      findings.push({field:clean(field),value:clean(value),location:`${packet.location} · XMP · ${clean(namespace)}`,hint:['prompt','workflow','parameters','aigenerator'].includes(field.toLowerCase())});
    };
    for(const description of Array.from(graph.children)){
      if(description.namespaceURI!==rdf||description.localName!=='Description'){skipped++;continue;}
      for(const attribute of Array.from(description.attributes)){
        if(!attribute.namespaceURI||['http://www.w3.org/2000/xmlns/',rdf,'http://www.w3.org/XML/1998/namespace'].includes(attribute.namespaceURI))continue;
        add(attribute.localName,attribute.value,attribute.namespaceURI);
      }
      for(const property of Array.from(description.children)){
        if(!property.namespaceURI||property.namespaceURI===rdf||property.children.length||Array.from(property.attributes).some(a=>a.namespaceURI!== 'http://www.w3.org/2000/xmlns/')){skipped++;continue;}
        add(property.localName,property.textContent??'',property.namespaceURI);
      }
    }
  }
  return {findings,skipped,format:'jpeg' as const};
}
function documentProperties(parts:{name:string;text:string}[],skipped:number){
  const findings:Finding[]=[],clean=(text:string)=>text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,160);
  const namespaces:Record<string,string[]>={
    'docProps/core.xml':['http://schemas.openxmlformats.org/package/2006/metadata/core-properties'],
    'docProps/app.xml':['http://schemas.openxmlformats.org/officeDocument/2006/extended-properties','http://purl.oclc.org/ooxml/officeDocument/extendedProperties'],
    'docProps/custom.xml':['http://schemas.openxmlformats.org/officeDocument/2006/custom-properties','http://purl.oclc.org/ooxml/officeDocument/customProperties']};
  for(const part of parts){
    // Worker caps XML at 256 KiB per part and rejects DTD/entity declarations before parsing.
    const xml=new DOMParser().parseFromString(part.text,'application/xml');
    if(xml.querySelector('parsererror')||!namespaces[part.name]?.includes(xml.documentElement.namespaceURI??''))throw Error('文档属性 XML 格式不支持，本次未检查。');
    if(xml.getElementsByTagName('*').length>10000)throw Error('文档属性节点过多，本次未检查。');
    for(const element of Array.from(xml.documentElement.children)){
      const custom=part.name==='docProps/custom.xml',field=custom?element.getAttribute('name')??'':element.localName;
      if(custom&&(element.localName!=='property'||element.namespaceURI!==xml.documentElement.namespaceURI)){skipped++;continue;}
      // Only scalar properties; nested vectors and arbitrary XML structures are not interpreted.
      if(custom?(element.children.length!==1||element.children[0].children.length>0):element.children.length>0){skipped++;continue;}
      if(findings.length>=32){skipped++;continue;}
      findings.push({field:clean(field),location:part.name,value:clean(element.textContent??''),hint:custom&&['prompt','workflow','parameters','aigenerator'].includes(field.toLowerCase())});
    }
  }
  return {findings,skipped};
}
export function MetadataPanel({file}:{file:File|null}){
  const active=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setResult]=useState<{file:File;findings:Finding[];skipped:number;format?:'docx'|'pptx'|'jpeg'}|null>(null);
  const result=saved?.file===file?saved:null;
  function stop(){active.current?.terminate();active.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;}
  useEffect(()=>{setResult(null);setError('');setBusy(false);return stop;},[file]);
  function scan(){
    if(!file||busy)return;stop();setBusy(true);setResult(null);setError('');
    try{
      const worker=new Worker('/metadata-worker.js');active.current=worker;
      const fail=(message:string)=>{if(active.current!==worker)return;stop();setBusy(false);setError(message);};
      worker.onmessage=({data})=>{if(active.current!==worker)return;stop();setBusy(false);if(data.ok){try{const result=data.xml?{...documentProperties(data.xml,data.skipped),format:data.format}:data.format==='jpeg'?jpegProperties(data):data;setResult({...result,file});}catch{setError('文件属性 XML 格式不支持，本次未检查。');}}else setError(data.message);};
      worker.onerror=()=>fail('检查工具无法加载，请重新加载完整站点。');
      worker.onmessageerror=()=>fail('检查结果无法读取，请重试。');
      timer.current=setTimeout(()=>fail('检查耗时过长，已停止。'),15000);worker.postMessage({file});
    }catch{stop();setBusy(false);setError('检查工具无法启动，请重试。');}
  }
  return <Panel title="进一步检查 AI 线索" className="timestamp-panel"><details><summary>查看文件中的元数据（可选）</summary>
    <p>仅在本机读取 PNG 文字、JPEG 文件头属性或 DOCX/PPTX 文档属性，不上传文件。属性可能包含姓名、标题和提示词；请先确认这些信息可以在本页面显示。</p>
    <Button disabled={!file||busy} onClick={scan}>{busy?'正在读取元数据…':'检查所选作品的元数据'}</Button>
    {!file&&<p>先在上方选择作品文件。</p>}
    {busy&&<Button onClick={()=>{stop();setBusy(false);setError('已取消检查。');}}>取消元数据检查</Button>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div role="status">{result.format&&<Tag>{result.format==='jpeg'?'图片文件头属性（JPEG）':result.format==='pptx'?'演示文稿属性（PPTX）':'文字文档属性（DOCX）'}</Tag>}<p>{result.findings.some(item=>item.hint)?'发现可能与生成流程有关的字段，请结合来源核对。':'本次未发现已识别的生成流程字段；不能据此判断没有使用 AI。'}</p>
      {!!result.findings.length&&<p>读到 {result.findings.length} 项文件属性。它们是文件中填写的信息，未经真实性认证。</p>}
      <div className="metadata-findings">{result.findings.map((item,index)=><div className="metadata-finding" key={index}><Tag tone={item.hint?'info':'neutral'}>{fieldLabel(item.field)}</Tag><p>{item.value||'（字段为空）'}</p></div>)}</div>
      {!!result.findings.length&&<details><summary>查看原始字段与位置</summary><ol className="metadata-source-list">{result.findings.map((item,index)=><li key={index}>{item.field} · {item.location}</li>)}</ol></details>}
      {!!result.skipped&&<p>{result.skipped} 项不支持、过大、异常或超出显示上限的元数据未检查。</p>}</div>}
    <p>文件属性可以被修改或清除。这里提供复核线索，不判断作品是否由 AI 生成，也不改变证书核验结果。</p>
    <details className="caption"><summary>了解具体检查范围</summary><p>prompt、workflow 等字段名称只是线索；Word、WPS 等编辑软件名称不等于 AI 证据。DOCX/PPTX 仅检查三类文档属性，不读取文档或幻灯片正文、宏或外部链接；旧版 DOC/PPT 不支持。JPEG 只检查第一段图像扫描前的部分 EXIF、注释和简单 XMP 属性，跳过 GPS、缩略图、扩展 XMP 等内容。本功能未运行 AI 检测模型，未检查水印、像素或 C2PA 签名。PNG 压缩文字和 CRC 不检查。</p></details>
  </details></Panel>;
}
