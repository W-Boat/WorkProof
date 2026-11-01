'use client';
import {useEffect,useRef,useState} from 'react';
import {Panel,Tag} from './institution-ui';
import {Button} from './button';
import {Upload} from './FileDrop';
import type {TimestampResult} from '../lib/timestamps';
export function TimestampPanel({signature}:{signature:string}){
  const [files,setFiles]=useState<(File|null)[]>([null,null,null]),[trusted,setTrusted]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState<TimestampResult|null>(null),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++},[]);
  function reset(){generation.current++;setResult(null);setError('');setTrusted(false);setBusy(false);}
  async function verify(){
    if(busy||!trusted||files.some(file=>!file))return;
    const current=++generation.current;setBusy(true);setError('');setResult(null);
    try {
      if(files[0]!.size>8192||files[1]!.size>128*1024||files[2]!.size>256*1024)throw new Error('时间文件过大：请求最多8 KB，响应最多128 KB，信任证书最多256 KB。');
      const {verifyTimestamp}=await import('../lib/timestamps');
      const value=await verifyTimestamp(signature,await files[0]!.arrayBuffer(),await files[1]!.arrayBuffer(),await files[2]!.text());
      if(current===generation.current)setResult(value);
    }catch(failure){if(current===generation.current)setError(failure instanceof Error&&failure.message.startsWith('时间')?failure.message:'时间凭据未能通过检查，请核对文件与信任来源。');}
    finally{if(current===generation.current)setBusy(false);}
  }
  return <Panel title="检查外部时间凭据" className="timestamp-panel">
    <details><summary>有时间戳请求与响应？展开检查（可选）</summary>
    <p>如果提供者附上了时间戳请求和响应，可在这里单独检查。只选择你通过可信渠道取得并决定信任的 CA 证书；文件留在浏览器内。</p>
    <div className="timestamp-files">{[
      {label:'原始时间戳请求（.tsq）',caption:'工具生成并保留的请求，最多 8 KB',accept:'.tsq'},
      {label:'时间戳响应（.tsr）',caption:'时间服务返回的响应，最多 128 KB',accept:'.tsr'},
      {label:'你信任的 CA 证书（.pem）',caption:'从可信渠道取得的签发机构证书，最多 256 KB',accept:'.pem'},
    ].map((item,index)=><Upload key={item.label} {...item} file={files[index]} disabled={busy} onFile={file=>{if(busy)return;reset();setFiles(previous=>previous.map((value,i)=>i===index?file:value));}}/>)}</div>
    <p>CA 指为时间服务签发证书的机构。不确定该信任谁时，可以跳过这项可选检查。</p>
    <label className="quiet-label"><input type="checkbox" checked={trusted} disabled={busy||!files[2]} onChange={event=>{if(busy)return;generation.current++;setTrusted(event.target.checked);setResult(null);}}/>我已核对 CA 来源，并同意以这份 CA 作为本次信任依据</label>
    <Button disabled={busy||!trusted||files.some(file=>!file)} onClick={verify}>{busy?'正在检查时间凭据…':'检查时间凭据'}</Button>
    {error&&<p role="alert">{error}</p>}
    {result&&<div role="status"><Tag tone="ok">时间凭据与签名一致</Tag><p>服务声明的时间：<strong>{result.time}</strong></p><p>在本次选择的 CA 信任范围内核验通过。它说明这份签名在该时间前已存在，不是实际创作起止时间。</p>{result.trustFingerprints.map(value=><p key={value}>信任证书 SHA-256：<code style={{overflowWrap:'anywhere'}}>{value}</code></p>)}</div>}
    <p className="caption">未查询撤销状态，不认证作者身份或人类创作比例。自建 CA 也可签发时间戳；通过检查不等于公共权威认可。当前仅支持 SHA-256、SigningCertificateV2 的 DER 时间凭据。</p>
    <p className="caption">时间结果不会写入原证书或证书图片。分享时请附上原始 .tsq 和 .tsr 文件；接收方仍需独立选择信任的 CA。</p>
    <p className="caption"><a href="/timestamp-licenses.txt" target="_blank" rel="noreferrer">查看相关开源组件许可</a></p>
    </details>
  </Panel>;
}
