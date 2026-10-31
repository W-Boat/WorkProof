// CI host simulations, not a licensed Photoshop runtime test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Recorder,EVENTS}=require('../apps/photoshop/src/controller.cjs');
const {createHost}=require('../apps/photoshop/src/host.cjs');
function fixture(){
  const state={id:7,history:1,metrics:{layers:3,groups:1,visible_layers:2},clock:1000,cancelArtifact:false,cancelProof:false,saveCalls:0,writes:[],requests:[],offline:false,lostAck:false,changedOnSave:false};
  const events=new Map();
  const artifact={name:'delivery.psd'};
  const host={
    snapshot:()=>({id:state.id,history:state.history,metrics:{...state.metrics}}),activeId:()=>state.id,
    async chooseArtifact(){return state.cancelArtifact?null:artifact;},async chooseProof(){return state.cancelProof?null:{name:'delivery.psd.wproof'};},
    async listen(names,listener){state.listener=listener;state.names=names;},async unlisten(names,listener){assert.equal(listener,state.listener);state.listener=null;},
    async saveCopy(){state.saveCalls++;if(state.changedOnSave)state.history++;},
    async readArtifact(){return {bytes:new Uint8Array([56,66,80,83,0,1,0,0]),stamp:'stable'};},
    async assertArtifactUnchanged(){},async writeProof(entry,proof){state.writes.push(proof);},
  };
  const recorder=new Recorder({host,hash:()=> 'ab'.repeat(32),now:()=>state.clock,sleep:async()=>{},request:async(path,body,token)=>{
    state.requests.push({path,body,token});
    if(state.offline)throw Error('offline');
    if(path==='/v1/native-pairing')return {ticket:'fixture-ticket'};
    if(path.startsWith('/v1/native-pairing/'))return {approved:true,token:'scoped-token'};
    if(path==='/v1/sessions')return {session_id:'fixture-session'};
    if(path.endsWith('/events')){
      if(state.holdEvents)await state.holdEvents;
      for(const event of body.events){if(events.has(event.seq))assert.deepEqual(events.get(event.seq),event);else events.set(event.seq,event);}
      if(state.lostAck){state.lostAck=false;throw Error('acknowledgement lost');}
      return {next_seq:events.size};
    }
    if(path.endsWith('/export')){
      if(state.duringExport)state.duringExport();
      return {manifest:{protocol:'workproof/3',source:'photoshop',session_id:'fixture-session',file_name:artifact.name,artifact_hash:body.artifact_hash,artifact_bytes:body.artifact_bytes,event_count:events.size},records:[...events.values()]};
    }
    throw Error('unexpected route');
  }});
  return {state,recorder,events,host};
}
test('production event subset, private descriptors and explicit file binding',async()=>{
  const {recorder:r,state,events}=fixture();await r.start();
  assert.equal(state.names.includes('all'),false);assert.equal(state.names,EVENTS);
  for(let i=0;i<500;i++)state.listener('paint',{documentID:7,privateText:'DO NOT TRANSMIT',name:'private layer name'});
  state.history++;state.clock+=1000;await r.sample();
  assert.deepEqual([...events.values()].map(e=>e.kind),['start','edit']);
  await r.export();assert.equal(state.saveCalls,1);assert.equal(state.writes.length,1);
  const text=JSON.stringify(state.requests);assert(!text.includes('DO NOT TRANSMIT'));assert(!text.includes('private layer name'));assert(!text.includes('history'));
  assert.equal([...events.values()].at(-1).kind,'save');assert.equal([...events.values()].at(-1).checkpoint,'ab'.repeat(32));
  await r.stop();assert.equal(state.listener,null);
});
test('cancelled selections do not connect or overwrite a delivery',async()=>{
  const first=fixture();first.state.cancelArtifact=true;await first.recorder.start();assert.equal(first.state.requests.length,0);
  const second=fixture();await second.recorder.start();second.state.cancelProof=true;await second.recorder.export();
  assert.equal(second.state.saveCalls,0);assert.equal(second.state.writes.length,0);
});
test('document switch while paused cannot contaminate an existing session',async()=>{
  const {recorder:r,state}=fixture();await r.start();await r.pause();state.id=9;
  await assert.rejects(()=>r.pause(),/活动文档已改变/);assert.equal(r.paused,true);assert.equal(state.writes.length,0);
  await r.stop();assert.equal(r.session,'');
});
test('panel hiding pauses and resume discloses the observation gap',async()=>{
  const {recorder:r,state,events}=fixture();await r.start();await r.hidden();
  state.history++;state.clock+=30000;await r.sample();assert.equal(events.size,2);
  await r.pause();assert.deepEqual([...events.values()].map(e=>e.kind),['start','pause','gap','resume']);
  assert.equal(r.paused,false);
});
test('lost acknowledgement retries the same durable event without changing sequence',async()=>{
  const {recorder:r,state,events}=fixture();state.lostAck=true;
  await assert.rejects(()=>r.start(),/acknowledgement lost/);assert.equal(r.pending.length,1);assert.equal(events.size,1);
  await r.pause();assert.equal(events.size,3);assert.equal(r.pending.length,0);assert.equal(r.committed,3);
});
for(const phase of ['save','issue'])test(`concurrent editing during ${phase} refuses certificate delivery`,async()=>{
  const {recorder:r,state}=fixture();await r.start();
  if(phase==='save')state.changedOnSave=true;else state.duringExport=()=>state.listener('paint',{documentID:7});
  await assert.rejects(()=>r.export(),/文档发生变化/);assert.equal(state.writes.length,0);
});
test('long unattended interval is declared rather than presented as continuous work',async()=>{
  const {recorder:r,state,events}=fixture();await r.start();state.clock+=20000;state.history++;await r.sample();
  assert.deepEqual([...events.values()].map(e=>e.kind),['start','gap','edit']);
});
test('idle samples use only cheap identity/history markers, without full traversal or network writes',async()=>{
  const {recorder:r,state,host}=fixture();await r.start();const sent=state.requests.length;
  host.marker=()=>({id:state.id,history:state.history});host.snapshot=()=>{throw Error('Idle traversal is forbidden');};
  for(let i=0;i<100;i++){state.clock+=1000;await r.sample();}
  assert.equal(state.requests.length,sent);assert.equal(r.paused,false);
});
test('pause/export clicks are serialized while an acknowledgement is pending',async()=>{
  const {recorder:r,state,events}=fixture();await r.start();
  let release;state.holdEvents=new Promise(resolve=>{release=resolve;});
  const pausing=r.pause();await new Promise(resolve=>setImmediate(resolve));assert.equal(r.busy,true);
  await r.pause();await assert.rejects(()=>r.export(),/请先开始或继续记录/);
  await assert.rejects(()=>r.stop(),/等待当前操作完成/);assert.equal(r.stopped,false);
  release();await pausing;assert.equal(r.paused,true);assert.deepEqual([...events.values()].map(e=>e.kind),['start','pause']);
});
test('hiding a panel during start pauses after the outstanding operation settles',async()=>{
  const {recorder:r,state,events}=fixture();let release;state.holdEvents=new Promise(resolve=>{release=resolve;});
  const starting=r.start();await new Promise(resolve=>setImmediate(resolve));assert.equal(r.busy,true);
  await r.hidden();release();await starting;
  assert.equal(r.paused,true);assert.deepEqual([...events.values()].map(e=>e.kind),['start','pause']);
});
function nativeFixture(){
  const neverRead=()=>{throw Error('Private host content must not be read');};
  const child={kind:1,visible:true,get name(){return neverRead();}};
  const doc={id:17,title:'design.psd',path:'C:/private/source.psd',cloudDocument:false,activeHistoryState:{id:99,get name(){return neverRead();}},
    layers:[{kind:7,visible:false,layers:[child]},{kind:1,visible:true,get name(){return neverRead();}}]};
  const entry={name:'delivery.psd',nativePath:'C:/delivery/delivery.psd',async getMetadata(){return {size:8,dateModified:new Date(1000)};},async read(){return new Uint8Array([1,2,3,4,5,6,7,8]).buffer;}};
  const calls=[];
  doc.saveAs={psd:async(...args)=>calls.push(args)};
  const ps={app:{activeDocument:doc},constants:{LayerKind:{GROUP:7}},core:{executeAsModal:async(fn,options)=>{calls.push(options);await fn({isCancelled:false});}},action:{addNotificationListener:async()=>{},removeNotificationListener:async()=>{}}};
  const storage={formats:{binary:'binary',utf8:'utf8'},localFileSystem:{getFileForSaving:async()=>entry}};
  return {host:createHost(ps,storage),doc,entry,calls};
}
test('native API adapter counts nested visibility and excludes names',()=>{
  const {host}=nativeFixture();assert.deepEqual(host.snapshot(),{id:17,history:99,metrics:{layers:3,groups:1,visible_layers:1}});
});
test('native API adapter saves as copy in modal scope and refuses source overwrite',async()=>{
  const {host,entry,calls}=nativeFixture();await host.saveCopy(entry,17);
  assert.equal(calls[0].commandName,'WorkProof：保存交付副本');assert.equal(calls[1][2],true);
  entry.nativePath='C:\\PRIVATE\\source.psd';await assert.rejects(()=>host.saveCopy(entry,17),/原文档/);
  await assert.rejects(()=>host.saveCopy(entry,999),/当前文档已改变/);
});
test('native API adapter rejects empty/oversized or changing file data',async()=>{
  const {host,entry}=nativeFixture();assert.equal((await host.readArtifact(entry)).bytes.length,8);
  entry.getMetadata=async()=>({size:0});await assert.rejects(()=>host.readArtifact(entry),/128 MB/);
  entry.getMetadata=async()=>({size:129*1024*1024});await assert.rejects(()=>host.readArtifact(entry),/128 MB/);
  entry.getMetadata=async()=>({size:8,dateModified:new Date(1000)});entry.read=async()=>new Uint8Array([1]).buffer;
  await assert.rejects(()=>host.readArtifact(entry),/发生变化/);
});
test('same-size writes within one second are detected at metadata millisecond precision',async()=>{
  const {host,entry}=nativeFixture();let read=false;
  entry.getMetadata=async()=>({size:8,dateModified:new Date(read?1001:1000)});
  entry.read=async()=>{read=true;return new ArrayBuffer(8);};
  await assert.rejects(()=>host.readArtifact(entry),/发生变化/);
});
test('missing host capabilities are unknown, never zero-valued measurements',()=>{
  const {host,doc}=nativeFixture();doc.layers=undefined;assert.throws(()=>host.snapshot(),/完整读取图层结构/);
  doc.layers=[{kind:1}];assert.throws(()=>host.snapshot(),/未知值当成零/);
  doc.layers=[{kind:7,visible:true,layers:undefined}];assert.throws(()=>host.snapshot(),/完整读取图层结构/);
  doc.layers=[];doc.activeHistoryState={};assert.throws(()=>host.snapshot(),/历史状态标识/);
});
