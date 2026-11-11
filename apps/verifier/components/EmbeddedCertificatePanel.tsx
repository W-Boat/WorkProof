'use client';
import {useEffect,useRef,useState} from 'react';
import {Panel,Tag,Checkbox,Details} from './institution-ui';
import {Upload} from './FileDrop';
import {Button} from './button';
type Summary={scope:string;disclosed:number;total:number};
export function EmbeddedCertificatePanel(){
  const [asset,setAsset]=useState<File|null>(null),[ca,setCa]=useState<File|null>(null);
  const [trusted,setTrusted]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [result,setResult]=useState<Summary|null>(null);
  const active=useRef<AbortController|null>(null),generation=useRef(0);
  function reset(){generation.current++;active.current?.abort();active.current=null;setBusy(false);setResult(null);setMessage('');setTrusted(false);}
  useEffect(()=>()=>{generation.current++;active.current?.abort();},[]);
  async function check(){
    if(!asset||!ca||!trusted||busy)return;
    const id=++generation.current,controller=new AbortController();active.current=controller;
    setBusy(true);setMessage('正在本机检查签名、作品和过程记录…');setResult(null);
    try{
      if(asset.size>96*1024*1024||ca.size>256*1024||ca.size===0)throw Error('INPUT_LIMIT');
      const moduleUrl='/c2pa/client.mjs';
      const runtime=await import(/* webpackIgnore: true */ moduleUrl);
      if(id!==generation.current)return;
      const report=await runtime.verifyEmbeddedFile(asset,ca,{signal:controller.signal,workerUrl:'/c2pa/worker.mjs'});
      if(id!==generation.current)return;
      setResult({scope:report.workproof.scope,disclosed:report.workproof.disclosed_events,total:report.workproof.total_events});setMessage('');
    }catch(error){
      if(id!==generation.current)return;
      const code=error instanceof Error?error.message:'';
      setMessage(code==='INPUT_LIMIT'?'作品最多 96 MB，CA 文件最多 256 KB，且不能为空。':
        code.includes('TRUST_FAILED')?'所选 CA 无法确认这份签名，请向签发方核对可信来源。':
        code.includes('TIMEOUT')?'检查耗时过长，已停止。可以重新检查或使用桌面工具。':
        code.startsWith('PDF_')||code.includes('ENCRYPTED_PDF')?'当前 PDF 结构暂不支持。可使用原作品与 .wproof 配对核验。':
        '未能完成检查。请确认站点包含完整核验工具，并核对作品、内嵌证书和 CA 文件。');
    }finally{if(id===generation.current){active.current=null;setBusy(false);}}
  }
  return <Panel title="检查作品内嵌的创作证书">
    <Details label="作品中已经包含证书？从这里检查">
      <p>支持 WorkProof 封装的 PNG、JPEG 和 PDF。选择文件后，检查在浏览器内完成，作品与 CA 文件不会上传。</p>
      <Upload label="1. 选择带证书的作品" caption="PNG、JPEG 或 PDF，最多 96 MB" accept=".png,.jpg,.jpeg,.pdf" file={asset} disabled={busy} onFile={file=>{reset();setAsset(file);}}/>
      <Upload label="2. 选择你信任的 CA 文件" caption="从签发方等可信渠道独立取得，PEM 格式，最多 256 KB" accept=".pem,.crt,.cer" file={ca} disabled={busy} onFile={file=>{reset();setCa(file);}}/>
      <p>CA 是签发机构的证书。请先核对来源；和作品一起收到一份 CA，并不能说明它可信。</p>
      <Checkbox checked={trusted} disabled={busy||!ca} onChange={checked=>{setTrusted(checked);setResult(null);setMessage('');}}>我已核对 CA 来源，将它作为本次检查的信任依据</Checkbox>
      <Button disabled={busy||!asset||!ca||!trusted} onClick={check}>{busy?'正在检查…':'3. 开始本地检查'}</Button>
      {busy&&<Button variant="ghost" onClick={()=>{reset();setMessage('已取消，可以更换文件后重新检查。');}}>取消检查</Button>}
      {message&&<p role="status">{message}</p>}
      {result&&<div role="status"><Tag tone="ok">签名、作品匹配与已披露记录通过检查</Tag><p>{result.scope==='selective'?'选择性披露':'完整记录'}：本次检查 {result.disclosed} 条，共 {result.total} 条记录。该结果不认证作者身份、实际创作时间或原创性，也不查询证书撤销状态。</p></div>}
    </Details>
  </Panel>;
}
