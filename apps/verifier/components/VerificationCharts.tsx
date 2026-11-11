'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {init,use,type EChartsCoreOption} from 'echarts/core';
import {BarChart,BoxplotChart,HeatmapChart,LineChart,PieChart,ScatterChart,TreemapChart} from 'echarts/charts';
import {GridComponent,LegendComponent,TooltipComponent,VisualMapComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {Button} from './button';
import {Panel} from './institution-ui';
import type {RecordEntry} from '../lib/evidence';

use([BarChart,BoxplotChart,HeatmapChart,LineChart,PieChart,ScatterChart,TreemapChart,GridComponent,LegendComponent,TooltipComponent,VisualMapComponent,CanvasRenderer]);

const charts = [
  ['activity','操作频次','各时间段的事件数量'],
  ['changes','新增与删除','各时间段新增和删除的字符数'],
  ['length','文档长度','每个时间段末尾记录的文档字符数'],
  ['area','累计新增','从首条记录开始累加的新增字符数'],
  ['scatter','单次写入散点','单次新增量和对应的记录时间'],
  ['donut','操作构成','各类事件占可见记录的比例'],
  ['heatmap','操作热图','各类事件在不同时间段的分布'],
  ['box','写入间隔箱线图','相邻写入间隔的最小值、四分位数和最大值'],
  ['tree','操作矩形树图','面积代表各类可见事件的数量'],
  ['histogram','新增量直方图','有新增字符的事件按单次新增量分组'],
] as const;
type ChartId = typeof charts[number][0];
const categoryCharts:ChartId[]=['donut','tree','histogram'];
const eventNames:Record<string,string>={start:'开始记录',save:'保存',edit:'文字编辑',format:'调整格式',undo:'撤销',redo:'重做',layout:'调整版式',interaction:'编辑交互',gap:'采集缺口',layer:'图层操作',structure:'结构记录'};
const nameOf=(kind:string)=>Object.hasOwn(eventNames,kind)?eventNames[kind]:'其他操作';

function summarize(records:RecordEntry[]) {
  const events=records.map(row=>row.event);
  const duration=events.reduce((max,event)=>Math.max(max,event.elapsed_ms),0);
  const width=Math.max(1,Math.ceil((duration+1)/Math.min(36,Math.max(1,events.length))));
  const buckets=Array.from({length:Math.floor(duration/width)+1},(_,i)=>({label:`${Number((i*width/1000).toFixed(2))} 秒`,count:0,inserted:0,deleted:0,chars:null as number|null}));
  const counts=new Map<string,number>();
  const heat=new Map<string,Map<number,number>>();
  const gaps:number[]=[];
  const largestWrite=events.reduce((max,event)=>Math.max(max,event.inserted),0);
  const bandWidth=Math.max(1,Math.ceil(largestWrite/10));
  const bands=Array.from({length:Math.max(1,Math.ceil(largestWrite/bandWidth))},(_,i)=>({
    name:bandWidth===1?String(i+1):`${i*bandWidth+1}–${(i+1)*bandWidth}`,value:0,
  }));
  const writes:[number,number][]=[];
  let lastWrite:number|undefined;
  for(const event of events){
    const index=Math.min(buckets.length-1,Math.floor(event.elapsed_ms/width));
    const bucket=buckets[index],name=nameOf(event.kind);
    bucket.count++;bucket.inserted+=event.inserted;bucket.deleted+=event.deleted;bucket.chars=event.chars;
    counts.set(name,(counts.get(name)??0)+1);
    const series=heat.get(name)??new Map<number,number>();
    series.set(index,(series.get(index)??0)+1);heat.set(name,series);
    if(event.kind==='gap')lastWrite=undefined;
    if(event.inserted>0){
      writes.push([event.elapsed_ms/1000,event.inserted]);
      bands[Math.floor((event.inserted-1)/bandWidth)].value++;
      if(lastWrite!==undefined&&event.elapsed_ms>=lastWrite)gaps.push((event.elapsed_ms-lastWrite)/1000);
      lastWrite=event.elapsed_ms;
    }
  }
  const categories=Array.from(counts,([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  return {buckets,categories,heat,gaps,bands,writes};
}

export default function VerificationCharts({records,partial,reduced}:{records:RecordEntry[];partial:boolean;reduced:boolean}){
  const [selected,setSelected]=useState<ChartId>(partial?'donut':'activity');
  const [dark,setDark]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const data=useMemo(()=>summarize(records),[records]);
  const current=charts.find(([id])=>id===selected)!;
  const empty=records.length===0||(selected==='box'&&data.gaps.length<2)||(selected==='scatter'&&data.writes.length===0)||(selected==='histogram'&&data.writes.length===0);
  useEffect(()=>{
    const read=()=>setDark(document.documentElement.dataset.theme==='dark');
    read();window.addEventListener('workproof:appearance-changed',read);
    return()=>window.removeEventListener('workproof:appearance-changed',read);
  },[]);
  useEffect(()=>{
    const element=root.current;
    if(!element||empty)return;
    const chart=init(element,null,{renderer:'canvas'});
    const color=dark?'#eee':'#242424';
    const labels=data.buckets.map(bucket=>bucket.label);
    const base:EChartsCoreOption={animation:!reduced,color:dark?['#75b6ed','#ffad98','#9ad5a2','#d2b1eb','#f6ce70']:['#0f6cbd','#b73c26','#107c41','#7854a4','#927115'],textStyle:{color},tooltip:{trigger:'item',renderMode:'richText',confine:true},grid:{left:66,right:22,bottom:54,top:38},legend:{textStyle:{color}}};
    const axis=(category:string[],unit:string)=>({xAxis:{type:'category',data:category,axisLabel:{color,hideOverlap:true}},yAxis:{type:'value',name:unit,axisLabel:{color}}});
    let option:EChartsCoreOption;
    switch(selected){
      case 'activity':option={...axis(labels,'事件'),series:[{type:'bar',name:'事件数量',data:data.buckets.map(b=>b.count)}]};break;
      case 'changes':option={...axis(labels,'字符'),legend:{data:['新增','删除'],textStyle:{color}},series:[{type:'bar',name:'新增',data:data.buckets.map(b=>b.inserted)},{type:'bar',name:'删除',data:data.buckets.map(b=>b.deleted)}]};break;
      case 'length':option={...axis(labels,'字符'),series:[{type:'line',name:'记录长度',connectNulls:false,data:data.buckets.map(b=>b.chars)}]};break;
      case 'area':{
        let total=0;
        option={...axis(labels,'字符'),series:[{type:'line',name:'累计新增',areaStyle:{opacity:.2},data:data.buckets.map(b=>total+=b.inserted)}]};break;
      }
      case 'scatter':{
        const stride=Math.max(1,Math.ceil(data.writes.length/500));
        option={xAxis:{type:'value',name:'秒',axisLabel:{color}},yAxis:{type:'value',name:'新增字符',axisLabel:{color}},series:[{type:'scatter',data:data.writes.filter((_,i)=>i%stride===0)}]};break;
      }
      case 'donut':option={series:[{type:'pie',radius:['44%','69%'],label:{color,formatter:'{b}'},data:data.categories}]};break;
      case 'heatmap':{
        const names=data.categories.map(c=>c.name),points:[number,number,number][]=[];
        names.forEach((name,row)=>data.heat.get(name)?.forEach((count,column)=>points.push([column,row,count])));
        option={grid:{left:100,right:22,top:28,bottom:78},xAxis:{type:'category',data:labels,axisLabel:{color,hideOverlap:true}},yAxis:{type:'category',data:names,axisLabel:{color}},visualMap:{min:0,max:Math.max(1,...points.map(point=>point[2])),orient:'horizontal',left:'center',bottom:5,textStyle:{color},inRange:{color:dark?['#273c4f','#75b6ed']:['#e5f1fc','#0f6cbd']}},series:[{type:'heatmap',data:points}]};break;
      }
      case 'box':{
        const sorted=[...data.gaps].sort((a,b)=>a-b);
        const q=(fraction:number)=>{const position=(sorted.length-1)*fraction,index=Math.floor(position);return sorted[index]+((sorted[index+1]??sorted[index])-sorted[index])*(position-index);};
        option={...axis(['相邻写入间隔'],'秒'),series:[{type:'boxplot',data:[[q(0),q(.25),q(.5),q(.75),q(1)]]}]};break;
      }
      case 'tree':option={series:[{type:'treemap',roam:false,nodeClick:false,breadcrumb:{show:false},label:{formatter:'{b}'},data:data.categories}]};break;
      case 'histogram':option={...axis(data.bands.map(b=>b.name),'事件'),series:[{type:'bar',name:'单次新增量',barCategoryGap:2,data:data.bands.map(b=>b.value)}]};break;
    }
    chart.setOption({...base,...option});
    const observer=new ResizeObserver(()=>chart.resize());observer.observe(element);
    return()=>{observer.disconnect();chart.dispose();};
  },[data,dark,empty,reduced,selected]);

  return <Panel title="统计图" className="verification-charts">
    <div className="chart-choices" role="group" aria-label="选择统计图">
      {charts.map(([id,label])=><Button key={id} variant={id===selected?'primary':'ghost'} aria-pressed={id===selected} disabled={partial&&!categoryCharts.includes(id)} onClick={()=>setSelected(id)}>{label}</Button>)}
    </div>
    {partial&&<p>这份证书只披露部分事件，可查看构成和分布。</p>}
    <h3>{current[1]}</h3><p>{current[2]}{selected==='scatter'&&data.writes.length>500?'。图中按顺序抽样展示最多 500 条。':''}</p>
    {empty?<p role="status">可用数据不足，暂时无法绘图。</p>:<div className="verification-chart" ref={root} role="img" aria-label={`${current[1]}，${current[2]}`}/>}
    <details><summary>查看操作数量</summary><dl className="chart-counts">{data.categories.map(row=><div key={row.name}><dt>{row.name}</dt><dd>{row.value.toLocaleString()} 条</dd></div>)}</dl></details>
  </Panel>;
}
