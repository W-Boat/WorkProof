'use client';
import {useEffect,useRef,useState} from 'react';
import {Panel,Tag} from './institution-ui';
import {Button} from './button';
type Finding={field:string;location:string;value:string;hint:boolean};
export function MetadataPanel({file}:{file:File|null}){
  const active=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setResult]=useState<{file:File;findings:Finding[];skipped:number}|null>(null);
  const result=saved?.file===file?saved:null;
  function stop(){active.current?.terminate();active.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;}
  useEffect(()=>{setResult(null);setError('');setBusy(false);return stop;},[file]);
  function scan(){
    if(!file||busy)return;stop();setBusy(true);setResult(null);setError('');
    try{
      const worker=new Worker('/metadata-worker.js');active.current=worker;
      const fail=(message:string)=>{if(active.current!==worker)return;stop();setBusy(false);setError(message);};
      worker.onmessage=({data})=>{if(active.current!==worker)return;stop();setBusy(false);if(data.ok)setResult({...data,file});else setError(data.message);};
      worker.onerror=()=>fail('检查工具无法加载，请重新加载完整站点。');
      worker.onmessageerror=()=>fail('检查结果无法读取，请重试。');
      timer.current=setTimeout(()=>fail('检查耗时过长，已停止。'),15000);worker.postMessage({file});
    }catch{stop();setBusy(false);setError('检查工具无法启动，请重试。');}
  }
  return <Panel title="进一步检查 AI 线索" className="timestamp-panel"><details><summary>查看图片中的元数据（可选）</summary>
    <p>仅在本机读取所选 PNG 的文字字段，不上传图片。请先确认其中可能包含的提示词等信息可以在本页面显示。</p>
    <Button disabled={!file||busy} onClick={scan}>{busy?'正在读取元数据…':'检查所选作品的元数据'}</Button>
    {!file&&<p>先在上方选择作品文件。</p>}
    {busy&&<Button onClick={()=>{stop();setBusy(false);setError('已取消检查。');}}>取消元数据检查</Button>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div role="status"><p>{result.findings.some(item=>item.hint)?'发现可能与生成流程有关的字段，请结合来源核对。':'本次未发现已识别的生成流程字段；不能据此判断没有使用 AI。'}</p>
      {result.findings.map((item,index)=><div key={index}><Tag>{item.field}</Tag><p>{item.location}</p><p style={{overflowWrap:'anywhere'}}>{item.value||'（字段为空）'}</p></div>)}
      {!!result.skipped&&<p>{result.skipped} 项压缩、过大、异常或超出显示上限的元数据未检查。</p>}</div>}
    <p className="caption">这些字段可以添加、删除或伪造。prompt、workflow 等名称只是线索；普通编辑软件标记不等于 AI 证据。本功能未运行 AI 检测模型、未检查水印、像素、CRC 或 C2PA 签名，也不改变上方证书结果。当前不解压压缩文字。</p>
  </details></Panel>;
}
