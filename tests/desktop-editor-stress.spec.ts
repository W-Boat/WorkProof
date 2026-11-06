import {test,expect,Page,Browser} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

test.skip(!process.env.WORKPROOF_EDITOR_STRESS_HARNESS||process.env.GITHUB_ACTIONS!=='true','Actions-only real Rust persistence stress acceptance');

// Only display-status commands below are fixtures. Document IPC always goes to
// the real SQLite/signature engine over its Actions-only stdio bridge.
function bridge(directory:string,diagnostics:string){
  const binary=process.env.WORKPROOF_EDITOR_STRESS_HARNESS;
  if(!binary||process.env.GITHUB_ACTIONS!=='true')throw new Error('Stress acceptance requires the real Actions Rust bridge');
  const child=spawn(binary,['--root',directory],{env:{...process.env,WORKPROOF_EDITOR_STRESS_ROOT:directory},stdio:['pipe','pipe','pipe']});
  const pending=new Map<string,{resolve:(result:any)=>void,reject:(error:Error)=>void,timer:NodeJS.Timeout,started:number,command:string}>();
  const calls:any[]=[],exports:any[]=[];
  child.stderr.on('data',data=>fs.appendFileSync(diagnostics,data));
  const fail=(error:Error)=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();};
  child.on('error',fail);child.on('exit',code=>fail(new Error(`Rust bridge exited (${code})`)));
  child.stdin.on('error',fail);
  readline.createInterface({input:child.stdout}).on('line',line=>{
    let response:any;
    try{response=JSON.parse(line);}catch{fail(new Error('Rust bridge returned a non-JSON response'));return;}
    const request=pending.get(response.request_id);if(!request)return;
    pending.delete(response.request_id);clearTimeout(request.timer);
    calls.push({command:request.command,ok:response.ok,elapsed_ms:response.elapsed_ms,wall_ms:performance.now()-request.started,error:response.error});
    if(response.ok){if(request.command==='editor_export')exports.push(response.result);request.resolve(response.result);}
    else request.reject(new Error(response.error||'Real editor IPC failed'));
  });
  function invoke(command:string,args:any={}){
    return new Promise<any>((resolve,reject)=>{
      const request_id=crypto.randomUUID();
      const timer=setTimeout(()=>{pending.delete(request_id);reject(new Error(`Rust ${command} timed out after 60 seconds`));},60000);
      pending.set(request_id,{resolve,reject,timer,started:performance.now(),command});
      child.stdin.write(JSON.stringify({command,args,request_id})+'\n',error=>{if(error){clearTimeout(timer);pending.delete(request_id);reject(error);}});
    });
  }
  async function stop(){
    child.stdin.end();
    if(child.exitCode!==null)return;
    await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  }
  return {invoke,calls,exports,stop};
}

function fixture(target:number){
  const tail=`压测终点${target}唯一标记${crypto.randomBytes(10).toString('hex')}`;
  let random=target|0;
  const characters=Array.from({length:target-tail.length},()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return String.fromCharCode(0x4e00+(random>>>0)%20902);});
  const text=characters.join('')+tail;
  const content=[];
  for(let position=0;position<text.length;position+=400)content.push({type:'paragraph',content:[{type:'text',text:text.slice(position,position+400)}]});
  return {text,tail,document:{type:'doc',content}};
}
function documentText(node:any):string{return node.type==='text'?node.text:(node.content||[]).map(documentText).join('');}
function summarize(values:number[]){
  const sorted=[...values].sort((a,b)=>a-b),percentile=(p:number)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;
  return {samples:sorted.length,p50:percentile(.5),p95:percentile(.95),max:sorted.at(-1)??null};
}
async function openDesktop(browser:Browser,engine:ReturnType<typeof bridge>,title:string){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  try{
  page.setDefaultTimeout(20000);
  await page.exposeFunction('stressNativeInvoke',async(command:string,args:any)=>{
    if(command==='engine_status')return {ready:true,sessions:0,events:0};
    if(['pending_adapters','adapter_connections','external_documents_list'].includes(command))return [];
    if(command.startsWith('editor_'))return engine.invoke(command,args);
    throw new Error('Unexpected stress IPC '+command);
  });
  await page.addInitScript(()=>{
    const w=window as any;
    w.__TAURI__={event:{listen:async()=>()=>{}},core:{invoke:(command:string,args:any)=>w.stressNativeInvoke(command,args||{})}};
  });
  const csp=JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8')).app.security.csp;
  await page.route('**/index.html',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'Content-Security-Policy':csp}});});
  await page.goto('http://127.0.0.1:4178/index.html');
  const start=performance.now();
  await page.getByRole('button',{name:`继续编辑 ${title}`,exact:true}).click();
  await expect(page.locator('#tiptap-editor .tiptap')).toBeVisible({timeout:45000});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  return {context,page,openMs:performance.now()-start};
  }catch(error){await context.close().catch(()=>{});throw error;}
}

