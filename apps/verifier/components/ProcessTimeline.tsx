'use client';
import {useState} from 'react';
import {type RecordEntry,type BehaviorSignal,time,labels,metricLabels,shorten} from '../lib/evidence';
import {ActionBreakdown} from './ActionBreakdown';
export function Timeline({records,signals=[],selectedSeq,onSelect}:{records:RecordEntry[];signals?:BehaviorSignal[];selectedSeq?:number|null;onSelect?:(seq:number)=>void}){
  const [selected,setSelected]=useState(0);
  const [showChanges,setShowChanges]=useState(true),[showRate,setShowRate]=useState(false);
  const structured=records.some(r=>r.event.metrics?.vertices!==undefined||r.event.metrics?.layers!==undefined);
  const [metric,setMetric]=useState(records.some(r=>r.event.metrics?.vertices!==undefined)?'vertices':records.some(r=>r.event.metrics?.layers!==undefined)?'layers':'chars');
  const available=[...(structured?[]:['chars']),...Object.keys(metricLabels).filter(k=>k!=='chars'&&records.some(r=>r.event.metrics?.[k]!==undefined))];
  const value=(r:RecordEntry)=>metric==='chars'?r.event.chars:r.event.metrics?.[metric];
  const max=records.reduce((n,r)=>Math.max(n,value(r)??0),1);const total=records.at(-1)?.event.elapsed_ms||1;
  // Bin large logs for display; original events remain in the signed evidence.
  const step=Math.max(1,Math.ceil(records.length/240));const points=records.filter((_,i)=>i%step===0||i===records.length-1);
  let penDown=false;const segments:string[]=[];
  records.forEach((r,i)=>{if(r.event.kind==='gap'||i>0&&r.event.seq!==records[i-1].event.seq+1)penDown=false;const v=value(r);if(v===undefined){penDown=false;return;}if(i%step!==0&&i!==records.length-1)return;segments.push(`${penDown?'L':'M'} ${(r.event.elapsed_ms/total*900+10).toFixed(1)} ${(120-v/max*90).toFixed(1)}`);penDown=true;});
  const path=segments.join(' ');
  const bins=Array.from({length:Math.ceil(records.length/step)},(_,i)=>{
    const group=records.slice(i*step,(i+1)*step),first=group[0],last=group.at(-1)!,previous=records[i*step-1];
    const gap=group.some((record,index)=>{const before=index?group[index-1]:previous;return record.event.kind==='gap'||!!before&&record.event.seq!==before.event.seq+1;});
    const inserted=group.reduce((sum,record)=>sum+record.event.inserted,0),deleted=group.reduce((sum,record)=>sum+record.event.deleted,0);
    const duration=last.event.elapsed_ms-(previous?.event.elapsed_ms??first.event.elapsed_ms);
    return {seq:first.event.seq,elapsed:last.event.elapsed_ms,inserted,deleted,rate:!gap&&duration>0?inserted/duration*1000:null};
  });
  const changeMax=Math.max(1,...bins.map(bin=>Math.max(bin.inserted,bin.deleted))),rateMax=Math.max(1,...bins.map(bin=>bin.rate??0));
  const focused=selectedSeq===null||selectedSeq===undefined?-1:records.findIndex(r=>r.event.seq===selectedSeq);
  const index=Math.max(0,Math.min(focused>=0?focused:selected,records.length-1));const active=records[index];
  const choose=(next:number)=>{setSelected(next);if(records[next])onSelect?.(records[next].event.seq);};
  return <section className="timeline-panel panel m-surface"><div className="section-top"><div><h2 className="section-label">过程轨迹</h2></div><label className="quiet-label"><select aria-label="过程指标" value={metric} onChange={e=>setMetric(e.target.value)}>{available.map(k=><option key={k} value={k}>{metricLabels[k]}</option>)}</select></label></div>
    <div className="behavior-layers"><label><input type="checkbox" checked={showChanges} onChange={event=>setShowChanges(event.target.checked)}/>新增与删除</label><label><input type="checkbox" checked={showRate} onChange={event=>setShowRate(event.target.checked)}/>写入速率</label><span>蓝线为内容量，橙色标记对应编辑提醒</span></div>
    <div className="chart behavior-chart"><div className="chart-grid"/><svg viewBox="0 0 920 190" role="img" aria-label={`记录期间的${metricLabels[metric]}、文字增删与写入速率`}><path d={path} fill="none" stroke="var(--blue)" strokeWidth="2"/>{points.filter(r=>value(r)!==undefined).map(r=><circle key={r.event.seq} cx={r.event.elapsed_ms/total*900+10} cy={120-value(r)!/max*90} r="2" fill="var(--blue)"/>)}{showChanges&&bins.map(bin=><g key={bin.seq}><rect x={bin.elapsed/total*900+8} y={153-bin.inserted/changeMax*24} width="3" height={bin.inserted/changeMax*24} fill="var(--blue)"/><rect x={bin.elapsed/total*900+8} y="154" width="3" height={bin.deleted/changeMax*24} fill="var(--ink-muted)"/></g>)}{showRate&&bins.filter(bin=>bin.rate!==null).map(bin=><circle key={bin.seq} cx={bin.elapsed/total*900+10} cy={120-bin.rate!/rateMax*90} r="3" fill="var(--behavior-warning)"><title>{time(bin.elapsed)} · 每秒约 {bin.rate!.toFixed(1)} 字符</title></circle>)}{signals.map((signal,i)=><g key={`${signal.code}-${i}`}><title>编辑提醒 {i+1} · {time(signal.start_ms)}</title><line x1={signal.start_ms/total*900+10} x2={signal.start_ms/total*900+10} y1="10" y2="180" stroke="var(--behavior-warning)" strokeDasharray="3 4"/><circle cx={signal.start_ms/total*900+10} cy="12" r="4" fill="var(--behavior-warning)"/></g>)}{active&&<line x1={active.event.elapsed_ms/total*900+10} x2={active.event.elapsed_ms/total*900+10} y1="20" y2="180" stroke="var(--ink-soft)" strokeDasharray="3 5"/>}</svg></div>
    <div className="chart-axis"><span>开始记录</span><span>{time(total)} · 记录跨度</span></div>
    {signals.length>0&&<div className="behavior-chart-markers">{signals.map((signal,i)=><button key={`${signal.code}-${i}`} onClick={()=>choose(records.findIndex(record=>record.event.seq>=signal.first_seq))}>提醒 {i+1} · {time(signal.start_ms)}</button>)}</div>}
    <label className="scrub"><span>浏览事件</span><input aria-label="浏览事件" type="range" min="0" max={Math.max(0,records.length-1)} value={index} onChange={e=>choose(Number(e.target.value))}/></label>
    {active&&<div className="event-detail"><span>#{String(active.event.seq+1).padStart(4,'0')}</span><strong>{labels[active.event.kind]||active.event.kind}</strong><span>{metric==='chars'?`+${active.event.inserted} / −${active.event.deleted}`:`${metricLabels[metric]}：${value(active)??'未采集'}`}</span><span>{time(active.event.elapsed_ms)}</span><code>{shorten(active.hash)}</code></div>}
    <p className="caption">曲线表示已采集事件中的{metricLabels[metric]}，不展示作品内容。空白时段不等同于思考或劳动；不同指标不能互相换算，未采集指标留空而非按零绘制。</p>
    <p className="caption">下方蓝柱为每段新增文字，灰柱为删除文字。速率点按该段已知时间计算，各图层分别缩放。缺少相邻记录或时间差时留空；图表最多汇总约 240 段，滑块仍逐条查看原始记录。</p>
    <ActionBreakdown records={records}/>
  </section>;
}
