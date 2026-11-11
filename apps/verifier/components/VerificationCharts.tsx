'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {init,use,type EChartsCoreOption} from 'echarts/core';
import {BarChart,BoxplotChart,HeatmapChart,LineChart,PieChart,ScatterChart,TreemapChart} from 'echarts/charts';
import {GridComponent,LegendComponent,TooltipComponent,VisualMapComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {Button} from './button';
import {Notice,Panel,Select} from './institution-ui';
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
const DATA_PAGE_SIZE=20;
const categoryCharts:ChartId[]=['donut','tree','histogram'];
const eventNames:Record<string,string>={start:'开始记录',save:'保存',edit:'文字编辑',format:'调整格式',undo:'撤销',redo:'重做',layout:'调整版式',interaction:'编辑交互',gap:'采集缺口',layer:'图层操作',structure:'结构记录'};
const nameOf=(kind:string)=>Object.hasOwn(eventNames,kind)?eventNames[kind]:'其他操作';

function summarize(records:RecordEntry[]) {
  const events=records.map(row=>row.event);
  const duration=events.reduce((max,event)=>Math.max(max,event.elapsed_ms),0);
  const width=Math.max(1,Math.ceil((duration+1)/Math.min(36,Math.max(1,events.length))));
  const buckets=Array.from({length:Math.floor(duration/width)+1},(_,i)=>({label:`${Number((i*width/1000).toFixed(3))} 秒`,count:0,inserted:0,deleted:0,chars:null as number|null,gap:false}));
  const counts=new Map<string,number>();
  const heat=new Map<string,Map<number,number>>();
  const gaps:number[]=[];
  const largestWrite=events.reduce((max,event)=>Math.max(max,event.inserted),0);
  const bandWidth=Math.max(1,Math.ceil(largestWrite/10));
  const bands=Array.from({length:Math.max(1,Math.ceil(largestWrite/bandWidth))},(_,i)=>({
    name:bandWidth===1?String(i+1):`${i*bandWidth+1}–${Math.min(largestWrite,(i+1)*bandWidth)}`,value:0,
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
    if(event.kind==='gap'){bucket.gap=true;lastWrite=undefined;}
    if(event.inserted>0){
      writes.push([event.elapsed_ms/1000,event.inserted]);
      bands[Math.floor((event.inserted-1)/bandWidth)].value++;
      if(lastWrite!==undefined&&event.elapsed_ms>=lastWrite)gaps.push((event.elapsed_ms-lastWrite)/1000);
      lastWrite=event.elapsed_ms;
    }
  }
  const categories=Array.from(counts,([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  let runningTotal=0;
  const cumulative=buckets.map(bucket=>runningTotal+=bucket.inserted);
  const sortedGaps=gaps.sort((a,b)=>a-b);
  const quantiles=sortedGaps.length<2?[]:[0,.25,.5,.75,1].map(fraction=>{
    const position=(sortedGaps.length-1)*fraction,index=Math.floor(position);
    return sortedGaps[index]+((sortedGaps[index+1]??sortedGaps[index])-sortedGaps[index])*(position-index);
  });
  const stride=Math.max(1,Math.ceil(writes.length/497));
  const largest=writes.reduce((max,point,index)=>point[1]>writes[max][1]?index:max,0);
  const plottedWrites=writes.length<=500?writes:writes.filter((_,i)=>i%stride===0||i===largest||i===writes.length-1);
  return {buckets,categories,heat,bands,writes,plottedWrites,quantiles,cumulative};
}

type ChartTable={headers:string[];rows:(string|number|null)[][]};
function chartTable(id:ChartId,data:ReturnType<typeof summarize>):ChartTable{
  const {buckets,categories,heat,bands,plottedWrites,quantiles,cumulative}=data;
  switch(id){
    case 'activity':return {headers:['区间起点','事件数'],rows:buckets.map(b=>[b.label,b.count])};
    case 'changes':return {headers:['区间起点','新增字符','删除字符'],rows:buckets.map(b=>[b.label,b.inserted,b.deleted])};
    case 'length':return {headers:['区间起点','记录字符数'],rows:buckets.map(b=>[b.label,b.gap?null:b.chars])};
    case 'area':return {headers:['区间起点','累计新增字符'],rows:buckets.map((b,i)=>[b.label,b.gap?null:cumulative[i]])};
    case 'scatter':return {headers:['记录时间（秒）','新增字符'],rows:plottedWrites};
    case 'donut':
    case 'tree':{
      const total=categories.reduce((sum,item)=>sum+item.value,0);
      return {headers:['操作类型','事件数','占比'],rows:categories.map(item=>[item.name,item.value,`${(100*item.value/total).toFixed(1)}%`])};
    }
    case 'heatmap':return {headers:['操作类型','区间起点','事件数'],rows:categories.flatMap(item=>Array.from(heat.get(item.name)??[],([column,count])=>[item.name,buckets[column].label,count]))};
    case 'box':return {headers:['位置','间隔（秒）'],rows:quantiles.map((value,i)=>[['最短','第 25 百分位','中位数','第 75 百分位','最长'][i],value])};
    case 'histogram':return {headers:['单次新增字符数','事件数'],rows:bands.map(b=>[b.name,b.value])};
  }
}

export default function VerificationCharts({records,partial,reduced}:{records:RecordEntry[];partial:boolean;reduced:boolean}){
  const [selected,setSelected]=useState<ChartId>(partial?'donut':'activity');
  const [showData,setShowData]=useState(false);
  const [page,setPage]=useState(0);
  const [dark,setDark]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const data=useMemo(()=>summarize(records),[records]);
  const structured=useMemo(()=>records.some(({event})=>event.metrics?.vertices!==undefined||event.metrics?.layers!==undefined),[records]);
  const current=charts.find(([id])=>id===selected)!;
  const empty=records.length===0||(selected==='box'&&!data.quantiles.length)||((selected==='scatter'||selected==='histogram')&&!data.writes.length)||(selected==='length'&&!data.buckets.some(bucket=>!bucket.gap&&bucket.chars!==null));
  const table=useMemo(()=>showData&&!empty?chartTable(selected,data):null,[data,empty,selected,showData]);
  useEffect(()=>{
    const read=()=>setDark(document.documentElement.dataset.theme==='dark');
    read();window.addEventListener('workproof:appearance-changed',read);
    return()=>window.removeEventListener('workproof:appearance-changed',read);
  },[]);
  useEffect(()=>{
    const element=root.current;
    if(!element||empty||showData)return;
    const chart=init(element,null,{renderer:'canvas'});
    const color=dark?'#eee':'#242424';
    const labels=data.buckets.map(bucket=>bucket.label);
    const base:EChartsCoreOption={animation:!reduced,animationDuration:220,color:dark?['#75b6ed','#ffad98','#9ad5a2','#d2b1eb','#f6ce70']:['#0f6cbd','#b73c26','#107c41','#7854a4','#927115'],textStyle:{color,fontFamily:'Segoe UI, Microsoft YaHei, sans-serif',fontSize:13},tooltip:{trigger:'item',renderMode:'richText',confine:true},grid:{left:66,right:38,bottom:44,top:48},legend:{textStyle:{color}}};
    const axis=(category:string[],unit:string)=>({xAxis:{type:'category',data:category,axisLabel:{color,hideOverlap:true}},yAxis:{type:'value',name:unit,axisLabel:{color}}});
    let option:EChartsCoreOption;
    switch(selected){
      case 'activity':option={...axis(labels,'事件'),series:[{type:'bar',name:'事件数量',data:data.buckets.map(b=>b.count)}]};break;
      case 'changes':option={...axis(labels,'字符'),legend:{data:['新增','删除'],textStyle:{color}},series:[{type:'bar',name:'新增',data:data.buckets.map(b=>b.inserted)},{type:'bar',name:'删除',data:data.buckets.map(b=>b.deleted)}]};break;
      case 'length':option={...axis(labels,'字符'),series:[{type:'line',name:'记录长度',connectNulls:false,data:data.buckets.map(b=>b.gap?null:b.chars)}]};break;
      case 'area':option={...axis(labels,'字符'),series:[{type:'line',name:'累计新增',connectNulls:false,areaStyle:{opacity:.2},data:data.buckets.map((b,i)=>b.gap?null:data.cumulative[i])}]};break;
      case 'scatter':option={xAxis:{type:'value',name:'秒',axisLabel:{color}},yAxis:{type:'value',name:'新增字符',axisLabel:{color}},series:[{type:'scatter',name:'单次新增量',data:data.plottedWrites}]};break;
      case 'donut':option={legend:{type:'scroll',bottom:0,textStyle:{color}},series:[{type:'pie',radius:['44%','69%'],center:['50%','46%'],label:{show:false},data:data.categories}]};break;
      case 'heatmap':{
        const names=data.categories.map(c=>c.name),points:[number,number,number][]=[];
        names.forEach((name,row)=>data.heat.get(name)?.forEach((count,column)=>points.push([column,row,count])));
        option={grid:{left:100,right:22,top:28,bottom:78},xAxis:{type:'category',data:labels,axisLabel:{color,hideOverlap:true}},yAxis:{type:'category',data:names,axisLabel:{color}},visualMap:{min:0,max:Math.max(1,...points.map(point=>point[2])),orient:'horizontal',left:'center',bottom:5,textStyle:{color},inRange:{color:dark?['#273c4f','#75b6ed']:['#e5f1fc','#0f6cbd']}},series:[{type:'heatmap',data:points}]};break;
      }
      case 'box':option={...axis(['相邻写入间隔'],'秒'),series:[{type:'boxplot',data:[data.quantiles]}]};break;
      case 'tree':option={series:[{type:'treemap',roam:false,nodeClick:false,breadcrumb:{show:false},label:{formatter:'{b}'},data:data.categories}]};break;
      case 'histogram':option={...axis(data.bands.map(b=>b.name),'事件'),series:[{type:'bar',name:'单次新增量',barCategoryGap:2,data:data.bands.map(b=>b.value)}]};break;
    }
    chart.setOption({...base,...option});
    const observer=new ResizeObserver(()=>chart.resize());observer.observe(element);
    return()=>{observer.disconnect();chart.dispose();};
  },[data,dark,empty,reduced,selected,showData]);

  return <Panel id="verification-charts" title="统计图" className="verification-charts">
    <div className="verification-chart-toolbar">
      <Select label="选择统计图" value={selected} options={charts.map(([id,label])=>({value:id,label,disabled:(partial&&!categoryCharts.includes(id))||(structured&&!['activity','donut','tree','heatmap'].includes(id))}))} onChange={id=>{setSelected(id as ChartId);setPage(0);}}/>
      <Button disabled={empty} onClick={()=>setShowData(!showData)}>{showData?'查看图表':'查看图表数据'}</Button>
    </div>
    {(partial||structured)&&<Notice intent="info">{partial?'这份证书只披露部分事件，可查看已披露事件的构成和分布。':'图层和三维证据可查看操作分布。具体结构指标见过程轨迹。'}</Notice>}
    <h3>{current[1]}</h3><p>{current[2]}。{selected==='scatter'&&data.plottedWrites.length<data.writes.length&&`展示 ${data.plottedWrites.length} / ${data.writes.length.toLocaleString('zh-CN')} 条记录，保留最大写入和末次写入。`}</p>
    {empty?<Notice intent="info">这份证据中可用于当前图表的记录不足。</Notice>:table?<div className="chart-data-view" key="data">
      <div className="verification-table-scroll" role="region" aria-label="图表数据，可横向滚动" tabIndex={0}><table>
        <caption>{current[1]} · 图表数据</caption>
        <thead><tr>{table.headers.map(header=><th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{table.rows.slice(page*DATA_PAGE_SIZE,(page+1)*DATA_PAGE_SIZE).map((row,index)=><tr key={index}>{row.map((value,column)=>{
          const content=typeof value==='number'?value.toLocaleString('zh-CN',{maximumFractionDigits:3}):value??'—';
          return column===0?<th key={column} scope="row">{content}</th>:<td key={column}>{content}</td>;
        })}</tr>)}</tbody>
      </table></div>
      {table.rows.length>DATA_PAGE_SIZE&&<div className="chart-pages"><Button disabled={page===0} onClick={()=>setPage(page-1)}>上一页</Button><span role="status">第 {page+1} / {Math.ceil(table.rows.length/DATA_PAGE_SIZE)} 页</span><Button disabled={(page+1)*DATA_PAGE_SIZE>=table.rows.length} onClick={()=>setPage(page+1)}>下一页</Button></div>}
    </div>:<div className="verification-chart" key="canvas" ref={root} role="img" aria-label={`${current[1]}，${current[2]}`}/>}
  </Panel>;
}
