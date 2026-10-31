'use client';
import {useEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowDownToLine,ArrowUpRight,Check,ChevronRight,FileText,Fingerprint,FolderOpen,Info,Layers,LoaderCircle,LockKeyhole,Plus,Shield,ShieldCheck,X,AlertTriangle,RotateCcw,Pause,Activity,ExternalLink,Code2} from 'lucide-react';
import {Button} from '../components/button';

type RecordEntry={event:{seq:number;elapsed_ms:number;kind:string;inserted:number;deleted:number;chars:number;checkpoint:string;metrics?:Record<string,number>};hash:string};
type Proof={manifest:{protocol:string;session_id:string;file_name:string;started_at:string;source:string;event_count:number;chain_head:string;artifact_hash:string;artifact_bytes:number;public_key:string;identity:string;time_evidence:string;demo:boolean;merkle_root?:string};records:RecordEntry[];signature:string};
type Report={valid:boolean;file_match:boolean;chain_valid:boolean;signature_valid:boolean;merkle_valid:boolean|null;scope:"full"|"selective";disclosed_events:number;total_events:number;errors:string[]};
type Result={proof:Proof;report:Report;fingerprint:string};
type Stage='idle'|'working'|'done'|'error';
const size=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
const time=(ms:number)=>ms<60000?`${Math.floor(ms/1000)} 秒`:`${Math.floor(ms/60000)} 分 ${Math.floor(ms/1000)%60} 秒`;
const shorten=(s:string)=>s.slice(0,12)+'…'+s.slice(-8);
const labels:Record<string,string>={start:'开始记录',edit:'编辑',undo:'撤销',redo:'重做',save:'保存',pause:'暂停',resume:'继续',gap:'采集缺口',stop:'停止',mesh:'网格变化',modifier:'修改器变化',layer:'图层变化',viewport:'视口变化'};
const metricLabels:Record<string,string>={chars:'字符规模 · UTF-16',vertices:'网格顶点数',edges:'网格边数',faces:'网格面数',objects:'对象数',modifiers:'修改器数',layers:'图层数',groups:'图层组数',visible_layers:'可见图层数',paragraphs:'段落数',characters:'字符数',viewport_changes:'视口变化次数'};
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function escape(s:string){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));}

