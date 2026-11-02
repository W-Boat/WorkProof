'use client';
import {useMemo} from 'react';
import {Background,Controls,Position,ReactFlow,type Edge,type Node} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export type StructureNode={id:number;parent:number|null;order:number;kind:string;relation:string};
const labels:Record<string,string>={object:'对象',group:'组',mesh:'网格',layer:'图层',modifier:'修改器'};
// A visible slice remains connected to its ancestors. Never invent or reconnect hidden edges.
export default function EvolutionGraph({rows}:{rows:{node:StructureNode;depth:number}[]}){
  const {nodes,edges}=useMemo(()=>{
    const visible=rows.slice(0,200),ids=new Set(visible.map(row=>row.node.id));
    const nodes:Node[]=visible.map(({node,depth},i)=>({id:String(node.id),position:{x:depth*230,y:i*76},
      data:{label:<><strong>{labels[node.kind]} #{node.id}</strong><small>{node.parent===null?'顶层':`属于 #${node.parent}`} · 顺序 {node.order+1}</small></>},
      ariaLabel:`${labels[node.kind]} ${node.id}，${node.parent===null?'顶层':`属于 ${node.parent}`}，顺序 ${node.order+1}`,
      sourcePosition:Position.Right,targetPosition:Position.Left,draggable:false,connectable:false,deletable:false}));
    const edges:Edge[]=visible.filter(({node})=>node.parent!==null&&ids.has(node.parent)).map(({node})=>({id:`${node.parent}-${node.id}`,source:String(node.parent),target:String(node.id),
      type:'smoothstep',ariaLabel:`${node.parent} 到 ${node.id}`,deletable:false,focusable:false,
      style:{stroke:'var(--ink-soft)',strokeWidth:1.5,strokeDasharray:node.relation==='modifies'?'5 4':undefined}}));
    return {nodes,edges};
  },[rows]);
  return <>
    <p className="caption">拖动画布浏览，用左下角按钮缩放。实线表示包含关系，虚线表示修改器所属关系。{rows.length>200?'当前画布显示前 200 个节点；下方列表可逐页浏览全部节点。':''}</p>
    <div className="evolution-graph" aria-label="已核验的结构关系图">
      <ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
        defaultViewport={{x:24,y:24,zoom:1}} minZoom={0.03} maxZoom={2} onlyRenderVisibleElements
        zoomOnScroll={false} zoomOnDoubleClick={false} preventScrolling={false} aria-label="结构画布"
        ariaLabelConfig={{'controls.ariaLabel':'关系图缩放','controls.zoomIn.ariaLabel':'放大关系图','controls.zoomOut.ariaLabel':'缩小关系图','controls.fitView.ariaLabel':'显示整张关系图',
          'node.a11yDescription.default':'按回车或空格选择节点，按 Esc 取消选择。节点与连线不能修改。',
          'node.a11yDescription.keyboardDisabled':'节点与连线不能修改。可在下方列表中逐项阅读。',
          'edge.a11yDescription.default':'已核验的结构关系，不能修改。','handle.ariaLabel':'关系连接点'}}>
        <Background gap={24} color="var(--line)"/>
        <Controls showInteractive={false} aria-label="关系图缩放"/>
      </ReactFlow>
    </div>
  </>;
}
