'use client';
import {useEffect,useMemo,useState} from 'react';
import {Play,Pause,ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from './button';
import {Panel,Select} from './institution-ui';
import {useEmbeddedFluent} from './fluent-embedded';
import {labels,time,type RecordEntry} from '../lib/evidence';

export function ProcessReplay({records,partial=false}:{records:RecordEntry[];partial?:boolean}){
  const embedded=useEmbeddedFluent();
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState('4');
  const frames=useMemo(()=>{
    let inserted=0,deleted=0,elapsed=0;
    return records.map(({event})=>{inserted+=event.inserted;deleted+=event.deleted;elapsed=Math.max(elapsed,event.elapsed_ms);return {event,inserted,deleted,elapsed};});
  },[records]);
  useEffect(()=>{setIndex(0);setPlaying(false);},[records]);
  useEffect(()=>{
    if(!playing||!frames.length)return;
    const start=performance.now(),origin=frames[index]?.elapsed||0;
    let position=index;
    const timer=setInterval(()=>{
      const target=origin+(performance.now()-start)*Number(speed);
      while(position+1<frames.length&&frames[position+1].elapsed<=target)position++;
      setIndex(position);
      if(position===frames.length-1)setPlaying(false);
    },100);
    const pause=()=>{if(document.hidden)setPlaying(false);};document.addEventListener('visibilitychange',pause);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',pause);};
    // The playback clock starts only on play or a speed change. Updating the
    // displayed index must not restart that clock every animation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,speed,frames]);
  const frame=frames[Math.min(index,frames.length-1)];
  const bars=useMemo(()=>{
    const buckets=Array.from({length:64},()=>0),duration=Math.max(1,frames.at(-1)?.elapsed||0);
    for(const item of frames)buckets[Math.min(63,Math.floor(item.elapsed/duration*64))]++;
    const largest=Math.max(1,...buckets);return buckets.map(n=>Math.max(3,n/largest*44));
  },[frames]);
  function seek(value:number){setPlaying(false);setIndex(Math.max(0,Math.min(frames.length-1,value)));}
  const controls=[
    {name:'上一个动作',icon:'arrow_left',Icon:ChevronLeft,disabled:!frame||index===0,run:()=>seek(index-1)},
    {name:playing?'暂停回放':'播放过程',icon:playing?'pause':'play',Icon:playing?Pause:Play,disabled:frames.length<2,run:()=>{if(index>=frames.length-1)setIndex(0);setPlaying(value=>!value);}},
    {name:'下一个动作',icon:'arrow_right',Icon:ChevronRight,disabled:!frame||index>=frames.length-1,run:()=>seek(index+1)},
  ];
  return <Panel title="过程回放" className="proof-process-replay">
    <p>按记录时间查看动作、字符数量和增删变化。证书不含历史正文，不会模拟逐字输入。</p>
    {partial&&<p role="status">仅回放证书已披露的动作，隐藏区间无法还原。</p>}
    {frame?<>
      <div className="proof-replay-stats" aria-live="off">
        <div><span>当时文档字符</span><strong>{frame.event.chars.toLocaleString()}</strong></div>
        <div><span>累计新增</span><strong>{frame.inserted.toLocaleString()}</strong></div>
        <div><span>累计删除</span><strong>{frame.deleted.toLocaleString()}</strong></div>
      </div>
      <p className="proof-replay-current">{time(frame.event.elapsed_ms)} · {labels[frame.event.kind]||frame.event.kind}{frame.event.kind==='gap'?' · 此处存在未采集的修改':''}</p>
      <div className="proof-replay-wave" aria-hidden="true">{bars.map((height,i)=><i key={i} style={{height,opacity:i/64<=frame.elapsed/Math.max(1,frames.at(-1)!.elapsed)?1:.3}}/>)}</div>
      <label className="proof-replay-scrubber">动作 {index+1} / {frames.length.toLocaleString()}<input aria-label="核验过程回放位置" type="range" min={0} max={frames.length-1} step={1} value={index} onChange={event=>seek(Number(event.target.value))}/></label>
      <div className="proof-replay-controls">{controls.map(({name,icon,Icon,disabled,run},controlIndex)=><Button key={controlIndex} aria-label={name} title={name} data-icon={embedded?icon:undefined} disabled={disabled} onClick={run}>{!embedded&&<Icon size={20} aria-hidden="true"/>}</Button>)}<Select label="回放速度" value={speed} onChange={setSpeed} options={['1','4','16','60'].map(value=>({value,label:value+'×'}))}/></div>
      <details><summary>当前动作的原始数据</summary><pre>{JSON.stringify(records[index],null,2)}</pre></details>
    </>:<p>这份证书没有可回放的记录。</p>}
  </Panel>;
}