for(const target of [100000,150000,200000,300000])test(`real persisted Chinese document ${target} characters`,async({browser},info)=>{
  const output=path.resolve('test-results/editor-stress',`case-${target}`);fs.mkdirSync(output,{recursive:true});
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'workproof-editor-stress-'));
  const engine=bridge(data,path.join(output,'engine-stderr.log'));
  const seed=fixture(target),title=`真实长文压测${target}`;
  const metrics:any={target_chars:target,actual_chars:null,tail_marker:seed.tail,open_ms:null,keypress_ms:[],save_ms:null,exports:{},errors:[],scope:'Chromium 1280x900 on Actions, real Tiptap/SQLite/Ed25519 and offline Word worker. Keydown to double-rAF is a next-paint proxy. File-picker human wait excluded; bridge writes actual files. Native WebView and Chinese IME composition are outside this run.'};
  const proofs:Record<string,any>={};let initial:Awaited<ReturnType<typeof openDesktop>>|null=null;
  let id='';
  try{
    const created=await engine.invoke('editor_create',{title,started:new Date().toISOString()});id=created.id;
    const seeded=performance.now();await engine.invoke('editor_save',{input:{id,expected_revision:created.revision,request_id:crypto.randomUUID().replaceAll('-',''),title,content:seed.document,actions:[{kind:'import',elapsed_ms:0,inserted:target,deleted:0,chars:target,steps:[],selection:{from:1,to:1},detail:{source:'synthetic_stress_fixture'},metrics:{}}]}});metrics.seed_save_ms=performance.now()-seeded;
    try{
      initial=await openDesktop(browser,engine,title);const {page}=initial;metrics.open_ms=initial.openMs;
      expect(await page.locator('#tiptap-editor .tiptap').evaluate(element=>[...element.querySelectorAll(':scope > p')].map(node=>node.textContent).join(''))).toBe(seed.text);
      await page.evaluate(()=>{
        const w=window as any;w.stressPaint=[];
        document.querySelector('#tiptap-editor')!.addEventListener('keydown',(event:Event)=>{
          const key=event as KeyboardEvent;if(!/^[a-z]$/.test(key.key)||key.ctrlKey||key.metaKey)return;
          const started=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>w.stressPaint.push(performance.now()-started)));
        },true);
      });
      await page.locator('#tiptap-editor .tiptap').click();await page.keyboard.press('ControlOrMeta+End');
      for(let index=0;index<20;index++){
        await page.keyboard.type(String.fromCharCode(97+index));await page.keyboard.insertText(`中文${index}`);
        await page.waitForTimeout(40+crypto.randomInt(141));
      }
      metrics.typed_suffix=Array.from({length:20},(_,index)=>String.fromCharCode(97+index)+`中文${index}`).join('');
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      metrics.keypress_ms=await page.evaluate(()=>(window as any).stressPaint);metrics.keypress_summary=summarize(metrics.keypress_ms);
      expect(metrics.keypress_ms).toHaveLength(20);
      const savesBefore=engine.calls.filter(call=>call.command==='editor_save').length,started=performance.now();await page.locator('#save-document').click();await expect(page.locator('#save-state')).toHaveText('已保存到本机',{timeout:45000});metrics.save_ms=performance.now()-started;
      const saves=engine.calls.filter(call=>call.command==='editor_save');metrics.manual_save_had_pending_work=saves.length>savesBefore;metrics.last_storage_save_ms=saves.at(-1)?.elapsed_ms;
      await page.screenshot({path:path.join(output,'editing.png'),timeout:15000});
    }catch(error){metrics.errors.push({phase:'open_edit_save',error:String(error)});}
    finally{await initial?.context.close().catch(()=>{});}
    const stored=await engine.invoke('editor_load',{id}),expected=documentText(stored.content);
    metrics.actual_chars=Array.from(expected).length;fs.writeFileSync(path.join(output,'expected_text.txt'),expected);
    if(!expected.startsWith(seed.text)||expected.length<target||metrics.typed_suffix&&expected!==seed.text+metrics.typed_suffix)metrics.errors.push({phase:'persisted_content',error:'Persisted document lost original text, the unique tail marker or typed suffix'});
    for(const [format,option,extension] of [['html','html','html'],['markdown','markdown','md'],['docx','docx','docx']]){
      let view:Awaited<ReturnType<typeof openDesktop>>|null=null;
      const entry:any={path:`artifact.${extension}`,ms:null,verified:false};metrics.exports[format]=entry;
      try{
        view=await openDesktop(browser,engine,title);entry.reopen_ms=view.openMs;
        await view.page.locator('#export-format').selectOption(option);const previous=engine.exports.length,start=performance.now();
        await view.page.locator('#export-document').click();await expect(view.page.locator('#export-document')).toBeEnabled({timeout:45000});entry.ms=performance.now()-start;
        const exported=engine.exports[previous];
        if(!exported)throw new Error(await view.page.locator('#message').textContent()||'UI did not produce an actual artifact');
        proofs[format]=exported.report;
        if(exported.saved!==true||exported.report?.valid!==true||exported.report?.file_match!==true||exported.report?.signature_valid!==true)throw new Error('Actual exported certificate did not verify');
        if(!fs.existsSync(exported.artifact_path)||!fs.existsSync(exported.certificate_path))throw new Error('Actual exported artifact or certificate missing');
        fs.copyFileSync(exported.artifact_path,path.join(output,entry.path));fs.copyFileSync(exported.certificate_path,path.join(output,entry.path+'.wproof'));
        entry.verified=true;entry.bytes=fs.statSync(path.join(output,entry.path)).size;
      }catch(error){entry.error=String(error);entry.timeout=/timeout|timed out|超时/i.test(entry.error);metrics.errors.push({phase:`export_${format}`,error:entry.error});}
      finally{
        if(view)try{await view.page.screenshot({path:path.join(output,`export-${format}.png`),timeout:3000});}catch(error){entry.screenshot_error=String(error);}
        await view?.context.close().catch(()=>{});fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2));fs.writeFileSync(path.join(output,'proof-verification.json'),JSON.stringify(proofs,null,2));
      }
    }
    try{metrics.storage=await engine.invoke('stats');}catch(error){metrics.storage_error=String(error);}
  }catch(error){metrics.errors.push({phase:'setup_or_storage',error:String(error)});}
  finally{
    metrics.ipc=engine.calls;fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2));fs.writeFileSync(path.join(output,'proof-verification.json'),JSON.stringify(proofs,null,2));
    await info.attach('observations',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});await engine.stop();
  }
  expect(metrics.errors,'Recorded failures must remain visible alongside observations').toEqual([]);
});
