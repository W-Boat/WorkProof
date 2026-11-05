/* CI integration: execute the built extension against a real Rust collector.
   Only the VS Code host API is simulated; persistence, hashing and signatures are real. */
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {spawn,spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {pathToFileURL,fileURLToPath}=require('node:url');
const assert=require('node:assert/strict');
async function main(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workproof-extension-'));
  const engine=path.resolve(process.argv[2]);
  const original=process.env.WORKPROOF_DATA_DIR;process.env.WORKPROOF_DATA_DIR=dir;
  const proc=spawn(engine,[],{env:process.env,stdio:['ignore','pipe','pipe']});
  let engineErrors='';proc.stderr.on('data',chunk=>engineErrors+=chunk);
  let extension;
  try{
    for(let i=0;i<100;i++){try{await fs.access(path.join(dir,'connection.json'));break;}catch{await new Promise(r=>setTimeout(r,100));}if(proc.exitCode!==null)throw new Error(engineErrors);}
    const file=path.join(dir,'draft.md');let content='# A draft\n',version=1;
    await fs.writeFile(file,content);
    const uri={scheme:'file',fsPath:file,toString:()=>pathToFileURL(file).href};
    const commands=new Map(),state=new Map(),secrets=new Map(),errors=[],information=[];
    let change=()=>{},save=()=>{},beforeSave;
    const doc={uri,fileName:file,get version(){return version;},isDirty:false,getText:()=>content,save:async()=>{if(beforeSave)await beforeSave();await fs.writeFile(file,content);doc.isDirty=false;save(doc);return true;}};
    const disposable={dispose(){}};
    const host={
      env:{remoteName:undefined},StatusBarAlignment:{Right:1},TextDocumentChangeReason:{Undo:1,Redo:2},
      Uri:{file:p=>({fsPath:p,toString:()=>pathToFileURL(p).href}),parse:s=>({scheme:'file',fsPath:fileURLToPath(s),toString:()=>s})},
      commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return disposable;},executeCommand:(id)=>commands.get(id)()},
      window:{activeTextEditor:{document:doc},createStatusBarItem:()=>({show(){},dispose(){}}),showInformationMessage:async(message,...choices)=>{information.push(message);return choices[0];},showWarningMessage:async(message,...choices)=>choices[0],showErrorMessage:async message=>errors.push(message),showSaveDialog:async()=>({fsPath:file+'.wproof'})},
      workspace:{isTrusted:true,openTextDocument:async()=>doc,onDidChangeTextDocument:fn=>{change=fn;return disposable;},onDidSaveTextDocument:fn=>{save=fn;return disposable;}},
    };
    const context={subscriptions:[],workspaceState:{get:key=>state.get(key),update:async(key,value)=>state.set(key,value)},secrets:{get:async key=>secrets.get(key),store:async(key,value)=>secrets.set(key,value)}};
    const filename=path.resolve('apps/extension/dist/extension.js');const nativeRequire=createRequire(filename);
    const module={exports:{}};
    let sessionCreates=0;
    const observedFetch=(url,options)=>{if(String(url).endsWith('/v1/sessions')&&options?.method==='POST')sessionCreates++;return fetch(url,options);};
    vm.runInNewContext(await fs.readFile(filename,'utf8'),{module,exports:module.exports,require:id=>id==='vscode'?host:nativeRequire(id),process,Buffer,Uint8Array,Uint32Array,ArrayBuffer,DataView,console,performance,fetch:observedFetch,AbortSignal,TextEncoder,TextDecoder,setInterval,clearInterval,setTimeout,clearTimeout},{filename});
    extension=module.exports;await extension.activate(context);
    // First use must discover the local engine without a manual pairing command.
    const starting=commands.get('workproof.start')();
    await commands.get('workproof.start')();
    await starting;assert.equal(sessionCreates,1,'Repeated start must not create an orphan session');
    function edit(text,removed=0,reason){content=content.slice(0,content.length-removed)+text;version++;doc.isDirty=true;change({document:doc,reason,contentChanges:[{text,rangeLength:removed}]});}
    edit('A new paragraph.\n');edit('',3,1);
    await commands.get('workproof.pause')();edit('Unobserved while paused.');await commands.get('workproof.pause')();edit(' Final edit.');
    await commands.get('workproof.export')();assert.deepEqual(errors,[]);
    const proof=JSON.parse(await fs.readFile(file+'.wproof','utf8'));
    const events=proof.records.map(r=>r.event);
    assert.equal(events.filter(e=>e.kind==='edit').length,2);
    assert.equal(events.filter(e=>e.kind==='undo').length,1);
    assert.equal(events.find(e=>e.kind==='edit').metrics.spaces_inserted,2);
    assert.equal(events.find(e=>e.kind==='edit').metrics.line_breaks_inserted,1);
    assert.equal(events.filter(e=>e.kind==='gap').length,1);
    assert.equal(events.at(-1).kind,'save');assert.equal(proof.manifest.demo,false);
    assert(!JSON.stringify(proof).includes('Unobserved while paused'));
    const verified=spawnSync(engine,['verify',file,file+'.wproof'],{encoding:'utf8'});
    assert.equal(verified.status,0,verified.stdout+verified.stderr);
    // Paused export binds current saved bytes and explicitly discloses a gap without resuming collection.
    await commands.get('workproof.pause')();edit(' Paused export content.');
    let releaseSave,enteredSave;
    const saveEntered=new Promise(resolve=>enteredSave=resolve);
    beforeSave=()=>{enteredSave();return new Promise(resolve=>releaseSave=resolve);};
    const exporting=commands.get('workproof.export')();
    let saveWaitTimer;
    try{await Promise.race([saveEntered,new Promise((_,reject)=>saveWaitTimer=setTimeout(()=>reject(new Error('Paused export did not request a document save')),10000))]);}
    finally{clearTimeout(saveWaitTimer);}
    await commands.get('workproof.stop')();
    await commands.get('workproof.pause')();
    assert.equal(state.get('workproof.session').paused,true,'Commands during export must not resume or stop its session');
    releaseSave();await exporting;beforeSave=undefined;
    assert.deepEqual(errors,[]);
    const pausedProof=JSON.parse(await fs.readFile(file+'.wproof','utf8'));
    const pausedEvents=pausedProof.records.map(r=>r.event);
    assert.equal(pausedEvents.filter(e=>e.kind==='edit').length,2);
    assert.equal(pausedEvents.filter(e=>e.kind==='gap').length,2);
    assert.equal(pausedEvents.at(-2).kind,'gap');assert.equal(pausedEvents.at(-1).kind,'save');
    assert.equal(pausedEvents.at(-1).chars,content.length);
    assert(!JSON.stringify(pausedProof).includes('Paused export content'));
    assert.equal(state.get('workproof.session').paused,true);
    const pausedVerified=spawnSync(engine,['verify',file,file+'.wproof'],{encoding:'utf8'});
    assert.equal(pausedVerified.status,0,pausedVerified.stdout+pausedVerified.stderr);
    assert(information.filter(message=>message.includes('上一步还在处理')).length>=3);
    await fs.appendFile(file,'tampered');assert.equal(spawnSync(engine,['verify',file,file+'.wproof']).status,2);
    await commands.get('workproof.stop')();assert.equal(state.get('workproof.session'),undefined);
    console.log('Extension → real collector → signed export → independent verifier: passed. Paused export, duplicate start, concurrent commands, gap/undo/privacy checked.');
  }finally{
    if(extension)await extension.deactivate();proc.kill();await new Promise(resolve=>proc.once('exit',resolve));
    if(original===undefined)delete process.env.WORKPROOF_DATA_DIR;else process.env.WORKPROOF_DATA_DIR=original;
    await fs.rm(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
