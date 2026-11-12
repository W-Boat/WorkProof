'use client';
import {useEffect,useRef,useState} from 'react';
import {Panel,Tag,Details} from './institution-ui';
import {Button} from './button';
type Finding={field:string;location:string;value:string;hint:boolean;explanation?:string};
const fieldLabels:Record<string,string>={software:'编辑软件',application:'编辑软件',creatortool:'创建工具',usercomment:'图片注释',comment:'文件注释',imagedescription:'图片说明',artist:'作者署名',creator:'作者署名',lastmodifiedby:'最后修改者',copyright:'版权说明',title:'标题',subject:'主题',description:'说明',keywords:'关键词',created:'创建时间',modified:'修改时间',prompt:'提示词',workflow:'工作流程',parameters:'生成参数',aigenerator:'生成工具',revision:'文档修订次数',pages:'页数',slides:'幻灯片数',words:'字数',company:'单位',manager:'负责人',totaltime:'编辑时长记录',template:'文档模板'};
function fieldLabel(field:string){const key=field.toLowerCase();return Object.prototype.hasOwnProperty.call(fieldLabels,key)?fieldLabels[key]:field;}
// Adapted Chinese summaries: IPTC NewsCodes, Copyright 2024 IPTC, CC BY 4.0.
// Attribution, source URIs and modifications: public/notices/iptc-newscodes.txt.
const sourceTypes=new Map([
  ['http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',{hint:true,text:'文件标注：使用生成式 AI 创建。此标注可被修改，尚未验证其真实性。'}],
  ['http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',{hint:true,text:'文件标注：使用生成式 AI 编辑。此标注可被修改，尚未验证其真实性。'}],
  ['http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced',{hint:false,text:'文件标注：经过算法调整，例如锐化或降噪。这不等于使用生成式 AI；标注本身也未经认证。'}]
]);
function imageProperties(data:{format:'jpeg'|'png';findings:Finding[];skipped:number;xmp:{location:string;text:string}[]}){
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
      const source=namespace==='http://iptc.org/std/Iptc4xmpExt/2008-02-29/'&&field==='DigitalSourceType'?sourceTypes.get(value.trim()):undefined;
      findings.push({field:clean(field),value:clean(value),location:`${packet.location} · XMP · ${clean(namespace)}`,hint:source?.hint??['prompt','workflow','parameters','aigenerator'].includes(field.toLowerCase()),...(source?{explanation:source.text}:{})});
    };
    for(const description of Array.from(graph.children)){
      if(description.namespaceURI!==rdf||description.localName!=='Description'){skipped++;continue;}
      for(const attribute of Array.from(description.attributes)){
        if(!attribute.namespaceURI||['http://www.w3.org/2000/xmlns/',rdf,'http://www.w3.org/XML/1998/namespace'].includes(attribute.namespaceURI))continue;
        add(attribute.localName,attribute.value,attribute.namespaceURI);
      }
      for(const property of Array.from(description.children)){
        const attributes=Array.from(property.attributes).filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/');
        const resource=attributes.length===1&&attributes[0].namespaceURI===rdf&&attributes[0].localName==='resource'&&!property.textContent?.trim()?attributes[0].value:null;
        if(!property.namespaceURI||property.namespaceURI===rdf||property.children.length||(attributes.length&&resource===null)){skipped++;continue;}
        add(property.localName,resource??property.textContent??'',property.namespaceURI);
      }
    }
  }
  return {findings,skipped,format:data.format};
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
export function MetadataPanel({file,title='进一步检查 AI 线索',expanded=false}:{file:File|null;title?:string;expanded?:boolean}){
  const active=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setResult]=useState<{file:File;findings:Finding[];skipped:number;format?:'docx'|'pptx'|'jpeg'|'png'}|null>(null);
  const result=saved?.file===file?saved:null;
  function stop(){active.current?.terminate();active.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;}
  useEffect(()=>{setResult(null);setError('');setBusy(false);return stop;},[file]);
  function scan(){
    if(!file||busy)return;stop();setBusy(true);setResult(null);setError('');
    try{
      const worker=new Worker('/metadata-worker.js');active.current=worker;
      const fail=(message:string)=>{if(active.current!==worker)return;stop();setBusy(false);setError(message);};
      worker.onmessage=({data})=>{if(active.current!==worker)return;stop();setBusy(false);if(data.ok){try{const result=data.xml?{...documentProperties(data.xml,data.skipped),format:data.format}:data.xmp?imageProperties(data):data;setResult({...result,file});}catch{setError('文件属性 XML 格式不支持，本次未检查。');}}else setError(data.message);};
      worker.onerror=()=>fail('检查工具无法加载，请重新加载完整站点。');
      worker.onmessageerror=()=>fail('检查结果无法读取，请重试。');
      timer.current=setTimeout(()=>fail('检查耗时过长，已停止。'),15000);worker.postMessage({file});
    }catch{stop();setBusy(false);setError('检查工具无法启动，请重试。');}
  }
  return <Panel title={title} className="timestamp-panel"><Details label="查看作品的文件属性（可选）" expanded={expanded}>
    <p>读取作品里保存的软件名称、说明或生成参数，不会上传作品。支持 PNG、JPEG、DOCX 和 PPTX；属性可能包含姓名和提示词，检查后会显示在这里。</p>
    {file&&<p className="metadata-selected-file">检查对象：<strong>{file.name}</strong></p>}
    <Button disabled={!file||busy} onClick={scan}>{busy?'正在检查文件属性…':'检查文件属性'}</Button>
    {!file&&<p>先在上方选择作品文件。</p>}
    {busy&&<Button onClick={()=>{stop();setBusy(false);setError('已取消检查。');}}>取消检查</Button>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div role="status">{result.format&&<Tag>{result.format==='jpeg'?'图片文件头属性（JPEG）':result.format==='png'?'图片文字属性（PNG）':result.format==='pptx'?'演示文稿属性（PPTX）':'文字文档属性（DOCX）'}</Tag>}<p>{result.findings.some(item=>item.hint)?'发现可能与 AI 生成有关的记录，请向作品提供者核对来源。':'本次未找到已识别的 AI 生成标记；不能据此判断没有使用 AI。'}</p>
      {!!result.findings.length&&<p>读到 {result.findings.length} 项文件属性。它们是文件中填写的信息，未经真实性认证。</p>}
      <div className="metadata-findings">{result.findings.map((item,index)=><div className="metadata-finding" key={index}><Tag tone={item.hint?'info':'neutral'}>{item.field==='DigitalSourceType'?'来源类型（文件自述）':fieldLabel(item.field)}</Tag><p>{item.explanation||item.value||'（字段为空）'}</p></div>)}</div>
      {!!result.findings.length&&<Details label="查看原始字段与位置"><ol className="metadata-source-list">{result.findings.map((item,index)=><li key={index}>{item.field} · {item.location}{item.explanation&&<code> · {item.value}</code>}</li>)}</ol></Details>}
      {!!result.skipped&&<p>{result.skipped} 项文件属性因格式不支持、内容过大、数据异常或数量过多而未检查。</p>}</div>}
    <p>文件属性可以被修改或清除。这里提供复核线索，不判断作品是否由 AI 生成，也不改变证书核验结果。</p>
    <Details label="了解具体检查范围" className="caption"><p>prompt、workflow 等字段名称只是线索；Word、WPS 等编辑软件名称不等于 AI 证据。DOCX/PPTX 仅检查三类文档属性，不读取文档或幻灯片正文、宏或外部链接；旧版 DOC/PPT 不支持。JPEG 只检查第一段图像扫描前的部分 EXIF、注释和简单 XMP 属性，跳过 GPS、缩略图、扩展 XMP 等内容。本功能未运行 AI 检测模型，未检查水印、像素或 C2PA 签名。PNG 可读取未压缩及受限解压的文字属性，并检查这些文字块的 CRC；损坏、过大或浏览器无法解压的属性会跳过。CRC 只能帮助发现数据损坏，不认证来源；这里不校验 PNG 像素块。</p><p>来源类型的中文说明根据 IPTC NewsCodes 改写，© 2024 IPTC，采用 CC BY 4.0。<a href="/notices/iptc-newscodes.txt" download>保存来源与许可说明</a></p></Details>
  </Details></Panel>;
}
