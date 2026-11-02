// Real Rust collector + simulated Adobe API. Never calls this a real Photoshop acceptance test.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const {Recorder}=require('../apps/photoshop/src/controller.cjs');
const {createHost}=require('../apps/photoshop/src/host.cjs');
(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','Isolated Actions fixture only');
  const {blake3}=await import('@noble/hashes/blake3.js');
  const temporaryRoot=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(temporaryRoot,'workproof-photoshop-'));
  const harness=spawn(path.resolve(process.argv[2]),[],{env:{...process.env,WORKPROOF_DATA_DIR:directory},stdio:['pipe','pipe','pipe']});
  harness.stdout.resume();harness.stderr.resume();
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let info;
  try{
    for(let i=0;i<150;i++){
      assert.equal(harness.exitCode,null,'Collector harness exited');
      try{info=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));break;}catch{await wait(100);}
    }
    assert(info,'Collector did not initialize');
    async function http(route,body,token='',origin){
      const response=await fetch('http://127.0.0.1:43127'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(origin===undefined?{}:{Origin:origin})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
      return {status:response.status,data:await response.json()};
    }
    const approve=(ticket,value=true)=>harness.stdin.write(JSON.stringify({ticket,approve:value})+'\n');
    const calls=[];let callback;let nativeTicket;
    const artifactPath=path.join(directory,'delivery.psd'),certificatePath=artifactPath+'.wproof',graphPath=artifactPath+'.wgraph';
    const entry=(filename)=>({name:path.basename(filename),nativePath:filename,
      async getMetadata(){const stat=fs.statSync(filename);return {size:stat.size,dateModified:new Date(stat.mtimeMs)};},
      async read(){const data=fs.readFileSync(filename);return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);},
      async write(data){fs.writeFileSync(filename,data);}});
    const doc={id:31,title:'private source.psd',path:path.join(directory,'private-source.psd'),cloudDocument:false,activeHistoryState:{id:1},layers:[{id:301,kind:1,visible:true,name:'private layer name'}]};
    const ps={app:{activeDocument:doc},constants:{LayerKind:{GROUP:7}},
      action:{async addNotificationListener(events,fn){assert(!events.includes('all'));callback=fn;},async removeNotificationListener(){callback=null;}},
      core:{async executeAsModal(fn){await fn({isCancelled:false});}}};
    // Deliberately synthetic file bytes. Only file binding and signing are exercised here.
    doc.saveAs={psd:async(file,options,asCopy)=>{assert.equal(asCopy,true);fs.writeFileSync(file.nativePath,'8BPS synthetic fixture '+doc.activeHistoryState.id);}};
    const storage={formats:{binary:'binary',utf8:'utf8'},localFileSystem:{getFileForSaving:async name=>entry(name.endsWith('.wproof')?certificatePath:name.endsWith('.wgraph')?graphPath:artifactPath)}};
    let now=1000;
    const r=new Recorder({host:createHost(ps,storage),now:()=>now,sleep:()=>wait(25),hash:bytes=>Buffer.from(blake3(bytes)).toString('hex'),request:async(route,body,token)=>{
      calls.push({route,body});const result=await http(route,body,token);
      if(result.status!==200)throw Error(result.data.error);
      if(route==='/v1/native-pairing'){nativeTicket=result.data.ticket;approve(nativeTicket);}
      return result.data;
    }});
    await r.start();const nativeToken=r.token;
    doc.layers.push({id:302,kind:7,visible:true,layers:[{id:303,kind:1,visible:false,name:'private nested name'}]});doc.activeHistoryState.id++;
    callback('make',{documentID:31,privateText:'DO NOT SEND PIXELS',layerName:'private nested name'});now+=1000;await r.sample();
    await r.pause();now+=5000;doc.activeHistoryState.id++;await r.pause();
    await r.export();
    const certificate=JSON.parse(fs.readFileSync(certificatePath,'utf8'));
    assert.equal(certificate.manifest.protocol,'workproof/3');assert.equal(certificate.manifest.source,'photoshop');
    assert.equal(certificate.records.at(-1).event.metrics.layers,3);assert.equal(certificate.records.at(-1).event.metrics.groups,1);
    assert(certificate.records.some(r=>r.event.kind==='layer'));assert(certificate.records.some(r=>r.event.kind==='gap'));
    const transmitted=JSON.stringify(calls);for(const secret of ['private layer name','private nested name','DO NOT SEND PIXELS',directory])assert.equal(transmitted.includes(secret),false);
    const engine=path.resolve(process.argv[3]);
    const verify=spawnSync(engine,['verify',artifactPath,certificatePath],{encoding:'utf8'});assert.equal(verify.status,0,verify.stderr);
    const foreign=(await http('/v1/sessions',{source:'vscode',file_name:'foreign.psd',started_at:new Date().toISOString()},info.token)).data.session_id;
    const graphBody={seq:certificate.manifest.event_count,event_kind:'layer',nodes:[]};
    const graphRoute='/v1/sessions/'+r.session+'/evolution-checkpoint';
    const graphPrepared=await http(graphRoute,graphBody,nativeToken);
    assert.equal(graphPrepared.status,200);assert.equal(graphPrepared.data.snapshot.source,'photoshop');
    assert.equal(graphPrepared.data.snapshot.session_id,r.session);assert.equal(graphPrepared.data.snapshot.seq,graphBody.seq);
    assert.match(graphPrepared.data.checkpoint,/^[a-f0-9]{64}$/);
    assert.equal((await http(graphRoute,graphBody)).status,401);
    assert.equal((await http('/v1/sessions/'+foreign+'/evolution-checkpoint',{...graphBody,seq:0},nativeToken)).status,403);
    assert.equal((await http('/v1/status',undefined,nativeToken)).status,403);
    assert.equal((await http('/v1/sessions',{source:'word',file_name:'other.docx',started_at:new Date().toISOString()},nativeToken)).status,403);
    assert.equal((await http('/v1/sessions/'+foreign+'/export',{artifact_hash:certificate.manifest.artifact_hash,artifact_bytes:certificate.manifest.artifact_bytes},nativeToken)).status,403);
    assert.equal((await http('/v1/sessions/'+r.session+'/seal',{path:artifactPath,event:certificate.records.at(-1).event},nativeToken)).status,403);
    assert.equal((await http('/v1/native-pairing',{source:'photoshop'},'', 'https://website.example')).status,403);
    assert.equal((await http('/v1/native-pairing',{source:'photoshop'},'', 'null')).status,403);
    assert.equal((await http('/v1/native-pairing/'+nativeTicket,undefined,'','https://website.example')).status,403);
    assert.equal((await http('/v1/pairing/'+nativeTicket,undefined,'','https://website.example')).status,403);
    assert.equal((await http('/v1/sessions',{source:'photoshop',file_name:'forged.psd',started_at:new Date().toISOString()},nativeToken,'https://website.example')).status,403);
    const browser=await http('/v1/pairing',{source:'word'},'','https://word.example');assert.equal(browser.status,200);approve(browser.data.ticket);
    let browserToken;
    for(let i=0;i<100;i++){const p=await http('/v1/pairing/'+browser.data.ticket,undefined,'','https://word.example');if(p.data.approved){browserToken=p.data.token;break;}await wait(25);}
    assert(browserToken);assert.equal((await http('/v1/native-pairing/'+browser.data.ticket)).status,403);
    assert.equal((await http('/v1/sessions',{source:'word',file_name:'forged.docx',started_at:new Date().toISOString()},browserToken)).status,401);
    const rejected=(await http('/v1/native-pairing',{source:'photoshop'})).data;approve(rejected.ticket,false);
    for(let i=0;i<100;i++){const p=await http('/v1/native-pairing/'+rejected.ticket);if(p.status===400)break;await wait(25);}
    assert.equal((await http('/v1/native-pairing/'+rejected.ticket)).status,400);
    const nativeSession=r.session;await r.stop();
    const wordSession=await http('/v1/sessions',{source:'word',file_name:'word.docx',started_at:new Date().toISOString()},browserToken,'https://word.example');assert.equal(wordSession.status,200);
    const wps=await http('/v1/pairing',{source:'wps'},'','https://wps.example');assert.equal(wps.status,200);approve(wps.data.ticket);
    let wpsToken;
    for(let i=0;i<100;i++){const p=await http('/v1/pairing/'+wps.data.ticket,undefined,'','https://wps.example');if(p.data.approved){wpsToken=p.data.token;break;}await wait(25);}
    assert(wpsToken);
    const wordGraph='/v1/sessions/'+wordSession.data.session_id+'/evolution-checkpoint';
    const startGraph={seq:0,event_kind:'start',nodes:[]};
    assert.equal((await http(wordGraph,startGraph,browserToken,'https://word.example')).status,200);
    assert.equal((await http(wordGraph,startGraph,wpsToken,'https://wps.example')).status,403);
    assert.equal((await http(wordGraph,startGraph,nativeToken)).status,403);
    const beforeRevocation=(await http('/v1/status',undefined,info.token)).data;
    harness.stdin.write(JSON.stringify({revoke:browser.data.ticket})+'\n');
    for(let i=0;i<100;i++){const p=await http('/v1/pairing/'+browser.data.ticket,undefined,'','https://word.example');if(p.status===400)break;await wait(25);}
    assert.equal((await http('/v1/pairing/'+browser.data.ticket,undefined,'','https://word.example')).status,400);
    assert.equal((await http(wordGraph,startGraph,browserToken,'https://word.example')).status,403);
    assert.equal((await http('/v1/sessions',{source:'word',file_name:'revoked.docx',started_at:new Date().toISOString()},browserToken,'https://word.example')).status,403);
    assert.equal((await http('/v1/sessions/'+wordSession.data.session_id+'/events',{events:[]},browserToken,'https://word.example')).status,403);
    assert.equal((await http('/v1/sessions/'+wordSession.data.session_id+'/export',{artifact_hash:certificate.manifest.artifact_hash,artifact_bytes:certificate.manifest.artifact_bytes},browserToken,'https://word.example')).status,403);
    assert.equal((await http('/v1/sessions',{source:'wps',file_name:'still-connected.docx',started_at:new Date().toISOString()},wpsToken,'https://wps.example')).status,200);
    harness.stdin.write(JSON.stringify({revoke:nativeTicket})+'\n');
    for(let i=0;i<100;i++){const p=await http('/v1/native-pairing/'+nativeTicket);if(p.status===400)break;await wait(25);}
    assert.equal((await http('/v1/sessions/'+nativeSession+'/export',{artifact_hash:certificate.manifest.artifact_hash,artifact_bytes:certificate.manifest.artifact_bytes},nativeToken)).status,401);
    assert.equal((await http('/v1/sessions/'+nativeSession+'/evolution-checkpoint',graphBody,nativeToken)).status,401);
    const afterRevocation=(await http('/v1/status',undefined,info.token)).data;
    assert.equal(afterRevocation.events,beforeRevocation.events);assert.equal(afterRevocation.sessions,beforeRevocation.sessions+1);
    const preserved=spawnSync(engine,['verify',artifactPath,certificatePath],{encoding:'utf8'});assert.equal(preserved.status,0,preserved.stderr);
    const result={adobe_host:'simulated UXP APIs, not real Photoshop',collector:'real Rust/Axum/SQLite',signature_and_file_binding:'passed via native CLI',native_desktop_approval:'real Rust approval function via CI-only stdin harness',origin_and_channel_isolation:'passed',source_and_session_scope:'passed',native_seal_and_global_status_denied:'passed',private_descriptors_excluded:'passed',desktop_revocation:'Word create/append/export denied; WPS unaffected; native grant revoked; exported proof preserved',events:certificate.records.length};
    result.evolution_checkpoint_authorization='Native and browser grants accepted only for their own sessions; cross-grant and revoked requests denied; preparation does not append events';
    assert.equal(fs.existsSync(graphPath),false,'Default recording must not export structure');
    let loseAck=false;
    const graphRecorder=new Recorder({evolution:true,host:createHost(ps,storage),now:()=>now,sleep:()=>wait(25),hash:bytes=>Buffer.from(blake3(bytes)).toString('hex'),request:async(route,body,token)=>{
      const response=await http(route,body,token);if(response.status!==200)throw Error(response.data.error);
      if(route==='/v1/native-pairing')approve(response.data.ticket);
      if(loseAck&&route.endsWith('/events')){loseAck=false;throw Error('Synthetic ACK loss after actual Rust commit');}
      return response.data;
    }});
    await graphRecorder.start();assert.equal(graphRecorder.graphs.length,1);
    doc.layers.reverse();doc.activeHistoryState.id++;now+=1000;loseAck=true;
    await assert.rejects(()=>graphRecorder.sample(true),/ACK loss/);
    assert.equal(graphRecorder.graphs.length,1);
    const queuedNodes=JSON.parse(JSON.stringify(graphRecorder.graphPending.get(graphRecorder.pending[0]).nodes));
    doc.layers.reverse();doc.activeHistoryState.id++;
    await graphRecorder.flush();assert.deepEqual(graphRecorder.graphs.at(-1).nodes,queuedNodes);
    await graphRecorder.export();
    const graph=JSON.parse(fs.readFileSync(graphPath,'utf8'));
    assert(graph.snapshots.length>=2);assert(graph.snapshots.some(s=>s.nodes.some(n=>n.kind==='group')));
    for(const snapshot of graph.snapshots)for(const node of snapshot.nodes){assert.deepEqual(Object.keys(node),['id','parent','order','kind','relation']);assert(node.id<301);}
    assert(!JSON.stringify(graph).includes('private'));
    let inspected=spawnSync(engine,['inspect-evolution',certificatePath,graphPath],{encoding:'utf8'});assert.equal(inspected.status,0,inspected.stdout+inspected.stderr);
    const selectedPath=path.join(directory,'graph.selected.wproof');
    assert.equal(spawnSync(engine,['disclose',certificatePath,selectedPath,graph.snapshots.map(s=>s.seq).join(',')],{encoding:'utf8'}).status,0);
    assert.equal(spawnSync(engine,['inspect-evolution',selectedPath,graphPath],{encoding:'utf8'}).status,0);
    graph.snapshots[0].nodes[0].order+=10;fs.writeFileSync(graphPath,JSON.stringify(graph));
    assert.equal(spawnSync(engine,['inspect-evolution',certificatePath,graphPath],{encoding:'utf8'}).status,2);
    await graphRecorder.stop();result.opt_in_evolution='Default-off; full/selective real Rust verification; graph tamper denied; ACK-loss retry immutable; anonymous group/layer nodes';
    fs.writeFileSync('test-photoshop-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{
    harness.stdin.end();harness.kill();
    if(harness.exitCode===null)await new Promise(resolve=>harness.once('exit',resolve));
    assert.equal(path.dirname(fs.realpathSync(directory)),temporaryRoot);assert(path.basename(directory).startsWith('workproof-photoshop-'));
    fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
