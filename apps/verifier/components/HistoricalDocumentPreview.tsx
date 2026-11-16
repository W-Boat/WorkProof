'use client';
import {useEffect,useRef,useState} from 'react';
import {blake3} from '@noble/hashes/blake3.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {Button} from './button';
import {Panel} from './institution-ui';
import {type Result,time} from '../lib/evidence';
import {paragraphRecordsVerified} from '../lib/paragraph-statistics';

type PreviewLoader=(file:File)=>Promise<{html:string}>;

export function HistoricalDocumentPreview({result,load,openLocal}:{result:Result;load:PreviewLoader;openLocal?:(hash:string)=>Promise<File>}){
  const [html,setHtml]=useState('');
  const [message,setMessage]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const generation=useRef(0);
  useEffect(()=>{
    setHtml('');setMessage('');
    return()=>{generation.current++;};
  },[result]);

  const checkpoints=result.proof.manifest.source!=='workproof-tiptap'&&paragraphRecordsVerified(result.report)
    ?result.proof.records.map(record=>record.event).filter(event=>
      event.kind==='save'&&/^[0-9a-f]{64}$/.test(event.checkpoint)&&event.checkpoint!==result.proof.manifest.artifact_hash)
    :[];
  if(!checkpoints.length)return null;

  async function preview(file:File){
    const request=++generation.current;
    setHtml('');setMessage('正在核对历史版本…');
    try{
      if(file.size>8*1024*1024)throw new Error('历史版本超过 8 MiB 预览范围。');
      const hash=bytesToHex(blake3(new Uint8Array(await file.arrayBuffer())));
      const checkpoint=result.proof.records.find(({event})=>event.kind==='save'&&event.checkpoint===hash)?.event;
      if(!checkpoint||hash===result.proof.manifest.artifact_hash)throw new Error('这份文件与证书中的历史保存记录不匹配。');
      const rendered=await load(file);
      if(request!==generation.current)return;
      setHtml(rendered.html);
      setMessage('已核对历史保存记录 '+checkpoint.seq+' · '+time(checkpoint.elapsed_ms));
    }catch(error){
      if(request===generation.current)setMessage(error instanceof Error?error.message:'历史版本无法查看。');
    }
  }

  return <Panel title="历史保存版本">
    <p>选择你保留的历史文件。指纹匹配签名保存记录后，可在此查看该版本。</p>
    <input ref={input} type="file" accept=".docx,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp"
      hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void preview(file);}}/>
    <Button variant="secondary" onClick={()=>input.current?.click()}>选择历史版本</Button>
    {openLocal&&result.proof.manifest.source==='word'&&<label>打开本机归档
      <select defaultValue="" onChange={async event=>{
        const hash=event.target.value;if(!hash)return;
        event.target.value='';
        const request=++generation.current;
        setHtml('');setMessage('正在读取本机归档…');
        try{const file=await openLocal(hash);if(request===generation.current)await preview(file);}
        catch(error){if(request===generation.current)setMessage(error instanceof Error?error.message:String(error));}
      }}><option value="">选择保存时刻</option>
        {checkpoints.slice(-200).map(event=><option value={event.checkpoint} key={event.seq}>记录 {event.seq} · {time(event.elapsed_ms)}</option>)}
      </select>
    </label>}
    {message&&<p role="status">{message}</p>}
    {html&&<iframe title="历史版本只读预览" sandbox="" srcDoc={html}
      style={{display:'block',width:'100%',minHeight:400,height:'min(60vh, 720px)',marginBlock:12}}/>}
  </Panel>;
}
