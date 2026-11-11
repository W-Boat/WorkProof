'use client';
import {Component,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {Panel,Tag,Details,Select} from './institution-ui';
import {Upload} from './FileDrop';
import {Button} from './button';

type Node={id:number;parent:number|null;order:number;kind:string;relation:string};
type Snapshot={seq:number;source:string;event_kind:string;nodes:Node[]};
type Report={protocol:string;valid:boolean;certificate_valid:boolean;artifact_checked:boolean;complete_history_verified:boolean;identity_verified:boolean;completeness:string;snapshots:Snapshot[];errors:string[]};
const labels:Record<string,string>={object:'对象',group:'组',mesh:'网格',layer:'图层',modifier:'修改器'};
const PAGE_SIZE=100;
const EvolutionGraph=dynamic(()=>import('./EvolutionGraph'),{ssr:false,loading:()=><p role="status">正在加载关系图…</p>});
class GraphBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<p role="alert">关系图暂时无法显示。你仍可用下方列表查看已核验的结构。</p>:this.props.children;}
}
function ordered(nodes:Node[]){
  const children=new Map<number|null,Node[]>();
  for(const node of nodes){const group=children.get(node.parent)||[];group.push(node);children.set(node.parent,group);}
  for(const group of children.values())group.sort((a,b)=>a.relation.localeCompare(b.relation)||a.order-b.order||a.id-b.id);
  const stack=(children.get(null)||[]).map(node=>({node,depth:0})).reverse(),rows:typeof stack=[];
  while(stack.length){const row=stack.pop()!;rows.push(row);for(const node of [...(children.get(row.node.id)||[])].reverse())stack.push({node,depth:row.depth+1});}
  return rows;
}

// Mounted only after artifact + certificate verification. This separate worker never reads the artifact.
export function EvolutionPanel({proof}:{proof:File}){
  const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [report,setReport]=useState<Report|null>(null),[index,setIndex]=useState(0),[page,setPage]=useState(0);
  const [showGraph,setShowGraph]=useState(false);
  const active=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  function stop(){active.current?.terminate();active.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;}
  useEffect(()=>()=>stop(),[]);
  const snapshot=report?.snapshots[index];
  const rows=useMemo(()=>snapshot?ordered(snapshot.nodes):[],[snapshot]);
  function reset(){stop();setBusy(false);setReport(null);setMessage('');setIndex(0);setPage(0);setShowGraph(false);}
  function check(){
    if(!file||busy)return;reset();
    if(file.size>8*1024*1024||!file.size){setMessage('结构文件不能为空，且不能超过 8 MB。');return;}
    const worker=new Worker('/verify-worker.js',{type:'module'});active.current=worker;setBusy(true);
    function finish(text:string){if(active.current!==worker)return;stop();setBusy(false);setMessage(text);}
    worker.onmessage=({data})=>{
      if(active.current!==worker||data.type==='progress')return;
      if(data.type!=='evolution'){finish('未能完成检查，请确认结构文件与这份证书配套。');return;}
      const result=data.report as Report;
      if(!result||result.protocol!=='workproof-evolution/1'||!result.valid||!result.certificate_valid||result.artifact_checked!==false||result.complete_history_verified!==false||result.identity_verified!==false||result.completeness!=='disclosed_snapshots_only'||!Array.isArray(result.snapshots)||!result.snapshots.length||result.snapshots.length>128||!Array.isArray(result.errors)||result.errors.length){
        finish(result?.errors?.includes('EVOLUTION_EVENT_NOT_DISCLOSED')?'这份证书没有公开结构文件对应的记录。请向提供者索取配套的结构文件，或包含这些记录的证书。':'结构与证书中的记录不匹配，或文件格式不受支持。请向提供者核对配套文件。');return;
      }
      finish('');setReport(result);
    };
    worker.onerror=()=>finish('无法加载结构核验工具，请重新载入完整站点。');
    worker.onmessageerror=()=>finish('无法读取核验结果，请重新检查。');
    timer.current=setTimeout(()=>finish('检查耗时过长，已停止。可以重新检查。'),60_000);
    try{worker.postMessage({action:'evolution',proof,supplement:file});}catch{finish('无法读取文件，请重新选择。');}
  }
  return <Panel title="查看结构变化（可选）" className="evolution-panel">
    <Details label="收到 .wgraph 结构文件？查看对象和图层怎样变化">
      <p>部分录制工具可另行导出结构文件。它保留对象编号、层级和顺序，便于浏览几次保存的结构，不展示对象名称或作品内容。</p>
      <Upload label="选择 .wgraph 结构文件" caption="与当前证书配套，最多 8 MB" accept=".wgraph,application/json" file={file} disabled={busy} onFile={next=>{reset();setFile(next);}}/>
      <div className="share-actions"><Button disabled={!file||busy} onClick={check}>{busy?'正在核验结构…':'核验并查看结构'}</Button>{busy&&<Button variant="ghost" onClick={()=>{reset();setMessage('已取消结构核验。');}}>取消</Button>}</div>
      {message&&<p role="status">{message}</p>}
      {report&&snapshot&&<div className="evolution-result">
        <Tag tone="ok">结构与证书中的记录一致</Tag>
        <p>已核对 {report.snapshots.length} 份结构。这里仅展示文件中提供、且能在证书中核对的结构，不表示每一步操作都已记录。</p>
        <div className="quiet-label">{/* The selector operates on already verified snapshots. */}<Select label="选择结构记录" value={String(index)} onChange={value=>{setIndex(Number(value));setPage(0);}} options={report.snapshots.map((item,i)=>({value:String(i),label:`第 ${i+1} 份 · 事件 ${item.seq+1} · ${item.nodes.length} 个节点`}))}/></div>
        <p>来源：{snapshot.source} · 对象编号仅在本次记录中用于识别同一节点。</p>
        {!!rows.length&&<Button aria-expanded={showGraph} onClick={()=>setShowGraph(!showGraph)}>{showGraph?'收起关系图':'打开关系图'}</Button>}
        {showGraph&&<GraphBoundary key={snapshot.seq}><EvolutionGraph rows={rows}/></GraphBoundary>}
        <ol className="evolution-nodes" aria-label="已核验的对象层级">{rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(({node,depth})=><li key={node.id} style={{paddingInlineStart:`${Math.min(depth,12)*12+12}px`}}><strong>{labels[node.kind]||node.kind} #{node.id}</strong><span>{node.parent===null?'顶层':`属于 #${node.parent}`} · {node.relation==='modifies'?'修改器顺序':'同层顺序'} {node.order+1}{depth>12?` · 层级 ${depth+1}`:''}</span></li>)}</ol>
        {!rows.length&&<p>这次结构记录中没有对象。</p>}
        {rows.length>PAGE_SIZE&&<div className="share-actions"><Button disabled={!page} onClick={()=>setPage(page-1)}>上一页</Button><span role="status">第 {page+1} / {Math.ceil(rows.length/PAGE_SIZE)} 页 · 共 {rows.length} 个节点</span><Button disabled={(page+1)*PAGE_SIZE>=rows.length} onClick={()=>setPage(page+1)}>下一页</Button></div>}
      </div>}
    </Details>
  </Panel>;
}
