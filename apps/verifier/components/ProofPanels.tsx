'use client';
import * as Dialog from '@radix-ui/react-dialog';
import {Fingerprint,ShieldCheck,AlertTriangle,Check,X,Info,Code2,ArrowDownToLine,LoaderCircle} from 'lucide-react';
import {Button} from './button';
import {Details,Panel,Tag,TextInput} from './institution-ui';
import {useEmbeddedFluent} from './fluent-embedded';
import {ActionBreakdown} from './ActionBreakdown';
import {type Proof,type Report,type RecordEntry,type BehaviorAssessment,time,shorten,labels} from '../lib/evidence';

export function CertificateCard({proof,report,certificateId,behaviorNote,behaviorReview=false}:{proof:Proof;report:Report;certificateId?:string;behaviorNote?:string;behaviorReview?:boolean}){
  const embedded=useEmbeddedFluent();
  const m=proof.manifest,partial=report.scope==='selective';
  const duration=proof.records.at(-1)?.event.elapsed_ms||0,gaps=proof.records.filter(r=>r.event.kind==='gap').length;
  if(embedded)return <Panel title="过程记录证书" className="fluent-certificate">
    <p className="fluent-certificate-name">{m.file_name}</p>
    <dl>
      <div><dt>{partial?'已披露 / 总事件':'已记录事件'}</dt><dd>{partial?`${proof.records.length.toLocaleString()} / ${m.event_count.toLocaleString()}`:m.event_count.toLocaleString()}</dd></div>
      <div><dt>记录跨度</dt><dd>{time(duration)}</dd></div>
      <div><dt>{partial?'完整记录链':'采集缺口'}</dt><dd>{partial?'未核验':gaps}</dd></div>
    </dl>
    <Details label="查看文件和证书指纹">
      <p>文件指纹（BLAKE3）</p><code>{m.artifact_hash}</code>
      {report.valid&&certificateId&&<><p>证书指纹（SHA-256）</p><code>{certificateId}</code></>}
    </Details>
    <div className="fluent-print-fingerprints"><p>文件指纹（BLAKE3）</p><code>{m.artifact_hash}</code>
      {report.valid&&certificateId&&<><p>证书指纹（SHA-256）</p><code>{certificateId}</code></>}
      <p>{partial?'本次核验仅覆盖已披露的记录。':''}签名者身份未经认证。</p>
    </div>
  </Panel>;
  return <article className={`certificate ${report.valid?'':'invalid'}`} aria-label="过程记录证书">
    <header className="certificate-header"><span><Fingerprint size={20}/>WORKPROOF</span><span>{partial?'选择性披露':'创作过程记录'}</span></header>
    <div className="certificate-main"><div className="certificate-kicker">可复核 · 可携带 · 隐私优先</div><h2>{partial?'创作过程记录 · 部分披露':'创作过程记录证书'}</h2><p className="certificate-name">{m.file_name}</p>
      <div className="certificate-emblem">{report.valid?<ShieldCheck size={35} strokeWidth={1.2}/>:<AlertTriangle size={35}/>}</div>
      <div className="certificate-stats"><div><strong>{partial?`${proof.records.length} / ${m.event_count.toLocaleString()}`:m.event_count.toLocaleString()}</strong><span>{partial?'已披露 / 总事件':'已记录事件'}</span></div><div><strong>{time(duration)}</strong><span>记录时间跨度</span></div><div><strong>{partial?'未核验':gaps}</strong><span>{partial?'完整连续性':'采集缺口'}</span></div></div>
      {report.valid&&behaviorNote&&<p className={`certificate-behavior ${behaviorReview?'needs-review':''}`}>{behaviorNote} · 供人工复核</p>}
    </div>
    <footer className="certificate-footer"><div><span>BLAKE3 文件指纹</span><code>{m.artifact_hash}</code></div><span className="certificate-note">{report.valid?'核验一致':'核验失败'}<br/>{m.demo?'演示样本':'本地签名'}</span></footer>
    {report.valid&&certificateId&&<div className="certificate-id"><span>证书指纹 · SHA-256（签名字节）</span><code>{certificateId}</code></div>}
    <p className="certificate-disclaimer">{partial?'仅证明所选事件的归属，未核验完整记录链。':''}签名者身份未经认证。本记录不证明人类创作、原创性或持续劳动。</p>
  </article>;
}
export function VerificationChecks({proof,report:r,behavior}:{proof:Proof;report:Report;behavior?:BehaviorAssessment|null}){
  const embedded=useEmbeddedFluent();
  const partial=r.scope==='selective';
  const checks:[boolean|string|null,string,string,string][]=[
    [r.file_match,'文件匹配','这份作品与证书中记录的最终文件一致','作品与证书不匹配。请向提供者索取与这份证书对应的原始作品。'],
    [partial?r.merkle_valid:r.chain_valid,partial?'所选记录归属':'记录链完整',partial?'公开的操作属于这份已签名记录':'记录顺序一致，未发现记录被改动',partial?'所选操作未能与原始记录核对一致。请索取原始证书。':'过程记录未能核对一致。请向提供者索取未修改的原始证书。'],
    [r.signature_valid,'签名有效','签名覆盖的证书内容未被改动','签名未能通过检查。请索取原始证书，不要依据这份证书判断作品。'],
  ];
  if(!partial&&r.merkle_valid!==null)checks.push([r.merkle_valid,'记录集合一致','全部操作与签名中确认的记录一致','操作记录与签名不一致。请向提供者索取原始证书。']);
  const assurance=<>
    <section className="proof-assurance" aria-label="证据信任状态"><h3>这份证据能说明什么</h3><dl>
      <div><dt>文件与签名</dt><dd><strong>{r.valid?(partial?'已披露部分一致':'核验一致'):'未通过核验'}</strong><p>{r.valid?'只说明本次检查的文件、记录和签名相互匹配。':'当前文件或证据未通过一致性检查，不能采信其过程结论。'}</p></dd></div>
      <div><dt>官方客户端来源</dt><dd><strong>未认证</strong><p>本机自签名不能证明来自官方客户端；证书上的名称和图标不是来源认证。</p></dd></div>
      <div><dt>采集过程真实性</dt><dd><strong>未独立验证</strong><p>记录由采集端提供。签名不能单独证明每项操作真实发生，也不能排除脚本模拟。</p></dd></div>
      <div><dt>检测规则有效性</dt><dd><strong>{r.valid?'尚未完成真实场景校准':'本次不作过程判断'}</strong><p>{r.valid?'当前仅用启发式规则提示人工复核，未建立真实中英文场景的误报保证。':'完整性检查失败时，不以过程统计判断创作方式。'}</p>{r.valid&&behavior?.rule_version&&<p>本次规则：<code>{behavior.rule_version}</code></p>}</dd></div>
    </dl></section>
    <div className="check-boundary"><Info size={17}/><div><strong>身份与时间仍需单独判断</strong><p>签名身份未经认证<br/>证书内未提供外部时间凭据<br/>无法据此判断 AI 使用比例{partial&&<><br/>完整记录链未核验<br/>未披露区间的采集缺口未知</>}</p></div></div>
  </>;
  const raw=JSON.stringify({report:r,manifest:proof.manifest},null,2);
  return <Panel id={embedded?'verification-checks':undefined} title="核验明细" className="checks-panel">
    {checks.map(([ok,title,desc,failure])=><div className="check-row" key={title}><span className={ok?'check-icon':'fail-icon'}>{ok?<Check size={15}/>:<X size={15}/>}</span><div><strong>{title}<Tag tone={ok?'ok':'danger'}>{ok?'通过':'失败'}</Tag></strong><p>{ok?desc:failure}</p></div></div>)}
    {embedded?<Details label="查看证据的信任范围">{assurance}</Details>:assurance}
    {embedded?<Details label="查看原始核验详情"><pre className="fluent-raw-verification" tabIndex={0}>{raw}</pre></Details>:<Dialog.Root><Dialog.Trigger asChild><Button variant="ghost"><Code2 size={15}/>查看原始核验详情</Button></Dialog.Trigger><Dialog.Portal>
      <Dialog.Overlay className="overlay wp-dialog-overlay"/>
      <Dialog.Content className="modal wp-dialog"><header className="modal-head"><div><Dialog.Title className="modal-title">原始核验详情</Dialog.Title><Dialog.Description className="modal-sub">核验算法结果与签名清单；身份与时间需独立判断。</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" aria-label="关闭详情"><X size={17}/></Button></Dialog.Close></header><div className="modal-body"><pre>{raw}</pre></div></Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
  </Panel>;
}
export function DisclosurePanel({selection,busy,error,onChange,onExport}:{selection:string;busy:boolean;error:string;onChange:(s:string)=>void;onExport:()=>void}){
  return <Panel title="选择性披露" aria-label="选择性披露导出" className="disclosure-panel">
    <p>只分享你选择的事件，保留原签名。起始与最终保存始终包含；清单信息仍会公开。</p>
    <div className="disclosure-controls"><label className="field"><span className="field-label">公开的事件编号</span><TextInput aria-label="公开的事件编号" value={selection} onChange={e=>onChange(e.target.value)} placeholder="例如 6,21,41-43；留空只保留边界" maxLength={8192} disabled={busy}/></label><Button onClick={onExport} disabled={busy}>{busy?<LoaderCircle size={15} className="spin"/>:<ArrowDownToLine size={15}/>}导出部分证据</Button></div>
    {error&&<p className="disclosure-error" role="alert">{error}</p>}
    <p className="caption">最多 1024 条。部分证据不能评估全部采集缺口；不等同于零知识保护，不上传文件或读取私钥。</p>
  </Panel>;
}
export function DisclosedEvents({records}:{records:RecordEntry[]}){
  return <Panel title="已披露的事件"><p className="caption">仅展示所选事件，未披露部分不连成曲线，不用于推断持续劳动。</p><ActionBreakdown records={records}/><div className="disclosed-list">{records.map(entry=><div className="event-detail" key={entry.event.seq}><span>#{entry.event.seq+1}</span><strong>{labels[entry.event.kind]||entry.event.kind}</strong><span>{time(entry.event.elapsed_ms)}</span><code>{shorten(entry.hash)}</code></div>)}</div></Panel>;
}
