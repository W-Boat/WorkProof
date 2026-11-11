'use client';
import {useEffect,useRef,useState} from 'react';
import {Panel,Tag,TextInput,Checkbox,Details} from './institution-ui';
import {Button} from './button';
import {Upload} from './FileDrop';
type ReceiptReport={receipt_verified:boolean;issuer_key_matched:boolean;received_scope:string;issuer_id:string;received_at_ms:number;expires_at_ms:number};
export function ReceiptPanel({proof}:{proof:File}){
  const [receipt,setReceipt]=useState<File|null>(null),[key,setKey]=useState<File|null>(null),[issuer,setIssuer]=useState(''),[trusted,setTrusted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<ReceiptReport|null>(null);
  const generation=useRef(0),active=useRef<Worker|null>(null),deadline=useRef<ReturnType<typeof setTimeout>|null>(null);
  function stop(){generation.current++;active.current?.terminate();active.current=null;if(deadline.current)clearTimeout(deadline.current);deadline.current=null;}
  useEffect(()=>()=>stop(),[]);
  function reset(){stop();setBusy(false);setResult(null);setError('');setTrusted(false);}
  async function verify(){
    if(busy||!trusted||!receipt||!key)return;stop();const current=generation.current;setBusy(true);setResult(null);setError('');
    const fail=(message:string)=>{if(current!==generation.current)return;stop();setBusy(false);setError(message);};
    deadline.current=setTimeout(()=>fail('回执检查超过 15 秒，已停止。'),15000);
    try{
      if(receipt.size>16*1024||key.size>128||proof.size>32*1024*1024)throw new Error('文件过大：回执最多 16 KB，公钥最多 128 字节。');
      if(!/^[A-Za-z0-9._:-]{1,128}$/.test(issuer))throw new Error('请填写签发方提供的准确标识。');
      const publicKey=(await key.text()).trim();if(current!==generation.current)return;
      if(!/^[a-fA-F0-9]{64}$/.test(publicKey))throw new Error('公钥文件应为 64 位十六进制文本，请勿选择私钥。');
      const worker=new Worker('/verify-worker.js',{type:'module'});active.current=worker;
      worker.onmessage=({data})=>{if(current!==generation.current||data.type==='progress')return;if(data.type==='receipt'&&data.report?.receipt_verified===true&&data.report?.issuer_key_matched===true){stop();setBusy(false);setResult(data.report);}else fail('回执未通过检查。请核对原始证书、公钥、签发者标识与有效期。');};
      worker.onerror=event=>{event.preventDefault();fail('回执核验引擎无法启动，请重新加载完整站点。');};worker.onmessageerror=()=>fail('回执检查结果无法读取。');
      worker.postMessage({action:'receipt',proof,receipt,issuerId:issuer,publicKey,nowMs:Date.now()});
    }catch(failure){fail(failure instanceof Error?failure.message:'回执检查未能完成。');}
  }
  return <Panel title="检查机构接收回执" className="timestamp-panel"><Details label="核对签发者与接收回执（可选）">
    <p>接收回执说明某个签发者接收并签署过哪些证据。请从独立可信渠道取得公钥与签发者标识；不要因为证书附带公钥就直接信任它。所有检查在本机完成。</p>
    <div className="timestamp-files"><Upload label="接收回执（.json）" caption="签发方提供的回执，最多 16 KB" file={receipt} disabled={busy} onFile={file=>{reset();setReceipt(file);}}/><Upload label="独立取得的签发公钥（.hex）" caption="只选择公钥，不选择私钥，最多 128 字节" file={key} disabled={busy} onFile={file=>{reset();setKey(file);}}/></div>
    <label className="field"><span className="field-label">签发者标识</span><TextInput aria-label="签发者标识" value={issuer} maxLength={128} disabled={busy} onChange={event=>{reset();setIssuer(event.target.value);}}/></label>
    <Checkbox checked={trusted} disabled={busy||!key} onChange={checked=>{setTrusted(checked);setResult(null);setError('');}}>我已独立核对公钥来源，并同意以此公钥作为本次信任依据</Checkbox>
    <Button disabled={busy||!trusted||!receipt||!key||!issuer} onClick={verify}>检查接收回执</Button>{busy&&<Button variant="ghost" onClick={()=>{reset();setError('已取消回执检查。');}}>取消回执检查</Button>}
    {busy&&<p role="status">正在本机检查回执，可取消，超过 15 秒自动停止。</p>}{error&&<p role="alert">{error}</p>}
    {result&&<div role="status" style={{overflowWrap:'anywhere'}}><Tag tone="ok">接收回执与当前证据一致</Tag><p>签发者：{result.issuer_id}；接收范围：{result.received_scope==='selective'?'部分披露':'完整证据'}。</p><p>签发方声明接收时间：{new Date(result.received_at_ms).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）。</p></div>}
    <p className="caption">最多接受 31 天有效期，使用本机当前时间检查。该结果不证明来自官方客户端、操作真实或人类创作；接收时间也不是独立时间服务认证。改变证书字节后需重新签发回执。</p>
  </Details></Panel>;
}
