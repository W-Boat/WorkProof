import {init,use} from 'echarts/core';
import {BarChart,BoxplotChart,HeatmapChart,LineChart,PieChart,RadarChart,ScatterChart,TreemapChart} from 'echarts/charts';
import {GridComponent,LegendComponent,RadarComponent,TooltipComponent,VisualMapComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {charts,categoryCharts,summarize,chartOption,chartTable} from './verification-chart-data';
import {buildBehaviorReport,names} from './behavior-report-data';
import {behaviorAxes} from './behavior-overview-data';
import type {ReportPackage} from './encrypted-report';

use([BarChart,BoxplotChart,HeatmapChart,LineChart,PieChart,RadarChart,ScatterChart,TreemapChart,GridComponent,LegendComponent,RadarComponent,TooltipComponent,VisualMapComponent,CanvasRenderer]);
const el=(tag:string,text?:string,className?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN',{maximumFractionDigits:3}):'—';
function table(headers:string[],rows:(string|number|null|undefined)[][]){const wrap=el('div',undefined,'table-wrap'),root=el('table'),head=el('thead'),body=el('tbody'),tr=el('tr');for(const text of headers)tr.append(el('th',text));head.append(tr);for(const row of rows){const line=el('tr');for(const value of row)line.append(el('td',value==null?'—':String(value)));body.append(line);}root.append(head,body);wrap.append(root);return wrap;}
function details(label:string,value:unknown){const root=el('details');root.append(el('summary',label),el('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return root;}
function download(name:string,bytes:BlobPart,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),link=el('a') as HTMLAnchorElement;link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function command(label:string,run:()=>void){const button=el('button',label) as HTMLButtonElement;button.type='button';button.addEventListener('click',run);return button;}
const fromBase64=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));

function render(model:ReportPackage,root:HTMLElement){
  const result=model.result,report=result.report,proof=result.proof,records=proof.records;
  const header=el('header',undefined,'report-header');header.append(el('p','WorkProof · 本机生成的核验快照'),el('h1','作品核验报告'),el('strong',report.valid?'文件与证书一致':'核验未通过',report.valid?'pass':'error'),el('p','生成时间：'+model.exported_at),el('p','本报告保存生成时的核验结果。复核请使用原作品与 .wproof；MD5 用于核对同一份 HTML 文件。', 'note'));
  const nav=el('nav',undefined,'section-nav');for(const [id,label] of [['summary','核验结果'],['diagnosis','完整检验单'],['charts','全部统计图'],['records','原始记录'],['metadata','文件属性'],['files','原始附件']]){const a=el('a',label) as HTMLAnchorElement;a.href='#report-'+id;nav.append(a);}header.append(nav);root.append(header);
  function section(id:string,title:string){const node=el('section');node.id='report-'+id;node.append(el('h2',title));root.append(node);return node;}
  const summary=section('summary','核验结果'),checks=el('div',undefined,'checks');
  for(const [label,value] of [['作品指纹',report.file_match],['记录链',report.chain_valid],['数字签名',report.signature_valid],['默克尔归属',report.merkle_valid]] as const){const item=el('span',label);item.append(el('strong',value===null?'不适用':value?'通过':'未通过',value===null?'':value?'pass':'error'));checks.append(item);}
  summary.append(checks,el('p',report.scope==='selective'?'核验范围：仅已披露记录，未披露部分不在报告中。':'核验范围：证书提供的完整记录。','scope'));
  const pairs=el('dl');for(const [label,value] of [['作品名称',model.artifact.name],['作品大小',number(model.artifact.bytes)+' 字节'],['作品指纹',result.fingerprint],['证书指纹',result.certificateId],['记录来源',proof.manifest.source],['已披露记录',number(report.disclosed_events)],['声明的总记录数',number(report.total_events)],['身份声明',proof.manifest.identity],['外部时间凭据声明',proof.manifest.time_evidence],['演示数据',proof.manifest.demo?'是':'否']])pairs.append(el('dt',label),el('dd',String(value)));summary.append(pairs);
  if(report.errors.length)summary.append(details('核验错误明细',report.errors));summary.append(details('原始核验结果',report),details('完整证书清单与签名',{manifest:proof.manifest,signature:proof.signature}),details('报告生成环境',model.application));
  if(model.expected_certificate_id)summary.append(el('p','提供者指定的证书指纹：'+model.expected_certificate_id),el('p',result.certificateMatch===true?'指定证书指纹一致。':result.certificateMatch===false?'指定证书指纹不一致。':'指定证书指纹未能核对。',result.certificateMatch===false?'error':'note'));
  const diagnosis=section('diagnosis','编辑过程检验单'),data=buildBehaviorReport(result.behavior,report.valid,true);
  const diagnostic=table(['项目','实测值','参考条件','检验结果'],data.evaluated.map(({row,state})=>[row.name,row.value==null?'—':number(row.value)+(row.unit?' '+row.unit:''),row.reference,state.text]));
  diagnostic.querySelectorAll('tbody tr').forEach((row,index)=>{if(data.evaluated[index].state.flag)row.classList.add('flag');});diagnosis.append(diagnostic);
  const stateNames:{[key:string]:string}={triggered:'↑ 需要复核',within_reference:'未触发提醒',insufficient:'条件不足',not_applicable:'不适用',unavailable:'未能评估'};
  diagnosis.append(table(['规则','结果'],Object.entries(names).map(([code,label])=>[label,stateNames[result.behavior?.rule_results?.find(rule=>rule.code===code)?.status||'']||'未提供'])));
  const axes=behaviorAxes(result.behavior,data.full),overview=el('div');overview.append(el('h3','编辑过程图形概览'),el('p','1 倍为参考阈值，2 倍及以上显示在外圈。这些数值不是原创比例。','note'));
  if(axes.every(axis=>axis.value!==null)){
    const element=el('div',undefined,'chart');overview.append(element);diagnosis.append(overview);
    const radar=init(element,null,{renderer:'canvas'});radar.setOption({animation:false,color:['#0f6cbd'],radar:{indicator:axes.map(axis=>({name:axis.label,max:2}))},series:[{type:'radar',areaStyle:{opacity:.15},data:[{value:axes.map(axis=>Math.max(0,Math.min(2,axis.value!)))}]}]});new ResizeObserver(()=>radar.resize()).observe(element);
  }else{overview.append(el('p','部分指标信息不足，不绘制完整多边形。','note'));diagnosis.append(overview);}
  for(const axis of axes){const row=el('div'),label=el('p',axis.label+'：'+(axis.value===null?'信息不足':axis.value===Infinity?'超过 2 倍':number(axis.value)+' 倍阈值'));if(axis.status==='triggered')label.classList.add('error');row.append(label);if(axis.value!==null){const range=el('progress') as HTMLProgressElement;range.max=2;range.value=Math.min(2,Math.max(0,axis.value));range.setAttribute('aria-label',axis.label);row.append(range);}overview.append(row);}
  if(result.behavior?.signals_truncated)diagnosis.append(el('p','引擎对提醒时段做了数量限制；报告保留全部已返回的提醒和证书提供的原始记录。','note'));
  diagnosis.append(details('全部提醒、测量值、阈值与规则版本',result.behavior??{status:'unavailable'}));
  const graphSection=section('charts','全部统计图'),grid=el('div',undefined,'chart-grid');graphSection.append(el('p','十种图表使用与核验页面相同的数据汇总。散点图最多绘制 500 个代表点，完整原始记录仍包含在报告中。','note'),grid);
  const partial=report.scope==='selective',structured=records.some(({event})=>event.metrics?.vertices!==undefined||event.metrics?.layers!==undefined),chartData=report.valid?summarize(records):null;
  for(const [id,label,description] of charts){
    const card=el('div',undefined,'chart-card');card.append(el('h3',label),el('p',description,'note'));grid.append(card);
    const unavailable=!report.valid?'核验未通过，不能作为可信过程统计展示。':partial&&!categoryCharts.includes(id)?'仅披露部分记录，不计算全程时间统计。':structured&&!['activity','donut','tree','heatmap'].includes(id)?'当前宿主记录不适用这项文字编辑统计。':!records.length?'没有记录。':id==='box'&&!chartData!.quantiles.length?'写入间隔样本不足。':(['scatter','histogram'].includes(id)&&!chartData!.writes.length)?'没有新增字符的事件。':null;
    if(unavailable){card.append(el('p',unavailable,'note'));continue;}
    const canvas=el('div',undefined,'chart');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);card.append(canvas);
    const chart=init(canvas,null,{renderer:'canvas'});chart.setOption(chartOption(id,chartData!,false,true));new ResizeObserver(()=>chart.resize()).observe(canvas);
    card.append(details('图表汇总数据',chartTable(id,chartData!)));
  }
  const events=section('records',report.valid?'已核验的原始记录':'未通过核验的原始输入记录');events.append(el('p',`共 ${records.length.toLocaleString()} 条，全部包含在此文件中。为保证打开速度，每页显示 200 条。`));
  const pager=el('div',undefined,'pager'),label=el('span'),content=el('div');let page=0;
  const before=command('上一页',()=>{page--;paint();}),after=command('下一页',()=>{page++;paint();});pager.append(before,label,after);events.append(pager,content);
  function paint(){before.disabled=page===0;after.disabled=(page+1)*200>=records.length;label.textContent=`${page+1} / ${Math.max(1,Math.ceil(records.length/200))}`;content.replaceChildren(table(['序号','经过时间（毫秒）','动作','新增','删除','文档字符','记录哈希'],records.slice(page*200,(page+1)*200).map(({event,hash})=>[event.seq,event.elapsed_ms,event.kind,event.inserted,event.deleted,event.chars,hash])));content.append(details('本页完整事件字段（含指标和检查点）',records.slice(page*200,(page+1)*200)));}paint();
  if(report.valid&&proof.manifest.source==='word'){
    const observations=records.filter(({event})=>event.metrics?.word_revision_total!==undefined||event.metrics?.word_revision_tracking!==undefined),last=observations.at(-1);
    if(last){const word=section('word-revisions','Word 修订记录采样');word.append(el('p',`共 ${observations.length} 次可见采样，最后一次在 ${last.event.elapsed_ms} 毫秒。只表示采样时保留的修订标记。`),details('初次可见采样',observations[0]),details('最后采样',last));}
  }
  const metadata=section('metadata','文件属性与辅助检查'),meta=model.metadata as {status?:string;error?:string;skipped?:number;findings?:{field:string;value:string;location:string;explanation?:string;hint?:boolean}[]}|null;
  const metadataStates:{[key:string]:string}={not_run:'未执行',running:'尚未完成',done:'已完成',error:'未能完成'};
  metadata.append(el('p','文件属性检查：'+(metadataStates[meta?.status||'']||'未提供结果')));
  if(meta?.error)metadata.append(el('p',meta.error,'error'));
  if(meta?.findings?.length)metadata.append(table(['字段','读取值','所在位置','提示'],meta.findings.map(item=>[item.field,item.explanation||item.value,item.location,item.hint?'请核对来源':'文件中填写的信息'])));
  if(meta?.skipped)metadata.append(el('p',`${meta.skipped} 项属性因解析范围、大小或格式限制未检查。`,'note'));
  metadata.append(details('文件属性完整检查结果',model.metadata),details('生成时已显示的辅助检查内容',model.auxiliary_text||'没有其他辅助检查结果。'));
  const files=section('files','原始附件与完整数据'),actions=el('div',undefined,'actions');
  actions.append(command('下载原始证书',()=>download(model.certificate.name,fromBase64(model.certificate.base64),model.certificate.type)),command('下载未加密的完整数据 JSON',()=>download('WorkProof-report-data.json',JSON.stringify(model,null,2),'application/json')));
  files.append(el('p','原作品另附，未封装在此 HTML 中。下方附件下载后是未加密的原始文件。','note'));
  actions.append(command('打印当前展示内容',()=>window.print()));files.append(actions,el('p','完整数据包含全部已披露事件、签名、规则数据与已完成检查；未执行和未披露的内容不会补造。打印只包含当前页记录，完整数据请保留 HTML 或下载 JSON。','note'));
  const notices=(window as unknown as {WORKPROOF_REPORT_NOTICES?:string}).WORKPROOF_REPORT_NOTICES;if(notices)root.append(details('开源组件许可',notices));
}
(window as unknown as {workproofRenderReport:typeof render}).workproofRenderReport=render;
