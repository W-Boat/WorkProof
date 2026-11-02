// SPDX-License-Identifier: MIT
// Host-independent controller; descriptors, layer names, paths and pixels never enter events.
const MAX_QUEUE=2048;
const EVENTS=['make','delete','move','mergeLayersNew','mergeVisible','set','paint','undoEvent','select','save','open','close'];
const MAP={make:'layer',delete:'layer',move:'layer',mergeLayersNew:'layer',mergeVisible:'layer',set:'edit',paint:'edit',undoEvent:'undo',save:'save'};
const topology=s=>JSON.stringify(s.topology??null);
const NODE_FIELDS=['id','parent','order','kind','relation'];
// JSON object key order is not semantic; Rust's Value map may reorder the fields.
const sameGraphNodes=(received,expected)=>Array.isArray(received)&&received.length===expected.length&&received.every((node,i)=>
  node&&typeof node==='object'&&!Array.isArray(node)&&Object.keys(node).length===NODE_FIELDS.length&&NODE_FIELDS.every(key=>Object.prototype.hasOwnProperty.call(node,key)&&node[key]===expected[i][key]));
const same=(a,b)=>a.id===b.id&&a.history===b.history&&JSON.stringify(a.metrics)===JSON.stringify(b.metrics)&&topology(a)===topology(b);
class Recorder {
  constructor({host,request,hash,evolution=false,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),changed=()=>{}}){
    Object.assign(this,{host,request,hash,now,sleep,changed});
    this.token='';this.session='';this.pending=[];this.next=0;this.committed=0;this.paused=true;this.busy=false;this.sampling=false;
    this.signals=new Set();this.revision=0;this.elapsed=0;this.error='';this.message='连接后仅在主动开始时记录当前文档。';
    this.notify=this.notify.bind(this);this.stopped=false;this.pauseAfterBusy=false;
    this.evolution=evolution;this.resetGraphs();
  }
  resetGraphs(){this.graphs=[];this.graphPending=new WeakMap();this.identities=new Map();this.nextIdentity=1;this.graphCount=0;this.graphNodes=0;this.graphBytes=64;this.lastGraphNodes=null;}
  graphNodesFor(snapshot){
    if(!Array.isArray(snapshot.topology)||snapshot.topology.length>10000)throw Error('结构补充最多支持 10000 个节点。');
    const active=new Map();
    for(const row of snapshot.topology){let id=this.identities.get(row[0]);if(id===undefined)id=this.nextIdentity++;active.set(row[0],id);}
    const groups=new Set(snapshot.groupIds||[]);
    const nodes=snapshot.topology.map(([id,parent,order])=>({id:active.get(id),parent:parent===null?null:active.get(parent),order,kind:groups.has(id)?'group':'layer',relation:parent===null?'root':'contains'}));
    const parents=new Map(nodes.map(node=>[node.id,node.parent]));
    const resolved=new Map();
    for(const node of nodes){
      let current=node.id,depth=0;const chain=[],seen=new Set();
      while(current!==null){
        if(resolved.has(current)){depth=resolved.get(current);break;}
        if(!parents.has(current)||seen.has(current)||chain.length>=256)throw Error('结构关系无效或超过 256 层。');
        seen.add(current);chain.push(current);current=parents.get(current);
      }
      for(let i=chain.length-1;i>=0;i--){if(++depth>256)throw Error('结构关系无效或超过 256 层。');resolved.set(chain[i],depth);}
    }
    this.identities=active;return nodes;
  }
  view(){return {recording:!!this.session,paused:this.paused,busy:this.busy,committed:this.committed,queued:this.pending.length,message:this.error||this.message};}
  paint(){this.changed(this.view());}
  async finishBusy(){
    this.busy=false;this.paint();
    if(this.pauseAfterBusy&&this.session&&!this.paused&&!this.stopped){this.pauseAfterBusy=false;await this.pause();}
  }
  async api(path,body,authenticated=true){return this.request(path,body,authenticated?this.token:'');}
  async connect(){
    if(this.token)return;
    const ticket=await this.api('/v1/native-pairing',{source:'photoshop'},false);
    this.message='请在 WorkProof 桌面窗口允许 Photoshop 本机插件的连接请求。';this.paint();
    for(let i=0;i<100;i++){
      await this.sleep(1000);
      if(this.stopped)throw new Error('插件已停止连接。');
      const grant=await this.api('/v1/native-pairing/'+ticket.ticket,undefined,false);
      if(grant.approved){this.token=grant.token;return;}
    }
    throw new Error('连接请求已过期，请重新开始。');
  }
  check(snapshot){
    if(snapshot.id!==this.documentId){this.paused=true;throw new Error('活动文档已改变，请停止后为新文档重新开始记录。');}
  }
  event(kind,snapshot,checkpoint=''){
    if(this.pending.length>=MAX_QUEUE){this.paused=true;throw new Error('离线队列已满，记录已暂停。恢复连接后继续。');}
    this.elapsed=Math.max(this.elapsed,Math.max(0,Math.floor(this.now()-this.started)));
    if(!checkpoint&&snapshot.topology&&['start','layer','resume'].includes(kind)){
      // This fixed-format numeric/ASCII snapshot remains in memory. Only its
      // BLAKE3 commitment enters the existing signed checkpoint field.
      const text=topology(snapshot);checkpoint=this.hash(Uint8Array.from(text,char=>char.charCodeAt(0)));
    }
    let nodes,nodeText,graphBytes=0;
    if(this.evolution&&['start','layer','resume'].includes(kind)){
      const candidate=this.graphNodesFor(snapshot);nodeText=JSON.stringify(candidate);
      // Visibility and raw kind changes still receive the original topology digest.
      // Only changed anonymous relationships consume a layer snapshot reservation.
      if(kind!=='layer'||nodeText!==this.lastGraphNodes){
        nodes=candidate;graphBytes=nodeText.length+512;
        if(this.graphCount>=128||this.graphNodes+nodes.length>50000||this.graphBytes+graphBytes>8*1024*1024){this.paused=true;throw Error('结构补充已达容量上限，请导出已有记录后重新开始。');}
      }
    }
    const event={seq:this.next++,elapsed_ms:this.elapsed,kind,inserted:0,deleted:0,chars:0,checkpoint,metrics:{...snapshot.metrics}};
    if(nodes)this.graphPending.set(event,{nodes});
    this.pending.push(event);
    if(nodes){this.graphCount++;this.graphNodes+=nodes.length;this.graphBytes+=graphBytes;this.lastGraphNodes=nodeText;}
    this.paint();
  }
  async flush(){
    if(this.delivering)return this.delivering;
    this.delivering=(async()=>{
      while(this.pending.length){
        const batch=this.pending.slice(0,this.evolution?1:128);
        const graph=this.graphPending.get(batch[0]);
        if(graph&&!graph.prepared){
          const prepared=await this.api('/v1/sessions/'+this.session+'/evolution-checkpoint',{seq:batch[0].seq,event_kind:batch[0].kind,nodes:graph.nodes});
          if(prepared.snapshot?.format!=='workproof-evolution/1'||prepared.snapshot.session_id!==this.session||prepared.snapshot.source!=='photoshop'||prepared.snapshot.seq!==batch[0].seq||prepared.snapshot.event_kind!==batch[0].kind||!sameGraphNodes(prepared.snapshot.nodes,graph.nodes)||!/^[a-f0-9]{64}$/.test(prepared.checkpoint))throw Error('本机引擎返回的结构绑定不一致。');
          graph.prepared=prepared;batch[0].checkpoint=prepared.checkpoint;
        }
        const result=await this.api('/v1/sessions/'+this.session+'/events',{events:batch});
        if(!Number.isSafeInteger(result.next_seq)||result.next_seq<batch[batch.length-1].seq+1)throw new Error('本机引擎未确认事件落盘。');
        if(graph)this.graphs.push(graph.prepared.snapshot);
        this.pending.splice(0,batch.length);this.committed+=batch.length;this.paint();
      }
    })();
    try{await this.delivering;}finally{this.delivering=null;}
  }
  async start(){
    if(this.busy||this.session)throw new Error('请先停止当前记录。');
    this.stopped=false;this.pauseAfterBusy=false;this.busy=true;this.error='';this.paint();
    try{
      const first=this.host.snapshot();
      this.artifact=await this.host.chooseArtifact();
      if(!this.artifact){this.message='已取消，尚未开始记录。';return;}
      await this.connect();
      const current=this.host.snapshot();
      if(first.id!==current.id)throw new Error('连接期间活动文档已改变，请重新开始。');
      this.documentId=current.id;
      await this.host.listen(EVENTS,this.notify);this.listening=true;
      const result=await this.api('/v1/sessions',{source:'photoshop',file_name:this.artifact.name,started_at:new Date().toISOString()});
      if(this.stopped)throw new Error('插件已关闭，本次记录未启动。');
      this.session=result.session_id;this.started=this.now();this.lastSample=this.started;this.next=0;this.committed=0;this.pending=[];this.elapsed=0;
      this.resetGraphs();this.previous=current;this.signals.clear();this.paused=false;
      this.event('start',current);await this.flush();this.message='记录中。每秒合并动作信号，记录图层统计和结构摘要，不保存图像或图层名称。';
    }catch(error){
      this.paused=true;
      if(this.listening&&!this.session){await this.host.unlisten(EVENTS,this.notify).catch(()=>{});this.listening=false;}
      throw error;
    }finally{await this.finishBusy();}
  }
  notify(name,descriptor){
    if(!this.session||this.paused)return;
    let id;try{id=this.host.activeId();}catch{this.paused=true;this.error='宿主暂时无法读取活动文档，请稍后继续。';this.paint();return;}
    if(id!==this.documentId){this.paused=true;this.error='活动文档已改变，请停止后重新开始记录。';this.paint();return;}
    // Read only a numerical routing hint, never retain or serialize the descriptor.
    if(Number.isFinite(descriptor?.documentID)&&descriptor.documentID!==this.documentId)return;
    this.revision++;
    if(!this.busy&&MAP[name])this.signals.add(MAP[name]);
  }
  async sample(force=false){
    if(!this.session||this.paused||this.sampling||(this.busy&&!force))return;
    this.sampling=true;
    try{
      if(!force&&this.host.marker&&!this.signals.size&&this.now()-this.lastSample<=15000){
        const marker=this.host.marker();this.check(marker);
        if(marker.history===this.previous.history){this.lastSample=this.now();await this.flush();return;}
      }
      const current=this.host.snapshot();this.check(current);
      if(this.now()-this.lastSample>15000)this.event('gap',current);
      this.lastSample=this.now();
      const structureChanged=topology(this.previous)!==topology(current);
      if(this.signals.size){if(structureChanged)this.signals.add('layer');for(const kind of this.signals)this.event(kind,current);this.signals.clear();}
      else if(!same(this.previous,current))this.event(structureChanged||JSON.stringify(current.metrics)!==JSON.stringify(this.previous.metrics)?'layer':'edit',current);
      this.previous=current;await this.flush();
    }catch(error){this.paused=true;throw error;}finally{this.sampling=false;this.paint();}
  }
  async pause(){
    if(!this.session||this.busy)return;
    if(this.paused)this.pauseAfterBusy=false;
    this.busy=true;this.paint();
    try{
      while(this.sampling)await this.sleep(20);
      if(this.paused){
        const current=this.host.snapshot();this.check(current);await this.flush();
        this.event('gap',current);this.event('resume',current);this.previous=current;this.lastSample=this.now();this.signals.clear();this.paused=false;
      }else{await this.sample(true);this.event('pause',this.previous);this.paused=true;}
      await this.flush();this.message=this.paused?'已暂停；继续时会记录采集缺口。':'记录中。';this.error='';
    }catch(error){this.paused=true;throw error;}finally{await this.finishBusy();}
  }
  async export(){
    if(this.busy)throw new Error('请等待当前操作完成，再导出。');
    if(!this.session)throw new Error('请先开始记录。');
    this.busy=true;this.error='';this.paint();
    try{
      while(this.sampling)await this.sleep(20);
      await this.sample(true);
      const proofFile=await this.host.chooseProof(this.artifact.name+'.wproof');
      if(!proofFile){this.message=this.paused?'已取消证书导出，记录仍处于暂停状态。':'已取消证书导出，继续记录。';return;}
      const graphFile=this.evolution?await this.host.chooseGraph(this.artifact.name+'.wgraph'):null;
      if(this.evolution&&!graphFile){this.message='已取消结构文件保存，未写入本次证书。';return;}
      await this.flush();
      if(this.stopped)throw new Error('记录已停止或插件已关闭，请重新开始。');
      const before=this.host.snapshot();this.check(before);const revision=this.revision;
      await this.host.saveCopy(this.artifact,this.documentId);
      if(this.stopped)throw new Error('插件已关闭，未写入证书。');
      const {bytes,stamp}=await this.host.readArtifact(this.artifact);
      const after=this.host.snapshot();this.check(after);
      if(!same(before,after)||revision!==this.revision)throw new Error('导出期间文档发生变化，请停止编辑后重试。');
      const digest=this.hash(bytes);
      if(this.now()-this.lastSample>15000)this.event('gap',after);
      this.lastSample=this.now();this.event('save',after,digest);await this.flush();
      const proof=await this.api('/v1/sessions/'+this.session+'/export',{artifact_hash:digest,artifact_bytes:bytes.length});
      const m=proof.manifest;
      if(m?.protocol!=='workproof/3'||m.source!=='photoshop'||m.session_id!==this.session||m.file_name!==this.artifact.name||m.artifact_hash!==digest||m.artifact_bytes!==bytes.length||m.event_count!==this.next)throw new Error('引擎返回的交付绑定不一致，未写入证书。');
      const latest=this.host.snapshot();this.check(latest);
      if(!same(after,latest)||revision!==this.revision)throw new Error('签发期间文档发生变化，请重试。');
      if(this.stopped)throw new Error('插件已关闭，未写入证书。');
      await this.host.assertArtifactUnchanged(this.artifact,stamp);
      await this.host.writeProof(proofFile,proof);
      if(graphFile)await this.host.writeProof(graphFile,{format:'workproof-evolution/1',snapshots:this.graphs});
      await this.host.assertArtifactUnchanged(this.artifact,stamp);
      this.message=graphFile?'PSD 副本、.wproof 与 .wgraph 已保存到所选位置。请一并交付这三份文件。':'PSD 副本和 .wproof 已写入你选择的位置。请交付这份副本。';
    }finally{await this.finishBusy();}
  }
  async stop(){
    if(this.busy)throw new Error('请等待当前操作完成，再停止记录。');
    this.stopped=true;
    this.busy=true;this.paint();
    try{
      while(this.sampling)await this.sleep(20);
      if(this.session){
        try{if(!this.paused)await this.sample(true);await this.flush();}
        catch(error){this.paused=true;throw new Error('仍有未提交事件，请恢复连接后重试停止：'+error.message);}
      }
      if(this.listening){await this.host.unlisten(EVENTS,this.notify);this.listening=false;}
      this.session='';this.token='';this.paused=true;this.signals.clear();this.pending=[];this.message='已停止，本次证书需在停止前完成导出。';
    }finally{await this.finishBusy();}
  }
  async hidden(){
    if(this.busy){this.pauseAfterBusy=true;return;}
    if(this.session&&!this.paused&&!this.busy)await this.pause();
  }
  async dispose(){
    this.stopped=true;this.paused=true;this.pauseAfterBusy=false;
    if(this.listening){await this.host.unlisten(EVENTS,this.notify).catch(()=>{});this.listening=false;}
  }
}
module.exports={Recorder,EVENTS,MAX_QUEUE};
