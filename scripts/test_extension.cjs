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
    let change=()=>{},save=()=>{};
    const doc={uri,fileName:file,get version(){return version;},isDirty:false,getText:()=>content,save:async()=>{await fs.writeFile(file,content);doc.isDirty=false;save(doc);return true;}};
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
    vm.runInNewContext(await fs.readFile(filename,'utf8'),{module,exports:module.exports,require:id=>id==='vscode'?host:nativeRequire(id),process,Buffer,Uint8Array,Uint32Array,ArrayBuffer,DataView,console,performance,fetch,AbortSignal,TextEncoder,TextDecoder,setInterval,clearInterval,setTimeout,clearTimeout},{filename});
    extension=module.exports;await extension.activate(context);
    // First use must discover the local engine without a manual pairing command.
    await commands.get('workproof.start')();
    function edit(text,removed=0,reason){content=content.slice(0,content.length-removed)+text;version++;doc.isDirty=true;change({document:doc,reason,contentChanges:[{text,rangeLength:removed}]});}
    edit('A new paragraph.');edit('',3,1);
    await commands.get('workproof.pause')();edit('Unobserved while paused.');await commands.get('workproof.pause')();edit(' Final edit.');
    await commands.get('workproof.export')();assert.deepEqual(errors,[]);
    const proof=JSON.parse(await fs.readFile(file+'.wproof','utf8'));
    const events=proof.records.map(r=>r.event);
    assert.equal(events.filter(e=>e.kind==='edit').length,2);
    assert.equal(events.filter(e=>e.kind==='undo').length,1);
    assert.equal(events.filter(e=>e.kind==='gap').length,1);
    assert.equal(events.at(-1).kind,'save');assert.equal(proof.manifest.demo,false);
    assert(!JSON.stringify(proof).includes('Unobserved while paused'));
    const verified=spawnSync(engine,['verify',file,file+'.wproof'],{encoding:'utf8'});
    assert.equal(verified.status,0,verified.stdout+verified.stderr);
    await fs.appendFile(file,'tampered');assert.equal(spawnSync(engine,['verify',file,file+'.wproof']).status,2);
    await commands.get('workproof.stop')();assert.equal(state.get('workproof.session'),undefined);
    console.log('Extension → real collector → signed export → independent verifier: passed. Pause/gap/undo/privacy checked.');
  }finally{
    if(extension)await extension.deactivate();proc.kill();await new Promise(resolve=>proc.once('exit',resolve));
    if(original===undefined)delete process.env.WORKPROOF_DATA_DIR;else process.env.WORKPROOF_DATA_DIR=original;
    await fs.rm(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
