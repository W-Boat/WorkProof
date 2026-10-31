'use client';
import {useEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {ArrowDownToLine,ArrowUpRight,ShieldCheck,X,AlertTriangle,RotateCcw,LoaderCircle,FileText,Activity,LockKeyhole,Fingerprint} from 'lucide-react';
import {Button} from '../components/button';
import {PageHeader,Panel,Tag,EmptyState} from '../components/institution-ui';
import {VerifierShell} from '../components/VerifierShell';
import {Upload} from '../components/FileDrop';
import {Timeline} from '../components/ProcessTimeline';
import {CertificateCard,VerificationChecks,DisclosurePanel,DisclosedEvents} from '../components/ProofPanels';
import {type Stage,type Result,download,escape,time} from '../lib/evidence';

export default function Page(){
  const [artifact,setArtifact]=useState<File|null>(null),[proofFile,setProofFile]=useState<File|null>(null),[stage,setStage]=useState<Stage>('idle'),[progress,setProgress]=useState(0),[phase,setPhase]=useState(''),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[demoBusy,setDemoBusy]=useState(false);
  const worker=useRef<Worker|null>(null),disclosureWorker=useRef<Worker|null>(null);const reduced=useReducedMotion();
  const [selection,setSelection]=useState(''),[disclosureBusy,setDisclosureBusy]=useState(false),[disclosureError,setDisclosureError]=useState('');
  useEffect(()=>()=>{worker.current?.terminate();disclosureWorker.current?.terminate();},[]);
  const invalidate=()=>{worker.current?.terminate();disclosureWorker.current?.terminate();disclosureWorker.current=null;setDisclosureBusy(false);setDisclosureError('');setSelection('');setResult(null);setStage('idle');setError('');};
  function verify(a=artifact,p=proofFile){
    if(!a||!p)return;disclosureWorker.current?.terminate();disclosureWorker.current=null;setDisclosureBusy(false);setDisclosureError('');worker.current?.terminate();setResult(null);setError('');setProgress(0);setStage('working');
    const w=new Worker('/verify-worker.js',{type:'module'});worker.current=w;
    w.onmessage=({data})=>{if(data.type==='progress'){setPhase(data.phase);setProgress(data.progress);}else if(data.type==='result'){setResult(data);setStage('done');w.terminate();}else{setError(data.message);setStage('error');w.terminate();}};
    w.onerror=()=>{setError('无法加载核验引擎。请使用完整的本地站点包，或重新加载页面。');setStage('error');w.terminate();};w.postMessage({artifact:a,proof:p});
  }
  async function demo(){setDemoBusy(true);try{const [a,p]=await Promise.all([fetch('/demo/essay.md'),fetch('/demo/essay.md.wproof')]);if(!a.ok||!p.ok)throw new Error('示例尚未生成，请使用 Actions 构建的完整站点。');const af=new File([await a.blob()],'essay.md'),pf=new File([await p.blob()],'essay.md.wproof');setArtifact(af);setProofFile(pf);verify(af,pf);}catch(e){setError(String(e));setStage('error');}finally{setDemoBusy(false);}}
  const m=result?.proof.manifest,r=result?.report;const records=result?.proof.records||[];
  const partial=r?.scope==='selective';
  const gaps=records.filter(x=>x.event.kind==='gap').length;const duration=records.at(-1)?.event.elapsed_ms||0;
  function exportDisclosure(){
    if(!proofFile||!m||!r?.valid||partial||m.protocol!=='workproof/3')return;
    setDisclosureError('');
    try{
      const chosen=new Set<number>();
      if(selection.length>8192)throw new Error('事件选择过长。');
      for(const part of selection.split(',').map(s=>s.trim()).filter(Boolean)){
        if(!/^\d+(?:\s*-\s*\d+)?$/.test(part))throw new Error('请输入事件编号或范围，例如 6,21,41-43。');
        const [start,end=start]=part.split('-').map(s=>Number(s.trim()));
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>m.event_count)throw new Error('事件编号超出范围。');
        if(end-start>1023)throw new Error('最多披露 1024 条事件，包含起始和最终保存。');
        for(let n=start;n<=end;n++)chosen.add(n-1);
        if(chosen.size>1024)throw new Error('最多披露 1024 条事件，包含起始和最终保存。');
      }
      chosen.add(0);chosen.add(m.event_count-1);
      if(chosen.size>1024)throw new Error('最多披露 1024 条事件，包含起始和最终保存。');
      disclosureWorker.current?.terminate();const w=new Worker('/verify-worker.js',{type:'module'});disclosureWorker.current=w;setDisclosureBusy(true);
      w.onmessage=({data})=>{
        if(disclosureWorker.current!==w||data.type==='progress')return;
        if(data.type==='disclosure')download(new Blob([data.json],{type:'application/json'}),m.file_name+'.selected.wproof');
        else setDisclosureError(data.message||'无法导出选择性披露证据。');
        setDisclosureBusy(false);w.terminate();disclosureWorker.current=null;
      };
      w.onerror=()=>{setDisclosureError('无法加载披露引擎，请重新加载完整站点。');setDisclosureBusy(false);w.terminate();disclosureWorker.current=null;};
      w.postMessage({action:'disclose',proof:proofFile,indices:[...chosen]});
    }catch(error){setDisclosureError(error instanceof Error?error.message:String(error));}
  }
  async function exportImage(){
    if(!m||!r?.valid)return;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="960"><rect width="1440" height="960" fill="#f1f0e8"/><rect x="40" y="40" width="1360" height="880" rx="4" fill="none" stroke="#b9c4b9"/><g fill="#243d31" font-family="Segoe UI, Microsoft YaHei, sans-serif"><text x="100" y="125" font-size="25" letter-spacing="6">WORKPROOF / PROCESS RECORD</text><text x="100" y="270" font-size="64">${partial?'创作过程记录 · 部分披露':'创作过程记录证书'}</text><text x="100" y="345" font-size="30">${escape(m.file_name.slice(0,38)+(m.file_name.length>38?'…':''))}</text><text x="100" y="440" font-size="24">文件匹配 · ${partial?'所选事件归属一致':'记录链完整'} · 签名有效${m.demo?' · 演示数据':''}</text><text x="100" y="510" font-size="24">${partial?`${records.length} / ${m.event_count} 条已披露事件`:`${m.event_count} 条事件`} / ${time(duration)}记录跨度</text><text x="100" y="555" font-size="22">${partial?'完整记录链未核验 · 未披露区间不能用于连续性判断':`${gaps} 个已记录采集缺口`}</text><text x="100" y="610" font-size="20">BLAKE3 文件指纹</text><text x="100" y="650" font-family="monospace" font-size="20">${m.artifact_hash}</text><text x="100" y="740" font-size="22">签名身份未经认证 · 无外部时间凭据</text><text x="100" y="795" font-size="20">此图为核验结果展示。复核需要作品和 .wproof；不证明人类创作或原创性。</text><text x="100" y="860" font-size="18">${escape(m.protocol)} / ${escape(m.session_id)}</text></g></svg>`;
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=960;canvas.getContext('2d')!.drawImage(image,0,0);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)download(blob,'WorkProof-certificate.png');}catch{download(new Blob([svg],{type:'image/svg+xml'}),'WorkProof-certificate.svg');}finally{URL.revokeObjectURL(url);}
  }
  return <VerifierShell>
    <PageHeader title="证据核验" desc="在本机核对作品、记录与签名。文件不上传，完整性与可信程度分别呈现。"/>
    <Panel title="载入作品与过程证书" aria-label="核验作品与证书" tools={<Tag tone="info">本地处理</Tag>}>
      <div className="uploads"><Upload label="选择最终作品" caption="拖入原始交付文件，支持任意格式" file={artifact} onFile={f=>{invalidate();setArtifact(f);}} disabled={stage==='working'}/><Upload label="选择 .wproof 证书" caption="与作品对应的过程记录文件" accept=".wproof,application/json" file={proofFile} onFile={f=>{invalidate();setProofFile(f);}} disabled={stage==='working'}/></div>
      <div className="verify-actions"><Button variant="ghost" onClick={demo} disabled={demoBusy||stage==='working'}>{demoBusy?<LoaderCircle size={15} className="spin"/>:<Activity size={15}/>}先体验一份演示证据<ArrowUpRight size={13}/></Button>{stage==='working'?<Button onClick={()=>{worker.current?.terminate();setStage('idle');setPhase('');}}><X size={15}/>取消核验</Button>:<Button variant="primary" disabled={!artifact||!proofFile} onClick={()=>verify()}><ShieldCheck size={16}/>开始本地核验</Button>}</div>
      {stage==='working'&&<div className="progress" role="status"><span>{phase}</span><span>{progress}%</span><div><i style={{width:`${progress}%`}}/></div></div>}
      {stage==='error'&&<div className="error-box" role="alert"><AlertTriangle size={18}/><div><strong>暂时无法完成核验</strong><p>{error}</p></div></div>}
    </Panel>
    {result&&m&&r?<motion.div initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.22}} className="result" aria-live="polite">
      <div className={`result-banner ${r.valid?'success':'failure'}`}><span>{r.valid?<ShieldCheck size={21}/>:<AlertTriangle size={21}/>}<strong>{r.valid?(partial?'部分证据核验通过':'证据核验通过'):'证据核验未通过'}</strong>{m.demo&&<Tag tone="neutral">演示数据</Tag>}</span><span>{r.valid?(partial?'所选事件属于已签名记录集；完整链未核验':'文件、记录链与签名一致'):'请检查文件配对及证据完整性'}</span></div>
      <div className="result-grid"><CertificateCard proof={result.proof} report={r}/><VerificationChecks proof={result.proof} report={r}/></div>
      <div className="export-row"><span><LockKeyhole size={13}/>本次核验未上传作品或证书</span><div><Button disabled={!r.valid} onClick={exportImage}><ArrowDownToLine size={15}/>保存证书图片</Button><Button disabled={!r.valid} onClick={()=>window.print()}><FileText size={15}/>打印 / PDF</Button><Button variant="ghost" onClick={()=>{invalidate();setArtifact(null);setProofFile(null);}} aria-label="清空重新核验"><RotateCcw size={16}/></Button></div></div>
      {r.valid&&!partial&&m.protocol==='workproof/3'&&<DisclosurePanel selection={selection} busy={disclosureBusy} error={disclosureError} onChange={setSelection} onExport={exportDisclosure}/>}
      {r.chain_valid&&<Timeline records={records}/>}
      {r.valid&&partial&&<DisclosedEvents records={records}/>}
    </motion.div>:<Panel className="empty-proof"><EmptyState icon={<Fingerprint size={28}/>} title="载入一份作品，开始核验。" desc="你将看到文件匹配、记录完整性、签名与过程轨迹，也可以先体验标明来源的演示证据。"/></Panel>}
    <Panel id="principles" title="如何理解核验结果" className="principles"><dl><div><dt>作品留在本机</dt><dd>浏览器中的独立工作线程计算文件指纹，不上传作品与证书。</dd></div><div><dt>签名与身份分开判断</dt><dd>签名核对记录是否改变，不证明真人身份、原创性或 AI 使用比例。</dd></div><div><dt>部分证据只核对所选归属</dt><dd>未披露的记录不连成曲线，未观测到的区间不视为持续劳动。</dd></div></dl></Panel>
  </VerifierShell>;
}
