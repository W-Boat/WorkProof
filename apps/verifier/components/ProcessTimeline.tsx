'use client';
import {useState} from 'react';
import {type RecordEntry,time,labels,metricLabels,shorten} from '../lib/evidence';
export function Timeline({records}:{records:RecordEntry[]}){
  const [selected,setSelected]=useState(0);
  const structured=records.some(r=>r.event.metrics?.vertices!==undefined||r.event.metrics?.layers!==undefined);
  const [metric,setMetric]=useState(records.some(r=>r.event.metrics?.vertices!==undefined)?'vertices':records.some(r=>r.event.metrics?.layers!==undefined)?'layers':'chars');
  const available=[...(structured?[]:['chars']),...Object.keys(metricLabels).filter(k=>k!=='chars'&&records.some(r=>r.event.metrics?.[k]!==undefined))];
  const value=(r:RecordEntry)=>metric==='chars'?r.event.chars:r.event.metrics?.[metric];
  const max=records.reduce((n,r)=>Math.max(n,value(r)??0),1);const total=records.at(-1)?.event.elapsed_ms||1;
  // Bin large logs for display; original events remain in the signed evidence.
  const step=Math.max(1,Math.ceil(records.length/240));const points=records.filter((_,i)=>i%step===0||i===records.length-1);
  let penDown=false;const segments:string[]=[];
  records.forEach((r,i)=>{const v=value(r);if(v===undefined){penDown=false;return;}if(i%step!==0&&i!==records.length-1)return;segments.push(`${penDown?'L':'M'} ${(r.event.elapsed_ms/total*900+10).toFixed(1)} ${(140-v/max*110).toFixed(1)}`);penDown=true;});
  const path=segments.join(' ');
  const index=Math.min(selected,records.length-1);const active=records[index];
  return <section className="timeline-panel panel m-surface"><div className="section-top"><div><h2 className="section-label">过程轨迹</h2></div><label className="quiet-label"><select aria-label="过程指标" value={metric} onChange={e=>setMetric(e.target.value)}>{available.map(k=><option key={k} value={k}>{metricLabels[k]}</option>)}</select></label></div>
    <div className="chart"><div className="chart-grid"/><svg viewBox="0 0 920 160" role="img" aria-label={`记录期间的${metricLabels[metric]}变化`}><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7cceaa" stopOpacity=".18"/><stop offset="100%" stopColor="#7cceaa" stopOpacity="0"/></linearGradient></defs><path d={path} fill="none" stroke="var(--blue)" strokeWidth="2"/>{points.filter(r=>value(r)!==undefined).map(r=><circle key={r.event.seq} cx={r.event.elapsed_ms/total*900+10} cy={140-value(r)!/max*110} r="2" fill="var(--blue)"/>)}{active&&<line x1={active.event.elapsed_ms/total*900+10} x2={active.event.elapsed_ms/total*900+10} y1="16" y2="150" stroke="var(--ink-soft)" strokeDasharray="3 5"/>}</svg></div>
    <div className="chart-axis"><span>开始记录</span><span>{time(total)} · 记录跨度</span></div>
    <label className="scrub"><span>浏览事件</span><input aria-label="浏览事件" type="range" min="0" max={Math.max(0,records.length-1)} value={index} onChange={e=>setSelected(Number(e.target.value))}/></label>
    {active&&<div className="event-detail"><span>#{String(active.event.seq+1).padStart(4,'0')}</span><strong>{labels[active.event.kind]||active.event.kind}</strong><span>{metric==='chars'?`+${active.event.inserted} / −${active.event.deleted}`:`${metricLabels[metric]}：${value(active)??'未采集'}`}</span><span>{time(active.event.elapsed_ms)}</span><code>{shorten(active.hash)}</code></div>}
    <p className="caption">曲线表示已采集事件中的{metricLabels[metric]}，不展示作品内容。空白时段不等同于思考或劳动；不同指标不能互相换算，未采集指标留空而非按零绘制。</p>
  </section>;
}
