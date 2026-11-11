import React,{useEffect,useRef,useState,lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {EmbeddedFluent,FluentElement,loadEmbeddedFluent} from '../../verifier/components/fluent-embedded';
import {BehaviorReport} from '../../verifier/components/BehaviorReport';
import {WordRevisionSummary} from '../../verifier/components/WordRevisionSummary';
import {VerificationProgress} from '../../verifier/components/institution-ui';
import {type Result,type Stage,labels,time} from '../../verifier/lib/evidence';
const Charts=lazy(()=>import('../../verifier/components/VerificationCharts'));

function NativeVerifier(){
  const [artifact,setArtifact]=useState<File|null>(null),[proof,setProof]=useState<File|null>(null);
  const [stage,setStage]=useState<Stage>('idle'),[result,setResult]=useState<Result|null>(null),[error,setError]=useState('');
  const [progress,setProgress]=useState({phase:'准备核验',progress:0});
  const [tab,setTab]=useState('report'),[ready,setReady]=useState(false),[eventPage,setEventPage]=useState(0);
  const worker=useRef<Worker|null>(null),generation=useRef(0);
  useEffect(()=>{
    let active=true;
    loadEmbeddedFluent(document.documentElement.dataset.theme==='dark').then(()=>{if(active)setReady(true);},()=>{if(active)setError('核验组件未能加载，请重新打开客户端。');});
    return()=>{active=false;generation.current++;worker.current?.terminate();};
  },[]);
  function cancel(){generation.current++;worker.current?.terminate();worker.current=null;setStage('idle');setResult(null);setError('');}
  function choose(file:File|null,kind:'artifact'|'proof'){
    cancel();setEventPage(0);setTab('report');
    if(kind==='proof'&&file&&file.size>32*1024*1024){setProof(null);setError('证书超过 32 MB，请选择完整安装包支持范围内的证书。');return;}
    (kind==='proof'?setProof:setArtifact)(file);
  }
  function verify(){
    if(!artifact||!proof||stage==='working')return;
    cancel();const run=++generation.current;
    setStage('working');setProgress({phase:'加载本机核验引擎',progress:0});
    try{
      const task=new Worker(new URL('verify-worker.js',document.baseURI),{type:'module'});worker.current=task;
      const fail=(message:string)=>{if(run!==generation.current)return;task.terminate();worker.current=null;setResult(null);setError(message);setStage('error');};
      task.onerror=()=>fail('本机核验引擎未能运行。请确认安装包完整，或使用独立浏览器核验。');
      task.onmessage=({data})=>{
        if(run!==generation.current)return;
        if(data.type==='progress')setProgress({phase:data.phase,progress:data.progress});
        else if(data.type==='result'){task.terminate();worker.current=null;setResult(data);setStage('done');setTab('report');}
        else if(data.type==='error')fail(data.message||'文件核验失败。');
      };
      task.postMessage({artifact,proof});
    }catch{setError('无法启动本机核验引擎，请重启客户端后重试。');setStage('error');}
  }
  const valid=!!result?.report.valid;
  const records=valid?result!.proof.records:[];
  const tabs=[['report','检验单'],['charts','统计图'],['events','操作记录'],['certificate','证书信息']];
  return <EmbeddedFluent.Provider value={ready}><div className="native-verifier" aria-label="客户端文件核验">
    <header className="nv-heading"><div><h2>作品核验</h2><p>放入最终作品和对应证书，在本机核对文件、记录链与签名。</p></div><FluentElement tag="fluent-button" appearance="subtle" onClick={()=>document.getElementById('verify-browser')?.click()}>在浏览器打开</FluentElement></header>
    <section className="nv-files" aria-label="选择核验文件">
      {([['artifact','1 · 最终作品',artifact],['proof','2 · WorkProof 证书',proof]] as const).map(([kind,label,file])=><label key={kind} className="nv-file" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length===1)choose(e.dataTransfer.files[0],kind);else setError('请将作品和证书分别放入对应区域。');}}>
        <span>{label}</span><strong>{file?.name||(kind==='proof'?'选择或拖入 .wproof':'选择或拖入作品文件')}</strong>
        <input type="file" aria-label={label} accept={kind==='proof'?'.wproof,application/json':undefined} onChange={e=>{choose(e.target.files?.[0]||null,kind);e.target.value='';}}/>
      </label>)}
    </section>
    <div className="nv-actions"><FluentElement tag="fluent-button" appearance="primary" disabled={!ready||!artifact||!proof||stage==='working'} onClick={verify}>开始核验</FluentElement><FluentElement tag="fluent-button" appearance="subtle" disabled={!artifact&&!proof} onClick={()=>{cancel();setArtifact(null);setProof(null);setEventPage(0);}}>清空文件</FluentElement><span>文件不会上传</span></div>
    {stage==='working'&&<div className="nv-working"><VerificationProgress {...progress}/><FluentElement tag="fluent-button" appearance="subtle" onClick={cancel}>取消核验</FluentElement></div>}
    {error&&<p className="nv-error" role="alert">{error}</p>}
    {result&&<><section className="nv-verdict" data-valid={valid} role="status"><h3>{valid?'文件与证书一致':'核验未通过'}</h3>{valid&&result.proof.manifest.demo&&<FluentElement tag="fluent-badge" appearance="tint">演示证书 · 仅用于体验</FluentElement>}<p>{valid?'文件指纹、已披露记录与签名核对通过。签名有效不等于官方背书，也不能单独证明全部内容由人类创作。':'请检查作品是否是导出证书时的最终文件，以及证书是否完整。'}</p><ul>{result.report.errors.map((item,i)=><li key={i}>{item}</li>)}</ul></section>
      <nav className="nv-tabs" aria-label="核验结果视图">{tabs.map(([id,label])=><FluentElement key={id} tag="fluent-button" appearance={tab===id?'primary':'subtle'} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</FluentElement>)}</nav>
      <div className="nv-result" key={tab}>
        {tab==='report'&&<><div className="nv-checks">{[['作品指纹',result.report.file_match],['记录链',result.report.chain_valid],['数字签名',result.report.signature_valid]].map(([name,ok])=><div key={String(name)}><span>{name}</span><strong data-ok={!!ok}>{ok?'通过':'未通过'}</strong></div>)}</div><BehaviorReport assessment={result.behavior} valid={valid}/>{valid&&result.proof.manifest.source==='word'&&<WordRevisionSummary records={records} partial={result.report.scope==='selective'}/>}</>}
        {tab==='charts'&&(valid?<Suspense fallback={<p role="status">正在加载统计图…</p>}><Charts records={records} partial={result.report.scope==='selective'} reduced={document.documentElement.dataset.reduceMotion==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches}/></Suspense>:<p>核验通过后才能展示可信的过程统计。</p>)}
        {tab==='events'&&(valid?<section><h3>已核验操作记录</h3><p>共 {records.length.toLocaleString()} 条；每页显示 50 条，原始证据保持完整。</p><div className="nv-table"><table><thead><tr><th>序号</th><th>经过时间</th><th>动作</th><th>新增</th><th>删除</th><th>文档字符</th></tr></thead><tbody>{records.slice(eventPage*50,(eventPage+1)*50).map(({event})=><tr key={event.seq}><td>{event.seq}</td><td>{time(event.elapsed_ms)}</td><td>{labels[event.kind]||event.kind}</td><td>{event.inserted}</td><td>{event.deleted}</td><td>{event.chars}</td></tr>)}</tbody></table></div><div className="nv-actions"><FluentElement tag="fluent-button" disabled={eventPage===0} onClick={()=>setEventPage(n=>n-1)}>上一页</FluentElement><span>{eventPage+1} / {Math.max(1,Math.ceil(records.length/50))}</span><FluentElement tag="fluent-button" disabled={(eventPage+1)*50>=records.length} onClick={()=>setEventPage(n=>n+1)}>下一页</FluentElement></div></section>:<p>核验通过后才能展示可信的操作记录。</p>)}
        {tab==='certificate'&&(valid?<dl className="nv-certificate">{[['作品名称',result.proof.manifest.file_name],['记录来源',result.proof.manifest.source],['记录数量',result.report.total_events],['核验范围',result.report.scope==='full'?'完整记录':'仅已披露记录'],['证书指纹',result.certificateId],['签名公钥',result.proof.manifest.public_key],['作品指纹',result.fingerprint]].map(([name,value])=><div key={String(name)}><dt>{name}</dt><dd>{String(value)}</dd></div>)}</dl>:<p>这份证书尚未通过核验，不能作为有效证书展示。</p>)}
      </div></>}
  </div></EmbeddedFluent.Provider>;
}
export function mountNativeVerifier(container:HTMLElement){const root=createRoot(container);root.render(<NativeVerifier/>);return()=>root.unmount();}
