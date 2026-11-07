'use client';
import {useState} from 'react';
import {type RecordEntry,type BehaviorSignal,time,labels,metricLabels,shorten} from '../lib/evidence';
import {ActionBreakdown} from './ActionBreakdown';
export function Timeline({records,signals=[],selectedSeq,onSelect}:{records:RecordEntry[];signals?:BehaviorSignal[];selectedSeq?:number|null;onSelect?:(seq:number)=>void}){
  const [selected,setSelected]=useState(0);
  const [showChanges,setShowChanges]=useState(true),[showRate,setShowRate]=useState(true);
  const structured=records.some(r=>r.event.metrics?.vertices!==undefined||r.event.metrics?.layers!==undefined);
  const [metric,setMetric]=useState(records.some(r=>r.event.metrics?.vertices!==undefined)?'vertices':records.some(r=>r.event.metrics?.layers!==undefined)?'layers':'chars');
  const available=[...(structured?[]:['chars']),...Object.keys(metricLabels).filter(k=>k!=='chars'&&records.some(r=>r.event.metrics?.[k]!==undefined))];
  const value=(r:RecordEntry)=>metric==='chars'?r.event.chars:r.event.metrics?.[metric];
  const max=records.reduce((n,r)=>Math.max(n,value(r)??0),1);const total=records.at(-1)?.event.elapsed_ms||1;
  // Bin large logs for display; original events remain in the signed evidence.
  const step=Math.max(1,Math.ceil(records.length/240));const points=records.filter((_,i)=>i%step===0||i===records.length-1);
  const bins=Array.from({length:Math.ceil(records.length/step)},(_,i)=>{
    const group=records.slice(i*step,(i+1)*step),first=group[0],last=group.at(-1)!,previous=records[i*step-1];
    const gap=group.some((record,index)=>{const before=index?group[index-1]:previous;return record.event.kind==='gap'||!!before&&record.event.seq!==before.event.seq+1;});
    const inserted=group.reduce((sum,record)=>sum+record.event.inserted,0),deleted=group.reduce((sum,record)=>sum+record.event.deleted,0);
    const duration=last.event.elapsed_ms-(previous?.event.elapsed_ms??first.event.elapsed_ms);
    return {seq:first.event.seq,elapsed:last.event.elapsed_ms,inserted,deleted,rate:!gap&&duration>0?inserted/duration*1000:null};
  });
  const changeMax=Math.max(1,...bins.map(bin=>Math.max(bin.inserted,bin.deleted))),rateMax=Math.max(1,...bins.map(bin=>bin.rate??0));
  const x=(elapsed:number)=>92+elapsed/total*816;
  const number=(value:number)=>value>=10000?`${(value/10000).toFixed(1)}万`:value>=1000?`${(value/1000).toFixed(1)}千`:Number(value.toFixed(1)).toLocaleString();
  let penDown=false;const segments:string[]=[];
  records.forEach((record,index)=>{
    if(record.event.kind==='gap'||index>0&&record.event.seq!==records[index-1].event.seq+1)penDown=false;
    const amount=value(record);if(amount===undefined){penDown=false;return;}
    if(index%step!==0&&index!==records.length-1)return;
    segments.push(`${penDown?'L':'M'} ${x(record.event.elapsed_ms).toFixed(1)} ${(122-amount/max*80).toFixed(1)}`);penDown=true;
  });
  const path=segments.join(' ');
  const chartHeight=structured?170:420;
  const focused=selectedSeq===null||selectedSeq===undefined?-1:records.findIndex(r=>r.event.seq===selectedSeq);
  const index=Math.max(0,Math.min(focused>=0?focused:selected,records.length-1));const active=records[index];
  const choose=(next:number)=>{setSelected(next);if(records[next])onSelect?.(records[next].event.seq);};
  return <section className="timeline-panel panel m-surface"><div className="section-top"><div><h2 className="section-label">过程轨迹</h2></div><label className="quiet-label"><select aria-label="过程指标" value={metric} onChange={e=>setMetric(e.target.value)}>{available.map(k=><option key={k} value={k}>{metricLabels[k]}</option>)}</select></label></div>
    {!structured&&<div className="behavior-layers"><label><input type="checkbox" checked={showChanges} onChange={event=>setShowChanges(event.target.checked)}/>新增与删除</label><label><input type="checkbox" checked={showRate} onChange={event=>setShowRate(event.target.checked)}/>写入速率</label></div>}
    <div className="process-legend" aria-label="图表图例"><span><i className="legend-quantity"/>内容量</span>{!structured&&<><span><i className="legend-add"/>新增字符</span><span><i className="legend-delete"/>删除字符</span><span><i className="legend-rate"/>写入速率</span></>}<span><i className="legend-notice"/>需要复核的时间</span></div>
    <div className="process-chart-scroll" role="region" aria-label="编辑过程图表，可横向滚动" tabIndex={0}><svg className="process-chart" viewBox={`0 0 940 ${chartHeight}`} role="img" aria-label="同一时间轴上的内容量、每段新增删除与写入速率，均附单位和刻度">
      <text x="16" y="22" className="chart-section-title">{metricLabels[metric]||metric}</text>
      {[0,.5,1].map(fraction=><g key={fraction}><line x1="92" x2="908" y1={122-fraction*80} y2={122-fraction*80} className="process-grid-line"/><text x="80" y={126-fraction*80} textAnchor="end">{number(max*fraction)}</text></g>)}
      <path d={path} fill="none" className="quantity-line"/>
      {points.filter(record=>value(record)!==undefined).map(record=><circle key={record.event.seq} cx={x(record.event.elapsed_ms)} cy={122-value(record)!/max*80} r="2" className="quantity-point"/>)}
      {!structured&&showChanges&&<g><text x="16" y="161" className="chart-section-title">每段增删（字符）</text>{[-1,0,1].map(fraction=><g key={fraction}><line x1="92" x2="908" y1={218-fraction*35} y2={218-fraction*35} className="process-grid-line"/><text x="80" y={222-fraction*35} textAnchor="end">{fraction>0?'+':''}{number(changeMax*fraction)}</text></g>)}{bins.map(bin=><g key={bin.seq}><title>{time(bin.elapsed)} · 新增 {bin.inserted} / 删除 {bin.deleted} 字符</title><rect x={x(bin.elapsed)-2} y={218-bin.inserted/changeMax*35} width="4" height={bin.inserted/changeMax*35} className="insert-bar"/><rect x={x(bin.elapsed)-2} y="219" width="4" height={bin.deleted/changeMax*35} className="delete-bar"/></g>)}</g>}
      {!structured&&showRate&&<g><text x="16" y="291" className="chart-section-title">写入速率（字符/秒）</text>{[0,.5,1].map(fraction=><g key={fraction}><line x1="92" x2="908" y1={371-fraction*62} y2={371-fraction*62} className="process-grid-line"/><text x="80" y={375-fraction*62} textAnchor="end">{number(rateMax*fraction)}</text></g>)}{bins.filter(bin=>bin.rate!==null).map(bin=><circle key={bin.seq} cx={x(bin.elapsed)} cy={371-bin.rate!/rateMax*62} r="3" className="rate-point"><title>{time(bin.elapsed)} · 每秒约 {bin.rate!.toFixed(1)} 字符</title></circle>)}</g>}
      {signals.map((signal,index)=><g key={`${signal.code}-${index}`}><title>提醒 {index+1} · {time(signal.start_ms)}</title><line x1={x(signal.start_ms)} x2={x(signal.start_ms)} y1="30" y2={chartHeight-32} className="notice-line"/><text x={x(signal.start_ms)+5} y="34" className="notice-label">{index+1}</text></g>)}
      {active&&<line x1={x(active.event.elapsed_ms)} x2={x(active.event.elapsed_ms)} y1="40" y2={chartHeight-32} className="selected-event-line"/>}
      {[0,.25,.5,.75,1].map(fraction=><text key={fraction} x={x(total*fraction)} y={chartHeight-10} textAnchor={fraction===0?'start':fraction===1?'end':'middle'}>{time(total*fraction)}</text>)}
    </svg></div>
    {signals.length>0&&<div className="behavior-chart-markers">{signals.map((signal,i)=><button key={`${signal.code}-${i}`} onClick={()=>choose(records.findIndex(record=>record.event.seq>=signal.first_seq))}>提醒 {i+1} · {time(signal.start_ms)}</button>)}</div>}
    <label className="scrub"><span>浏览事件</span><input aria-label="浏览事件" type="range" min="0" max={Math.max(0,records.length-1)} value={index} onChange={e=>choose(Number(e.target.value))}/></label>
    {active&&<div className="event-detail"><span>#{String(active.event.seq+1).padStart(4,'0')}</span><strong>{labels[active.event.kind]||active.event.kind}</strong><span>{metric==='chars'?`+${active.event.inserted} / −${active.event.deleted}`:`${metricLabels[metric]}：${value(active)??'未采集'}`}</span><span>{time(active.event.elapsed_ms)}</span><code>{shorten(active.hash)}</code></div>}
    <p className="caption">曲线表示已采集事件中的{metricLabels[metric]}，不展示作品内容。空白时段不等同于思考或劳动；不同指标不能互相换算，未采集指标留空而非按零绘制。</p>
    <p className="caption">绿色向上柱为每段新增字符，红色向下柱为删除字符。橙色速率点按该段已知时间计算，各分区单独标注刻度。缺少相邻记录或时间差时留空；图表最多汇总约 240 段，滑块仍逐条查看原始记录。</p>
    <ActionBreakdown records={records}/>
  </section>;
}
