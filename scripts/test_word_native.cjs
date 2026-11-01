// Real Rust collector driven with exactly the HTTP sequence the native Word add-in sends.
// The Word host itself is not installed in CI; this does not claim a real Word acceptance run.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');

(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','Isolated Actions fixture only');
  const temporaryRoot=fs.realpathSync(os.tmpdir());
  const directory=fs.mkdtempSync(path.join(temporaryRoot,'workproof-word-'));
  const port=Number(process.env.WORKPROOF_HARNESS_PORT||43127);
  const harness=spawn(path.resolve(process.argv[2]),[],{env:{...process.env,WORKPROOF_DATA_DIR:directory,WORKPROOF_HARNESS_PORT:String(port)},stdio:['pipe','pipe','pipe']});
  let harnessErrors='';
  harness.stdout.resume();
  harness.stderr.on('data',chunk=>{harnessErrors+=chunk.toString();});
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const engine=path.resolve(process.argv[3]);
  let info;
  try{
    for(let i=0;i<200;i++){
      assert.equal(harness.exitCode,null,'Collector harness exited: '+harnessErrors);
      try{info=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));break;}catch{await wait(100);}
    }
    assert(info,'Collector did not initialize: '+harnessErrors);

    async function http(route,body,token='',origin){
      const headers={'Content-Type':'application/json'};
      if(token)headers.Authorization='Bearer '+token;
      if(origin!==undefined)headers.Origin=origin;
      const response=await fetch('http://127.0.0.1:'+port+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
      return {status:response.status,data:await response.json()};
    }
    const approve=(ticket,value=true)=>harness.stdin.write(JSON.stringify({ticket,approve:value})+'\n');
    const artifact=path.join(directory,'创作记录 报告.docx');
    const certificate=artifact+'.wproof';
    // Synthetic document bytes: only file binding and signing are exercised here.
    fs.writeFileSync(artifact,'synthetic docx fixture v1 '+Date.now());

    // 1. The add-in asks for a native grant and waits for the desktop decision.
    const request=await http('/v1/native-pairing',{source:'word'});
    assert.equal(request.status,200,'native pairing rejected: '+JSON.stringify(request.data));
    assert.equal(request.data.source,'word');assert.equal(request.data.channel,'native');assert.equal(request.data.origin,'');
    const waiting=await http('/v1/native-pairing/'+request.data.ticket);
    assert.equal(waiting.status,200);assert.equal(waiting.data.approved,false,'grant approved without a decision');
    approve(request.data.ticket);
    let token='';
    for(let i=0;i<100;i++){
      const poll=await http('/v1/native-pairing/'+request.data.ticket);
      if(poll.data.approved){token=poll.data.token;break;}
      await wait(50);
    }
    assert(token,'desktop approval never released a token');

    // 2. Session creation is bound to the granted source.
    const session=await http('/v1/sessions',{file_name:path.basename(artifact),started_at:new Date().toISOString(),source:'word'},token);
    assert.equal(session.status,200,'session rejected: '+JSON.stringify(session.data));
    const sessionId=session.data.session_id;
    assert(sessionId);

    // 3. The same event order the pane produces: start, edit, pause, gap, resume.
    const event=(seq,kind,extra={})=>({seq,elapsed_ms:seq*1500,kind,inserted:0,deleted:0,chars:0,checkpoint:'',metrics:{characters:0,paragraphs:0},...extra});
    let last=await http('/v1/sessions/'+sessionId+'/events',{events:[
      event(0,'start',{metrics:{characters:12,paragraphs:1}}),
      event(1,'edit',{inserted:8,deleted:0,chars:20,metrics:{characters:20,paragraphs:2}}),
      event(2,'pause',{chars:20,metrics:{characters:20,paragraphs:2}}),
      event(3,'gap',{chars:20,metrics:{characters:20,paragraphs:2}}),
      event(4,'resume',{chars:20,metrics:{characters:20,paragraphs:2}})
    ]},token);
    assert.equal(last.status,200,'event batch rejected: '+JSON.stringify(last.data));
    assert.equal(last.data.next_seq,5);

    // 4. The pane hashes the saved copy with the engine CLI before it asks for the certificate.
    const fingerprintRun=spawnSync(engine,['fingerprint',artifact],{encoding:'utf8'});
    assert.equal(fingerprintRun.status,0,fingerprintRun.stderr);
    const fingerprint=JSON.parse(fingerprintRun.stdout);
    assert.equal(fingerprint.bytes,fs.statSync(artifact).size);

    last=await http('/v1/sessions/'+sessionId+'/events',{events:[event(5,'save',{chars:20,checkpoint:fingerprint.hash,metrics:{characters:20,paragraphs:2}})]},token);
    assert.equal(last.status,200,'save checkpoint rejected: '+JSON.stringify(last.data));

    // 5. Export must bind the signed manifest to the exact artifact digest.
    const exported=await http('/v1/sessions/'+sessionId+'/export',{artifact_hash:fingerprint.hash,artifact_bytes:fingerprint.bytes},token);
    assert.equal(exported.status,200,'export rejected: '+JSON.stringify(exported.data));
    const proof=exported.data;
    assert.equal(proof.manifest.protocol,'workproof/3');
    assert.equal(proof.manifest.source,'word');
    assert.equal(proof.manifest.event_count,6);
    assert.equal(proof.manifest.artifact_hash,fingerprint.hash);
    assert.equal(proof.manifest.artifact_bytes,fingerprint.bytes);
    assert.equal(proof.manifest.file_name,path.basename(artifact));
    assert.equal(proof.manifest.identity,'self-signed');
    assert.equal(proof.manifest.time_evidence,'none');
    assert.equal(proof.records.at(-1).event.kind,'save');
    assert.equal(proof.records.at(-1).event.metrics.paragraphs,2);

    // 6. Independent verification of the delivered pair, then a tampered copy must fail.
    fs.writeFileSync(certificate,JSON.stringify(proof),'utf8');
    const verified=spawnSync(engine,['verify',artifact,certificate],{encoding:'utf8'});
    assert.equal(verified.status,0,'independent verify failed: '+verified.stderr);
    assert.equal(JSON.parse(verified.stdout).valid,true);
    const original=fs.readFileSync(artifact);
    fs.writeFileSync(artifact,'synthetic docx fixture v2 tampered');
    const tampered=spawnSync(engine,['verify',artifact,certificate],{encoding:'utf8'});
    assert.notEqual(tampered.status,0,'tampered artifact still verified');
    assert.equal(JSON.parse(tampered.stdout).file_match,false);
    fs.writeFileSync(artifact,original);
    assert.equal(spawnSync(engine,['verify',artifact,certificate],{encoding:'utf8'}).status,0);

    // 7. The Word grant stays scoped: another source, the master-only status route and native sealing are denied.
    assert.equal((await http('/v1/sessions',{file_name:'other.psd',started_at:new Date().toISOString(),source:'photoshop'},token)).status,403);
    assert.equal((await http('/v1/status',undefined,token)).status,403);
    const lastEvent=proof.records.at(-1).event;
    assert.equal((await http('/v1/sessions/'+sessionId+'/seal',{path:artifact,event:lastEvent},token)).status,403);
    assert.equal((await http('/v1/native-pairing',{source:'word'},'','https://word.example')).status,403);
    assert.equal((await http('/v1/native-pairing/'+request.data.ticket,undefined,'','null')).status,403);
    assert.equal((await http('/v1/pairing/'+request.data.ticket,undefined,'','https://word.example')).status,403);
    const unsupported=await http('/v1/native-pairing',{source:'wps'});
    assert.equal(unsupported.status,400);assert.equal(unsupported.data.error,'UNSUPPORTED_NATIVE_ADAPTER');
    const rejected=await http('/v1/native-pairing',{source:'word'});
    approve(rejected.data.ticket,false);
    let denied=false;
    for(let i=0;i<100;i++){const poll=await http('/v1/native-pairing/'+rejected.data.ticket);if(poll.status===400){denied=true;break;}await wait(50);}
    assert(denied,'a denied request stayed alive');

    const result={
      word_host:'not installed in CI; the add-in HTTP sequence is replayed against the real collector',
      collector:'real Rust/Axum/SQLite',
      native_grant:'approved through the CI-only stdin harness, token scoped to source word',
      file_binding:'engine fingerprint digest matched the signed manifest',
      independent_verify:'passed for the delivered pair; tampered artifact rejected',
      isolation:'photoshop session, master status, native seal, origin-bound requests and wps source all denied',
      events:proof.records.length
    };
    fs.writeFileSync('test-word-native-results.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  }finally{
    harness.stdin.end();harness.kill();
    if(harness.exitCode===null)await new Promise(resolve=>harness.once('exit',resolve));
    assert.equal(path.dirname(fs.realpathSync(directory)),temporaryRoot);
    assert(path.basename(directory).startsWith('workproof-word-'));
    fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
