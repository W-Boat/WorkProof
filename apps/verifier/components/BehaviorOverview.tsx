import {type BehaviorAssessment} from '../lib/evidence';
import {behaviorAxes} from '../lib/behavior-overview-data';

export function BehaviorOverview({assessment,full}:{assessment?:BehaviorAssessment|null;full:boolean}){
  const axes=behaviorAxes(assessment,full);
  const point=(i:number,r:number)=>{const angle=i*Math.PI*2/5-Math.PI/2;return [180+Math.cos(angle)*r,152+Math.sin(angle)*r];};
  const polygon=(radius:number)=>axes.map((_,i)=>point(i,radius).join(',')).join(' ');
  const complete=axes.every(axis=>axis.value!==null);
  const format=(v:number)=>v===Infinity?'超过 2':v.toLocaleString('zh-CN',{maximumFractionDigits:2});
  return <section className="behavior-overview" aria-label="编辑过程图形概览">
    <div className="behavior-radar"><h3>过程特征概览</h3><svg viewBox="0 0 360 310" role="img" aria-label="五项过程特征相对规则阈值的多边形图；虚线为一倍阈值，外圈为两倍；信息不足的项目不连成面积">
      {[50,100].map(r=><polygon key={r} points={polygon(r)} className={r===50?'reference-ring':'outer-ring'}/>)}
      {axes.map((axis,i)=>{const end=point(i,100),label=point(i,132);return <g key={axis.code}><line x1="180" y1="152" x2={end[0]} y2={end[1]}/><text x={label[0]} y={label[1]} textAnchor="middle" dominantBaseline="middle">{axis.label}</text></g>;})}
      {complete&&<polygon className="measured-area" points={axes.map((axis,i)=>point(i,Math.max(0,Math.min(2,axis.value!))*50).join(',')).join(' ')}/>}
      {axes.map((axis,i)=>{if(axis.value===null)return null;const p=point(i,Math.max(0,Math.min(2,axis.value))*50);return <circle key={axis.code} cx={p[0]} cy={p[1]} r="5" className={axis.status==='triggered'?'needs-review':'observed-point'}><title>{axis.label}：{format(axis.value)} 倍阈值</title></circle>;})}
    </svg><p>虚线为规则阈值；外圈为 2 倍。超出外圈仍按 2 倍绘制。信息不足时只显示已有测量点。</p></div>
    <div className="behavior-ranges"><h3>参考范围检验</h3><p>横条从左到右为 0 至 2 倍阈值，中间虚线为 1 倍。标记越靠右，越需要关注；联合条件以检验单为准。</p>
      {axes.map(axis=><div className="behavior-range" key={axis.code} data-review={axis.status==='triggered'}><div><strong>{axis.label}</strong><span>{axis.value===null?'— 信息不足':`${format(axis.value)} 倍阈值 · ${axis.status==='triggered'?'↑ 需复核':'未触发提醒'}`}</span></div><div className="behavior-range-track" role="img" aria-label={`${axis.label}：${axis.value===null?'信息不足':format(axis.value)+' 倍阈值，'+(axis.status==='triggered'?'需复核':'未触发提醒')}`}><span className="reference-zone"/><i className="threshold-mark"/>{axis.value!==null&&<span className="range-marker" style={{left:`${Math.max(1,Math.min(99,axis.value/2*100))}%`}}/>}</div></div>)}
      <p>间隔规律程度按“波动阈值 ÷ 实测波动”显示，实测为 0 时标在外圈。“未触发提醒”不等同于证明原创或未使用 AI。</p>
    </div>
  </section>;
}