function Upload({label,caption,file,onFile,accept,disabled}:{label:string;caption:string;file:File|null;onFile:(f:File)=>void;accept?:string;disabled:boolean}){
  const input=useRef<HTMLInputElement>(null);const [over,setOver]=useState(false);
  return <button type="button" className={`upload ${over?'over':''} ${file?'filled':''}`} disabled={disabled} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();if(!disabled)setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);if(!disabled&&e.dataTransfer.files[0])onFile(e.dataTransfer.files[0]);}}>
    <span className="upload-icon">{file?<FileText size={21}/>:<Plus size={21}/>}</span><span className="upload-copy"><strong>{file?file.name:label}</strong><span>{file?`${size(file.size)} · 点击更换`:caption}</span></span><span className="upload-end">{file?<Check size={17}/>:<FolderOpen size={17}/>}</span>
    <input ref={input} aria-label={label} type="file" accept={accept} tabIndex={-1} onClick={e=>e.stopPropagation()} onChange={e=>{if(e.target.files?.[0])onFile(e.target.files[0]);e.target.value='';}}/>
  </button>;
}
function Timeline({records}:{records:RecordEntry[]}){
  const [selected,setSelected]=useState(0);
  const [metric,setMetric]=useState(records.some(r=>r.event.metrics?.vertices!==undefined)?'vertices':'chars');
  const available=['chars',...Object.keys(metricLabels).filter(k=>k!=='chars'&&records.some(r=>r.event.metrics?.[k]!==undefined))];
  const value=(r:RecordEntry)=>metric==='chars'?r.event.chars:r.event.metrics?.[metric]??0;
  const max=records.reduce((n,r)=>Math.max(n,value(r)),1);const total=records.at(-1)?.event.elapsed_ms||1;
  // Bin large logs for display; original events remain in the signed evidence.
  const step=Math.max(1,Math.ceil(records.length/240));const points=records.filter((_,i)=>i%step===0||i===records.length-1);
  const path=points.map((r,i)=>`${i?'L':'M'} ${(r.event.elapsed_ms/total*900+10).toFixed(1)} ${(140-value(r)/max*110).toFixed(1)}`).join(' ');
  const index=Math.min(selected,records.length-1);const active=records[index];
  return <section className="timeline-panel"><div className="section-top"><div><span className="eyebrow">PROCESS TRACE</span><h2>每一次修改，都留下轨迹。</h2></div><label className="quiet-label"><span className="dot"/><select aria-label="过程指标" value={metric} onChange={e=>setMetric(e.target.value)}>{available.map(k=><option key={k} value={k}>{metricLabels[k]}</option>)}</select></label></div>
    <div className="chart"><div className="chart-grid"/><svg viewBox="0 0 920 160" role="img" aria-label={`记录期间的${metricLabels[metric]}变化`}><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7cceaa" stopOpacity=".18"/><stop offset="100%" stopColor="#7cceaa" stopOpacity="0"/></linearGradient></defs><path d={`${path} L910 150 L10 150 Z`} fill="url(#area)"/><path d={path} fill="none" stroke="#85cead" strokeWidth="2"/>{active&&<line x1={active.event.elapsed_ms/total*900+10} x2={active.event.elapsed_ms/total*900+10} y1="16" y2="150" stroke="#e6e9db" strokeDasharray="3 5"/>}</svg></div>
    <div className="chart-axis"><span>开始记录</span><span>{time(total)} · 记录跨度</span></div>
    <label className="scrub"><span>浏览事件</span><input aria-label="浏览事件" type="range" min="0" max={Math.max(0,records.length-1)} value={index} onChange={e=>setSelected(Number(e.target.value))}/></label>
    {active&&<div className="event-detail"><span>#{String(active.event.seq+1).padStart(4,'0')}</span><strong>{labels[active.event.kind]||active.event.kind}</strong><span>{metric==='chars'?`+${active.event.inserted} / −${active.event.deleted}`:`${metricLabels[metric]}：${value(active)}`}</span><span>{time(active.event.elapsed_ms)}</span><code>{shorten(active.hash)}</code></div>}
    <p className="caption">曲线表示已采集事件中的{metricLabels[metric]}，不展示作品内容。空白时段不等同于思考或劳动；不同指标不能互相换算。</p>
  </section>;
}
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
  return <div className="app"><aside className="sidebar"><a className="brand" href="/" aria-label="WorkProof 首页"><span className="brand-mark"><Fingerprint size={24}/></span><span>WorkProof<small>开源证人</small></span></a><div className="nav-label">工作空间</div><a className="nav-item active" href="#verify"><ShieldCheck size={18}/>证据核验<span>01</span></a><a className="nav-item" href="#principles"><Layers size={18}/>证据说明<ArrowUpRight size={14}/></a><div className="sidebar-bottom"><span className="local-dot"/>本地优先，隐私随行<p>你的作品，始终在你手中。</p><div className="version">PROTOCOL v3 <span>OPEN SOURCE</span></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs">工作空间<ChevronRight size={13}/><span>证据核验</span></div><div className="privacy"><LockKeyhole size={13}/>文件不上传</div><a href="https://github.com/W-Boat/WorkProof" target="_blank" rel="noreferrer" className="source-link">GitHub<ArrowUpRight size={13}/></a></header>
    <main id="verify"><div className="intro"><div><span className="eyebrow">PROOF OF PROCESS</span><h1>让创作过程，<span>有据可查。</span></h1><p>一份作品，一段可复核的创作记录。<br className="mobile-break"/> 在你的浏览器里，读懂证据。</p></div><div className="intro-seal"><Fingerprint strokeWidth={1} size={60}/><span>PRIVATE BY DESIGN</span></div></div>
    <section className="verify-panel" aria-label="核验作品与证书"><div className="panel-title"><span className="step-number">01</span><h2>载入作品与过程证书</h2><span className="local-label"><LockKeyhole size={12}/>仅在本机处理</span></div><div className="uploads"><Upload label="选择最终作品" caption="拖入原始交付文件，支持任意格式" file={artifact} onFile={f=>{invalidate();setArtifact(f);}} disabled={stage==='working'}/><span className="upload-plus">+</span><Upload label="选择 .wproof 证书" caption="与作品对应的过程记录文件" accept=".wproof,application/json" file={proofFile} onFile={f=>{invalidate();setProofFile(f);}} disabled={stage==='working'}/></div><div className="verify-actions"><button className="text-link" onClick={demo} disabled={demoBusy||stage==='working'}>{demoBusy?<LoaderCircle size={14} className="spin"/>:<Activity size={14}/>}先体验一份演示证据<ArrowUpRight size={13}/></button>{stage==='working'?<Button onClick={()=>{worker.current?.terminate();setStage('idle');setPhase('');}}><X size={15}/>取消核验</Button>:<Button variant="primary" disabled={!artifact||!proofFile} onClick={()=>verify()}><ShieldCheck size={16}/>开始本地核验<ChevronRight size={16}/></Button>}</div>
    {stage==='working'&&<div className="progress" role="status"><span>{phase}</span><span>{progress}%</span><div><i style={{width:`${progress}%`}}/></div></div>}
    {stage==='error'&&<div className="error-box" role="alert"><AlertTriangle size={18}/><div><strong>暂时无法完成核验</strong><p>{error}</p></div></div>}
    </section>
    {result&&m&&r?<motion.div initial={reduced?false:{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.35}} className="result" aria-live="polite"><div className={`result-banner ${r.valid?'success':'failure'}`}><span>{r.valid?<ShieldCheck size={20}/>:<AlertTriangle size={20}/>}<strong>{r.valid?(partial?'部分证据核验通过':'证据核验通过'):'证据核验未通过'}</strong>{m.demo&&<b className="demo-badge">演示数据</b>}</span><span>{r.valid?(partial?'所选事件属于已签名记录集；完整链未核验':'文件、记录链与签名一致'):'请检查文件配对及证据完整性'}</span></div>
    <div className="result-grid"><article className={`certificate ${!r.valid?'invalid':''}`}><div className="certificate-header"><span><Fingerprint size={18}/>WORKPROOF</span><span>PROCESS RECORD / 001</span></div><div className="certificate-main"><div className="certificate-kicker">可复核 · 可携带 · 隐私优先</div><h2>{partial?'创作过程记录 · 部分披露':'创作过程记录证书'}</h2><p className="certificate-name">{m.file_name}</p><div className="certificate-emblem">{r.valid?<ShieldCheck size={38} strokeWidth={1}/>:<AlertTriangle size={38} strokeWidth={1}/>}</div><div className="certificate-stats"><div><strong>{partial?`${records.length} / ${m.event_count.toLocaleString()}`:m.event_count.toLocaleString()}</strong><span>{partial?'已披露 / 总事件':'已记录事件'}</span></div><div><strong>{time(duration)}</strong><span>记录时间跨度</span></div><div><strong>{partial?'未核验':gaps}</strong><span>{partial?'完整连续性':'采集缺口'}</span></div></div></div><div className="certificate-footer"><div><span>BLAKE3 / 文件指纹</span><code>{m.artifact_hash}</code></div><span className="certificate-note">{r.valid?'核验一致':'核验失败'}<br/>{m.demo?'演示样本':'本地签名'}</span></div><div className="certificate-disclaimer">{partial?'仅证明所选事件的归属，未核验完整记录链。':''}签名者身份未经认证。本记录不证明人类创作、原创性或持续劳动。</div></article>
    <aside className="checks-panel"><span className="eyebrow">VERIFICATION DETAILS</span><h2>证据告诉了我们什么</h2>{[[r.file_match,'文件匹配','作品字节与证书摘要一致'],[partial?r.merkle_valid:r.chain_valid,partial?'所选记录归属':'记录链完整',partial?'Merkle 路径与已签名根一致':'事件顺序与已签名链尾一致'],[r.signature_valid,'签名有效','清单通过 Ed25519 签名核验'],...(!partial&&r.merkle_valid!==null?[[r.merkle_valid,'Merkle 承诺一致','所有事件与已签名 Merkle 根一致']]:[])].map(([ok,title,desc])=><div className="check-row" key={String(title)}><span className={ok?'check-icon':'fail-icon'}>{ok?<Check size={15}/>:<X size={15}/>}</span><div><strong>{title as string}<em>{ok?'通过':'失败'}</em></strong><p>{desc as string}</p></div></div>)}<div className="check-boundary"><Info size={16}/><div><strong>仍需了解的边界</strong><p>签名身份未经认证<br/>未提供外部时间凭据<br/>无法据此判断 AI 使用比例{partial&&<><br/>完整记录链未核验<br/>未披露区间的采集缺口未知</>}</p></div></div><Dialog.Root><Dialog.Trigger asChild><Button variant="ghost" className="details-button"><Code2 size={15}/>查看原始核验详情<ArrowUpRight size={14}/></Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>原始核验详情</Dialog.Title><Dialog.Description>核验算法结果与签名清单；身份和时间的可信程度需独立判断。</Dialog.Description><pre>{JSON.stringify({report:r,manifest:m},null,2)}</pre><Dialog.Close asChild><Button><X size={16}/>关闭</Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></aside></div>
    <div className="export-row"><span><LockKeyhole size={13}/>本次核验未上传作品或证书</span><div><Button disabled={!r.valid} onClick={exportImage}><ArrowDownToLine size={15}/>保存证书图片</Button><Button disabled={!r.valid} onClick={()=>window.print()}><FileText size={15}/>打印 / PDF</Button><Button variant="ghost" onClick={()=>{invalidate();setArtifact(null);setProofFile(null);}} aria-label="清空重新核验"><RotateCcw size={16}/></Button></div></div>{r.valid&&!partial&&m.protocol==='workproof/3'&&<section className="disclosure-panel" aria-label="选择性披露导出"><span className="eyebrow">SELECTIVE DISCLOSURE</span><h2>只分享你选择的过程记录。</h2><p>输入事件编号或范围，例如 6,21,41-43。留空只披露起始与最终保存；两条边界记录始终包含。文件名、会话、原签名与清单信息仍会公开，隐藏记录不具备零知识保护。</p><div className="disclosure-controls"><label>公开的事件编号<input aria-label="公开的事件编号" value={selection} onChange={e=>setSelection(e.target.value)} placeholder="6,21,41-43" maxLength={8192} disabled={disclosureBusy}/></label><Button onClick={exportDisclosure} disabled={disclosureBusy}>{disclosureBusy?<LoaderCircle size={15} className="spin"/>:<ArrowDownToLine size={15}/>}导出部分证据</Button></div>{disclosureError&&<p className="disclosure-error" role="alert">{disclosureError}</p>}<p className="caption">导出保留原签名，不需上传文件或访问私钥。最多披露 1024 条事件；部分证据不能用于判断全部采集缺口或完整创作过程。</p></section>}{r.chain_valid&&<Timeline records={records}/>}{r.valid&&partial&&<section className="timeline-panel" aria-label="已披露的事件"><span className="eyebrow">DISCLOSED EVENTS</span><h2>已披露的事件</h2><p className="caption">仅展示所选事件，未披露部分不连成曲线，不用于推断持续劳动。</p><div className="disclosed-list">{records.map(entry=><div className="event-detail" key={entry.event.seq}><span>#{entry.event.seq+1}</span><strong>{labels[entry.event.kind]||entry.event.kind}</strong><span>{time(entry.event.elapsed_ms)}</span><code>{shorten(entry.hash)}</code></div>)}</div></section>}</motion.div>:<section className="empty-proof"><div className="empty-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><Fingerprint size={43} strokeWidth={1}/><span className="mini-check"><Check size={12}/></span></div><div><span className="eyebrow">EVERY PROCESS LEAVES A TRACE</span><h2>作品之外，还有你的创作过程。</h2><p>载入文件后，这里将呈现核验结果、过程图谱与可下载的证书。<br/>完整性、签名与信任边界，各自清晰可见。</p></div></section>}
    <section id="principles" className="principles"><div><span>01 / PRIVATE</span><h3><LockKeyhole size={16}/>作品留在本机</h3><p>文件在浏览器内计算摘要，无需上传服务器。核验完成后可直接关闭页面。</p></div><div><span>02 / VERIFIABLE</span><h3><Fingerprint size={16}/>证据可以复核</h3><p>开放协议、哈希链和数字签名，让同一份证据得到可重复的核验结果。</p></div><div><span>03 / HONEST</span><h3><Info size={16}/>结论有明确边界</h3><p>过程记录不是人类身份证明。未知的来源、身份和时间，不以通过印章代替。</p></div></section>
    <footer className="footer"><span>WorkProof 开源证人 <i> / </i> 让过程被看见，让隐私被尊重。</span><a href="https://github.com/W-Boat/WorkProof" target="_blank" rel="noreferrer">开放协议与源码<ExternalLink size={12}/></a></footer>
    </main></div></div>;
}
