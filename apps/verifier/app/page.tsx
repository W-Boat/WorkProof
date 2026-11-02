'use client';
import {useEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {ArrowDownToLine,ArrowUpRight,ShieldCheck,X,AlertTriangle,RotateCcw,LoaderCircle,FileText,Activity,LockKeyhole,Fingerprint} from 'lucide-react';
import {Button} from '../components/button';
import {PageHeader,Panel,Tag,EmptyState,TextInput} from '../components/institution-ui';
import {VerifierShell} from '../components/VerifierShell';
import {Upload} from '../components/FileDrop';
import {Timeline} from '../components/ProcessTimeline';
import {CertificateCard,VerificationChecks,DisclosurePanel,DisclosedEvents} from '../components/ProofPanels';
import {type Stage,type Result,download,escape,time} from '../lib/evidence';
import {TimestampPanel} from '../components/TimestampPanel';
import {MetadataPanel} from '../components/MetadataPanel';
import {EmbeddedCertificatePanel} from '../components/EmbeddedCertificatePanel';
import {EvolutionPanel} from '../components/EvolutionPanel';

export default function Page(){
  const [artifact,setArtifact]=useState<File|null>(null),[proofFile,setProofFile]=useState<File|null>(null),[stage,setStage]=useState<Stage>('idle'),[progress,setProgress]=useState(0),[phase,setPhase]=useState(''),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[demoBusy,setDemoBusy]=useState(false);
  const worker=useRef<Worker|null>(null),disclosureWorker=useRef<Worker|null>(null);const reduced=useReducedMotion();
  const [selection,setSelection]=useState(''),[disclosureBusy,setDisclosureBusy]=useState(false),[disclosureError,setDisclosureError]=useState('');
  const [expectedId,setExpectedId]=useState(''),[shareMessage,setShareMessage]=useState('');
  function stopVerification(){const active=worker.current;worker.current=null;active?.terminate();}
  useEffect(()=>()=>{stopVerification();const active=disclosureWorker.current;disclosureWorker.current=null;active?.terminate();},[]);
  const invalidate=()=>{stopVerification();disclosureWorker.current?.terminate();disclosureWorker.current=null;setDisclosureBusy(false);setDisclosureError('');setSelection('');setResult(null);setStage('idle');setError('');setPhase('');setProgress(0);};
  function verify(a=artifact,p=proofFile){
    if(!a||!p)return;disclosureWorker.current?.terminate();disclosureWorker.current=null;setDisclosureBusy(false);setDisclosureError('');stopVerification();setResult(null);setError('');setProgress(0);setPhase('');setStage('working');
    setShareMessage('');
    try{
      const w=new Worker('/verify-worker.js',{type:'module'});worker.current=w;
      function fail(message:string){if(worker.current!==w)return;stopVerification();setError(message);setStage('error');setPhase('');}
      w.onmessage=({data})=>{
        if(worker.current!==w)return;
        if(data.type==='progress'){setPhase(data.phase);setProgress(data.progress);}
        else if(data.type==='result'){stopVerification();setResult(data);setStage('done');}
        else fail(data.message||'未能完成核验，请检查作品与证书后重试。');
      };
      w.onerror=()=>fail('无法加载核验引擎。请使用完整的本地站点包，或重新加载页面。');
      w.onmessageerror=()=>fail('无法读取核验结果，请重新选择作品和证书后重试。');
      try{w.postMessage({artifact:a,proof:p,expectedCertificateId:expectedId});}catch{fail('无法读取所选文件，请重新选择作品和证书后重试。');}
    }catch{stopVerification();setError('无法启动核验工具，请重新加载完整站点后重试。');setStage('error');setPhase('');}
  }
  async function demo(){setDemoBusy(true);try{const [a,p]=await Promise.all([fetch('/demo/essay.md'),fetch('/demo/essay.md.wproof')]);if(!a.ok||!p.ok)throw new Error('示例尚未生成，请使用 Actions 构建的完整站点。');const af=new File([await a.blob()],'essay.md'),pf=new File([await p.blob()],'essay.md.wproof');setArtifact(af);setProofFile(pf);verify(af,pf);}catch(e){setError(String(e));setStage('error');}finally{setDemoBusy(false);}}
  const m=result?.proof.manifest,r=result?.report;const records=result?.proof.records||[];
  const partial=r?.scope==='selective';
  const gaps=records.filter(x=>x.event.kind==='gap').length;const duration=records.at(-1)?.event.elapsed_ms||0;
  function shareText(){return `WorkProof 签名证书\n作品：${m?.file_name}\n证书指纹（SHA-256 / 签名字节）：${result?.certificateId}\n请在独立的 WorkProof 核验页打开作品原文件和 .wproof，并填写上方指纹。签名可检查内容改动，不认证作者身份或原创性。${partial?'此证书仅披露部分事件。':'此文件包含全部过程记录；转发前请确认可以公开。'}${m?.demo?' 演示数据，不用于实际交付。':''}`;}
  async function shareCertificate(){
    if(!proofFile||!r?.valid||!result?.certificateId)return;
    const text=shareText();
    // Share the exact bytes just verified, including the original selective format.
    const file=new File([proofFile],proofFile.name,{type:'application/json'});
    try{
      if(navigator.canShare?.({files:[file]})){
        await navigator.share({title:'WorkProof 签名证书',text,files:[file]});
        setShareMessage('已交给系统分享。请另行发送作品原文件，让接收方独立核验。');
      }else{
        download(file,file.name);
        setShareMessage('签名证书已下载。请把它、作品原文件和下方证书指纹一同发给接收方。');
      }
    }catch(error){if(error instanceof Error&&error.name==='AbortError')setShareMessage('已取消分享。');else setShareMessage('系统未能分享，请使用“下载签名证书”，并复制下方指纹。');}
  }
  async function copyFingerprint(){
    try{await navigator.clipboard.writeText(shareText());setShareMessage('已复制核验说明与完整证书指纹。请通过你信任的渠道发送给接收方。');}
    catch{setShareMessage('无法访问剪贴板，请手动选择并复制下方完整证书指纹。');}
  }
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
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="960"><rect width="1440" height="960" fill="#f1f0e8"/><rect x="40" y="40" width="1360" height="880" rx="4" fill="none" stroke="#b9c4b9"/><g fill="#243d31" font-family="Segoe UI, Microsoft YaHei, sans-serif"><text x="100" y="125" font-size="25" letter-spacing="6">WORKPROOF / PROCESS RECORD</text><text x="100" y="270" font-size="64">${partial?'创作过程记录 · 部分披露':'创作过程记录证书'}</text><text x="100" y="345" font-size="36">${escape(m.file_name.slice(0,38)+(m.file_name.length>38?'…':''))}</text><text x="100" y="440" font-size="30">文件匹配 · ${partial?'所选事件归属一致':'记录链完整'} · 签名有效${m.demo?' · 演示数据':''}</text><text x="100" y="510" font-size="30">${partial?`${records.length} / ${m.event_count} 条已披露事件`:`${m.event_count} 条事件`} / ${time(duration)}记录跨度</text><text x="100" y="555" font-size="22">${partial?'完整记录链未核验 · 未披露区间不能用于连续性判断':`${gaps} 个已记录采集缺口`}</text><text x="100" y="610" font-size="20">BLAKE3 文件指纹</text><text x="100" y="650" font-family="monospace" font-size="20">${m.artifact_hash}</text><text x="100" y="740" font-size="22">签名身份未经认证 · 图片未附时间凭据</text><text x="100" y="795" font-size="20">此图为核验结果展示。复核需要作品和 .wproof；不证明人类创作或原创性。</text><text x="100" y="850" font-size="20">证书指纹 · SHA-256（签名字节）</text><text x="100" y="885" font-family="monospace" font-size="20">${result?.certificateId||''}</text></g></svg>`;
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=960;canvas.getContext('2d')!.drawImage(image,0,0);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)download(blob,'WorkProof-certificate.png');}catch{download(new Blob([svg],{type:'image/svg+xml'}),'WorkProof-certificate.svg');}finally{URL.revokeObjectURL(url);}
  }
  return <VerifierShell>
    <PageHeader title="证据核验" desc="选作品、选证书，查看核验结果。所有计算在你的浏览器内完成，文件不会上传。"/>
    <ol className="verify-steps" aria-label="核验流程"><li data-current={!artifact}><b>1</b><span>选择作品<small>收到的原始文件</small></span></li><li data-current={!!artifact&&!proofFile}><b>2</b><span>选择证书<small>对应的 .wproof 文件</small></span></li><li data-current={!!artifact&&!!proofFile}><b>3</b><span>核验与分享<small>看结果，保存签名证书</small></span></li></ol>
    <Panel title="载入作品与过程证书" aria-label="核验作品与证书" tools={<Tag tone="info">本地处理</Tag>}>
      <div className="uploads"><Upload label="选择最终作品" caption="拖入原始交付文件，支持任意格式" file={artifact} onFile={f=>{invalidate();setArtifact(f);}} disabled={stage==='working'}/><Upload label="选择 .wproof 证书" caption="与作品对应的过程记录文件" accept=".wproof,application/json" file={proofFile} onFile={f=>{invalidate();setProofFile(f);}} disabled={stage==='working'}/></div>
      <details className="fingerprint-input"><summary>收到证书指纹？核对是否为同一张证书（可选）</summary><label className="field"><span className="field-label">发送者提供的完整证书指纹</span><TextInput aria-label="发送者提供的完整证书指纹" value={expectedId} onChange={e=>{invalidate();setExpectedId(e.target.value);}} placeholder="粘贴 64 位指纹；不一致时核验不会通过" maxLength={128} disabled={stage==='working'}/></label><p>请从可信渠道取得指纹。仅检查证书自带签名，无法识别别人重新签发的替代证书。</p></details>
      <div className="verify-actions"><Button variant="ghost" onClick={demo} disabled={demoBusy||stage==='working'}>{demoBusy?<LoaderCircle size={15} className="spin"/>:<Activity size={15}/>}先体验一份演示证据<ArrowUpRight size={13}/></Button>{stage==='working'?<Button onClick={invalidate}><X size={15}/>取消核验</Button>:<Button variant="primary" disabled={!artifact||!proofFile} onClick={()=>verify()}><ShieldCheck size={16}/>开始本地核验</Button>}</div>
      {stage==='working'&&<div className="progress" role="status"><span>{phase}</span><span>{progress}%</span><div><i style={{width:`${progress}%`}}/></div></div>}
      {stage==='error'&&<div className="error-box" role="alert"><AlertTriangle size={18}/><div><strong>暂时无法完成核验</strong><p>{error}</p></div></div>}
    </Panel>
    {result&&m&&r?<motion.div initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.22}} className="result" aria-live="polite">
      <div className={`result-banner ${r.valid?'success':'failure'}`}><span>{r.valid?<ShieldCheck size={21}/>:<AlertTriangle size={21}/>}<strong>{r.valid?(partial?'部分证据核验通过':'证据核验通过'):'证据核验未通过'}</strong>{m.demo&&<Tag tone="neutral">演示数据</Tag>}</span><span>{r.valid?(partial?'所选事件属于已签名记录集；完整链未核验':'文件、记录链与签名一致'):'请检查文件配对及证据完整性'}</span></div>
      <div className="result-grid"><CertificateCard proof={result.proof} report={r} certificateId={result.certificateId}/><VerificationChecks proof={result.proof} report={r}/></div>
      {result.certificateMatch===false&&<p className="error-box" role="alert">证书指纹不一致：这不是发送者指定的证书。请向发送者确认，勿作为有效交付凭据。</p>}
      {result.certificateMatch===true&&<p className="caption">证书指纹一致：与发送者提供的证书相符。</p>}
      <div className="export-row"><span><LockKeyhole size={13}/>本次核验未上传作品或证书</span><div><Button disabled={!r.valid} onClick={exportImage}><ArrowDownToLine size={15}/>保存证书图片</Button><Button disabled={!r.valid} onClick={()=>window.print()}><FileText size={15}/>打印 / PDF</Button><Button variant="ghost" onClick={()=>{invalidate();setArtifact(null);setProofFile(null);}} aria-label="清空重新核验"><RotateCcw size={16}/></Button></div></div>
      {r.valid&&<Panel title="分享可复核的签名证书" className="share-panel"><p>把签名证书和作品原文件发给对方，对方即可重新核验。证书图片方便展示，复核时仍需 .wproof 文件。</p><p>{partial?'此证书仅包含已披露的事件。':'此证书包含完整过程记录。如需减少公开内容，请先在下方导出部分证据，再载入核验后分享。'}</p><label className="field"><span className="field-label">证书指纹 · 用于识别证书是否被替换</span><code className="share-fingerprint" tabIndex={0}>{result.certificateId}</code></label><div className="share-actions"><Button variant="primary" onClick={shareCertificate}>分享签名证书</Button><Button onClick={()=>{if(proofFile)download(proofFile,proofFile.name);}}>下载签名证书</Button><Button onClick={copyFingerprint}>复制指纹与核验说明</Button></div><p role="status">{shareMessage}</p><p className="caption">请经可信渠道发送指纹。当前不生成公网链接；本机地址无法供他人远程访问。签名可以查出内容改动，签名者身份仍未经认证。</p></Panel>}
      {r.valid&&<TimestampPanel key={result.certificateId} signature={result.proof.signature}/>}
      {r.valid&&!partial&&m.protocol==='workproof/3'&&<DisclosurePanel selection={selection} busy={disclosureBusy} error={disclosureError} onChange={setSelection} onExport={exportDisclosure}/>}
      {r.chain_valid&&<Timeline records={records}/>}
      {r.valid&&partial&&<DisclosedEvents records={records}/>}
      {r.valid&&proofFile&&<EvolutionPanel key={result.certificateId+proofFile.name} proof={proofFile}/>}
    </motion.div>:<Panel className="empty-proof"><EmptyState icon={<Fingerprint size={28}/>} title="载入一份作品，开始核验。" desc="你将看到文件匹配、记录完整性、签名与过程轨迹，也可以先体验标明来源的演示证据。"/></Panel>}
    <EmbeddedCertificatePanel/>
    <MetadataPanel file={artifact}/>
    <Panel id="principles" title="如何理解核验结果" className="principles"><dl><div><dt>作品留在本机</dt><dd>浏览器中的独立工作线程计算文件指纹，不上传作品与证书。</dd></div><div><dt>签名与身份分开判断</dt><dd>签名核对记录是否改变，不证明真人身份、原创性或 AI 使用比例。</dd></div><div><dt>部分证据只核对所选归属</dt><dd>未披露的记录不连成曲线，未观测到的区间不视为持续劳动。</dd></div></dl></Panel>
  </VerifierShell>;
}
