'use client';
import {useEffect,useRef,useState} from 'react';
import {Panel,Tag} from './institution-ui';
import {Button} from './button';
import {Upload} from './FileDrop';
import type {TimestampResult} from '../lib/timestamps';
import {createTimestampRequestInWorker,verifyTimestampInWorker} from '../lib/timestamp-client';
export function TimestampPanel({signature}:{signature:string}){
  const [files,setFiles]=useState<(File|null)[]>([null,null,null]),[trusted,setTrusted]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState<TimestampResult|null>(null),[error,setError]=useState('');
  const generation=useRef(0),active=useRef<AbortController|null>(null);
  const [notice,setNotice]=useState('');
  useEffect(()=>()=>{generation.current++;active.current?.abort();},[]);
  function reset(){generation.current++;active.current?.abort();active.current=null;setResult(null);setError('');setNotice('');setTrusted(false);setBusy(false);}
  function cancel(){generation.current++;active.current?.abort();active.current=null;setBusy(false);setResult(null);setError('');setNotice('已取消。可以更换文件或重新检查。');}
  async function generate(){
    if(busy)return;
    const current=++generation.current,controller=new AbortController();active.current=controller;setBusy(true);setError('');setNotice('');
    try{
      const buffer=await createTimestampRequestInWorker(signature,controller.signal);
      if(current!==generation.current)return;
      const file=new File([buffer],'workproof-time-request.tsq',{type:'application/timestamp-query'});
      // A new nonce means a previous response cannot be reused with this request.
      setFiles([file,null,files[2]]);setTrusted(false);setResult(null);
      const url=URL.createObjectURL(file),anchor=document.createElement('a');
      anchor.href=url;anchor.download=file.name;document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(failure){if(current===generation.current)setError(failure instanceof Error?failure.message:'时间戳请求未能生成，请重试。');}
    finally{if(current===generation.current){active.current=null;setBusy(false);}}
  }
  async function verify(){
    if(busy||!trusted||files.some(file=>!file))return;
    const current=++generation.current,controller=new AbortController();active.current=controller;setBusy(true);setError('');setNotice('');setResult(null);
    try {
      if(files[0]!.size>8192||files[1]!.size>128*1024||files[2]!.size>256*1024)throw new Error('时间文件过大：请求最多8 KB，响应最多128 KB，信任证书最多256 KB。');
      const value=await verifyTimestampInWorker(signature,files as [File,File,File],controller.signal);
      if(current===generation.current)setResult(value);
    }catch(failure){if(current===generation.current)setError(failure instanceof Error&&failure.message.startsWith('时间')?failure.message:'时间凭据未能通过检查，请核对文件与信任来源。');}
    finally{if(current===generation.current){active.current=null;setBusy(false);}}
  }
  return <Panel title="检查外部时间凭据" className="timestamp-panel">
    <details><summary>添加或检查时间凭据（可选）</summary>
    <p>想证明这份签名在某个时间前已经存在，可以向独立时间服务申请凭据。已有请求和响应文件时，直接从第 3 步开始。作品和证书不会上传。</p>
    <p><strong>1. 生成请求文件</strong><br/>请求只含签名摘要和随机编号，不含作品内容。每次重新生成都会清除旧响应，请保留下载的原始请求。</p>
    <Button disabled={busy} onClick={generate}>生成并下载时间戳请求</Button>
    <p><strong>2. 交给你选择的时间服务</strong><br/>按服务方的说明提交 .tsq 文件，保存返回的 .tsr 文件。页面不会自动发送请求；服务方可能要求注册或收费。</p>
    <p><strong>3. 选择文件并检查</strong><br/>加载请求、响应和从可信渠道独立取得的 CA 证书。下面的检查在浏览器内完成。</p>
    <div className="timestamp-files">{[
      {label:'原始时间戳请求（.tsq）',caption:'工具生成并保留的请求，最多 8 KB',accept:'.tsq'},
      {label:'时间戳响应（.tsr）',caption:'时间服务返回的响应，最多 128 KB',accept:'.tsr'},
      {label:'你信任的 CA 证书（.pem）',caption:'从可信渠道取得的签发机构证书，最多 256 KB',accept:'.pem'},
    ].map((item,index)=><Upload key={item.label} {...item} file={files[index]} disabled={busy} onFile={file=>{if(busy)return;reset();setFiles(previous=>previous.map((value,i)=>i===index?file:value));}}/>)}</div>
    <p>CA 指为时间服务签发证书的机构。不确定该信任谁时，可以跳过这项可选检查。</p>
    <label className="quiet-label"><input type="checkbox" checked={trusted} disabled={busy||!files[2]} onChange={event=>{if(busy)return;generation.current++;setTrusted(event.target.checked);setResult(null);}}/>我已核对 CA 来源，并同意以这份 CA 作为本次信任依据</label>
    <Button disabled={busy||!trusted||files.some(file=>!file)} onClick={verify}>{busy?'请稍候…':'检查时间凭据'}</Button>
    {busy&&<p role="status">正在处理时间文件。可以取消；超过 15 秒会自动停止。</p>}
    {busy&&<Button onClick={cancel}>取消当前操作</Button>}
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div role="status"><Tag tone="ok">时间凭据与签名一致</Tag><p>服务声明的时间：<strong><time dateTime={result.time}>{new Date(result.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）</time></strong></p><p>在本次选择的 CA 信任范围内核验通过。它说明这份签名在该时间前已存在，不是实际创作起止时间。</p>{result.trustFingerprints.map(value=><p key={value}>信任证书 SHA-256：<code style={{overflowWrap:'anywhere'}}>{value}</code></p>)}</div>}
    <p className="caption">未查询撤销状态，不认证作者身份或人类创作比例。自建 CA 也可签发时间戳；通过检查不等于公共权威认可。当前仅支持 SHA-256、SigningCertificateV2 的 DER 时间凭据。</p>
    <p className="caption">时间结果不会写入原证书或证书图片。分享时请附上原始 .tsq 和 .tsr 文件；接收方仍需独立选择信任的 CA。</p>
    <p className="caption"><a href="/timestamp-licenses.txt" target="_blank" rel="noreferrer">查看相关开源组件许可</a></p>
    </details>
  </Panel>;
}
