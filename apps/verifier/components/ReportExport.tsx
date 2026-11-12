'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from './button';
import {FluentElement,useEmbeddedFluent} from './fluent-embedded';
import {type Result,download} from '../lib/evidence';
import type {MetadataReport} from './MetadataPanel';
import {createEncryptedReport} from '../lib/encrypted-report';

type Saved={file_name:string;md5:string;sha256:string;bytes:number;native:boolean;source_certificate_id:string};
const bridge=()=> (window as unknown as {__TAURI__?:{core:{invoke:(name:string,args?:unknown)=>Promise<any>}}}).__TAURI__?.core;
export function ReportExport({result,artifact,proof,metadata,native=false,auxiliaryText}:{result:Result;artifact:File|null;proof:File|null;metadata?:MetadataReport|null;native?:boolean;auxiliaryText?:()=>string}){
  const embedded=useEmbeddedFluent(),[open,setOpen]=useState(false),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState<Saved|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),task=useRef<AbortController|null>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;task.current?.abort();};},[]);
  useEffect(()=>{if(open){setSaved(null);setError('');dialog.current?.showModal();}else{task.current?.abort();setPassword('');setConfirmation('');}},[open]);
  function close(){if(saving)return;task.current?.abort();dialog.current?.close();setOpen(false);}
  async function generate(){
    if(busy||!artifact||!proof)return;
    if(Array.from(password).length<8){setError('请设置至少 8 个字符的密码。');return;}
    if(password!==confirmation){setError('两次输入的密码不一致。');return;}
    if(metadata?.file===artifact&&metadata.status==='running'){setError('文件属性仍在检查，请完成后再生成完整报告。');return;}
    const controller=new AbortController();task.current=controller;setBusy(true);setError('');setSaved(null);
    try{
      const application=native?await bridge()?.invoke('app_info'):null;
      const snapshot=metadata?.file===artifact?{...metadata,file:undefined}:{status:'not_run'};
      const bundle=await createEncryptedReport({result,artifact,proof,metadata:snapshot,application,auxiliaryText:auxiliaryText?.()||''},password,controller.signal);
      if(!alive.current||controller.signal.aborted)return;
      let fileName=`WorkProof-report-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.html`;
      if(native){
        if(!bridge())throw new Error('当前客户端不支持原生保存，请更新完整安装包。');
        setSaving(true);const response=await bridge()!.invoke('save_report',{html:bundle.html,certificateId:result.certificateId});
        if(response.cancelled){setError('已取消保存。你可以重新选择保存位置。');return;}
        if(response.md5!==bundle.md5||response.sha256!==bundle.sha256||response.bytes!==bundle.bytes)throw new Error('保存后的报告摘要不一致，请核对文件后再使用。');
        fileName=response.file_name;
      }else download(new Blob([bundle.html],{type:'text/html;charset=utf-8'}),fileName);
      if(!alive.current)return;
      setSaved({file_name:fileName,md5:bundle.md5,sha256:bundle.sha256,bytes:bundle.bytes,native,source_certificate_id:result.certificateId});setPassword('');setConfirmation('');
    }catch(cause){if(alive.current&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(alive.current){setBusy(false);setSaving(false);}}
  }
  function saveChecksums(){if(!saved)return;download(new Blob([`${saved.md5}  ${saved.file_name}\n`],{type:'text/plain;charset=utf-8'}),saved.file_name+'.md5');}
  return <>
    <Button disabled={!artifact||!proof} onClick={()=>setOpen(true)} aria-label="下载加密 HTML 报告">下载报告</Button>
    {open&&<dialog ref={dialog} className={`report-export-dialog ${embedded?'report-export-fluent':''}`} aria-labelledby="report-export-title" onCancel={event=>{if(saving)event.preventDefault();else close();}} onClose={()=>{task.current?.abort();setOpen(false);}}>
      <h2 id="report-export-title">保存完整核验报告</h2>
      <p>生成带密码的独立 HTML，包含全部已披露记录、检验单、十种统计图、已完成的文件属性检查和原始证书。文件留在本机。</p>
      {!saved?<>
        <label className="report-password-label">设置报告密码（至少 8 个字符）<input aria-label="设置报告密码" type="password" autoComplete="new-password" maxLength={1024} value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>
        <label className="report-password-label">再次输入密码<input aria-label="再次输入报告密码" type="password" autoComplete="new-password" maxLength={1024} value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void generate();}}}/></label>
        <p className="report-export-note">原作品另附，不封装原文件。密码不会保存在报告里，请单独告知接收者。未执行的检查会标明状态；部分披露的证书不会补出隐藏记录。</p>
        {busy&&<div role="status"><p>{saving?'请选择报告保存位置…':'正在整理完整数据并加密…'}</p>{embedded?<FluentElement tag="fluent-progress-bar" aria-label="正在生成加密报告"/>:<progress aria-label="正在生成加密报告"/>}</div>}
      </>:<div className="report-export-saved" role="status">
        <p>{saved.native?'HTML 与配套校验文件已保存。':'已发起 HTML 下载，请再保存配套校验文件。'}</p><p>{saved.file_name}</p>
        <label>这份 HTML 的 MD5<code data-selectable="true" tabIndex={0}>{saved.md5}</code></label>
        <details><summary>SHA-256 与证书关联</summary><code data-selectable="true" tabIndex={0}>{saved.sha256}</code><p>原证书指纹：<code data-selectable="true">{saved.source_certificate_id}</code></p><p>报告大小：{saved.bytes.toLocaleString()} 字节</p></details>
        {!saved.native&&<div className="report-export-actions"><Button onClick={saveChecksums}>保存 MD5 校验文件</Button><Button onClick={()=>download(new Blob([JSON.stringify({schema:'workproof-report-files/1',file:saved.file_name,md5:saved.md5,sha256:saved.sha256,bytes:saved.bytes,source_certificate_id:saved.source_certificate_id},null,2)],{type:'application/json'}),saved.file_name+'.report.json')}>保存关联清单</Button></div>}
      </div>}
      {error&&<p className="report-export-error" role="alert">{error}</p>}
      <div className="report-export-actions"><Button variant="ghost" disabled={saving} onClick={close}>{saved?'完成':'取消'}</Button>{!saved&&<Button variant="primary" disabled={busy||!artifact||!proof} onClick={()=>void generate()}>生成并保存</Button>}</div>
    </dialog>}
  </>;
}
