'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {init,use,type EChartsCoreOption} from 'echarts/core';
import {BarChart,BoxplotChart,HeatmapChart,LineChart,PieChart,ScatterChart,TreemapChart} from 'echarts/charts';
import {GridComponent,LegendComponent,TooltipComponent,VisualMapComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {Button} from './button';
import {Notice,Panel,Select} from './institution-ui';
import type {RecordEntry} from '../lib/evidence';
import {charts,categoryCharts,DATA_PAGE_SIZE,summarize,chartTable,chartOption,type ChartId} from '../lib/verification-chart-data';

use([BarChart,BoxplotChart,HeatmapChart,LineChart,PieChart,ScatterChart,TreemapChart,GridComponent,LegendComponent,TooltipComponent,VisualMapComponent,CanvasRenderer]);

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
    chart.setOption(chartOption(selected,data,dark,reduced));
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
