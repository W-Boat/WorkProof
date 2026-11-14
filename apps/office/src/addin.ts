import {detectHost,fingerprint,type Host,type Snapshot} from './hosts';
const collector='http://127.0.0.1:43127';
type Event={seq:number;elapsed_ms:number;kind:string;inserted:number;deleted:number;chars:number;checkpoint:string;metrics:Record<string,number>};
let host:Host,token='',session='',deliveryName='',next=0,started=0,previous:Snapshot|null=null,paused=true,busy=false,sampling=false,lastSample=0;
let pending:Event[]=[],delivering:Promise<void>|null=null;
let pairing:AbortController|null=null,deliveryUrls:string[]=[];
let samplingGeneration=0;
const element=(id:string)=>document.getElementById(id)!;
function message(text:string){
  const status=element('status');
  if(status.textContent===text)return;
  status.textContent=text;
  status.classList.remove('updated');
  // Restart only when the message changes; no animation loop runs while typing.
  requestAnimationFrame(()=>status.classList.add('updated'));
}
function paint(){
  element('count').textContent=String(next-pending.length);
  const pauseLabel=paused?'继续记录':'暂停记录';
  element('pause').setAttribute('aria-label',pauseLabel);
  element('pause').setAttribute('title',pauseLabel);
  element('pause-icon').innerHTML=paused?'<path d="m8 5 11 7-11 7z"/>':'<path d="M9 5v14M15 5v14"/>';
  element('start').toggleAttribute('disabled',!!session||!host||busy);
  element('pause').toggleAttribute('disabled',!session||!token||busy);
  element('export').toggleAttribute('disabled',!session||!token||paused||busy);
  const phase=pairing?'pairing':session?(paused?'paused':'recording'):'ready';
  document.body.dataset.phase=phase;
  element('state-label').textContent=pairing?'等待允许连接':session?(paused?'记录已暂停':'正在记录'):'准备开始';
  const activeStep=!element('delivery').hidden?2:session?1:0;
  ['step-connect','step-record','step-export'].forEach((id,index)=>{
    element(id).classList.toggle('done',index<activeStep);
    if(index===activeStep)element(id).setAttribute('aria-current','step');
    else element(id).removeAttribute('aria-current');
  });
}
async function api(route:string,body?:unknown,authenticated=true,signal?:AbortSignal):Promise<any>{
  // Older Office/WPS webviews may have AbortController but no AbortSignal.any/timeout.
  const controller=new AbortController(),abort=()=>controller.abort();
  const timeout=setTimeout(abort,10000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let result:Response,data:any;
  try{
    result=await fetch(collector+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    data=await result.json();
    if(signal?.aborted)throw new Error('CANCELLED');
  }catch{if(signal?.aborted)throw new Error('已取消连接，没有开始新的记录。');throw new Error('无法连接本机 WorkProof。请确认桌面应用已打开，并允许加载项连接本机服务后重试。');}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  if(!result.ok){
    if(authenticated&&(result.status===401||result.status===403)&&data.error==='PAIRING_REQUIRED'){
      token='';paused=true;paint();
      throw new Error('连接已撤销或过期，已暂停记录。请关闭并重新打开加载项，在桌面重新批准后开始新记录。已有记录保留；未提交事件无法补传到新记录。');
    }
    const messages:Record<string,string>={PAIRING_EXPIRED:'连接请求已失效。请重新点击开始，并在 WorkProof 窗口允许连接。',PAIRING_LIMIT:'待确认的连接太多。请先在 WorkProof 窗口处理已有请求，再重试。',PAIRING_CHANNEL_MISMATCH:'连接来源不一致。请关闭并重新打开加载项。',SAVE_CHECKPOINT_REQUIRED:'本次保存尚未记录完成，请再次导出。',SEQUENCE_CONFLICT:'记录未能按原顺序保存。请暂停操作并重新打开加载项，开始一份新记录。',ADAPTER_SESSION_DENIED:'这份记录不属于当前连接。请重新打开加载项，开始一份新记录。'};
    throw new Error(messages[data.error]||'记录服务没有完成本次操作。请确认 WorkProof 仍在运行后重试；若仍然失败，请重新打开加载项。');
  }
  return data;
}
function event(kind:string,snapshot:Snapshot,inserted=0,deleted=0,checkpoint=''){
  if(pending.length>=2048){paused=true;paint();throw new Error('尚未保存的操作太多，已暂停。请恢复与 WorkProof 的连接后继续。');}
  pending.push({seq:next++,elapsed_ms:Math.floor(performance.now()-started),kind,inserted,deleted,chars:snapshot.characters,checkpoint,metrics:snapshot.metrics??{characters:snapshot.characters,paragraphs:snapshot.paragraphs}});paint();
}
async function flush(){
  if(delivering)return delivering;
  delivering=(async()=>{while(pending.length){const batch=pending.slice(0,128);await api(`/v1/sessions/${session}/events`,{events:batch});pending.splice(0,batch.length);paint();}})();
  try{await delivering;}finally{delivering=null;}
}
async function sample(force=false){
  if(!session||paused||sampling)return;
  sampling=true;const generation=samplingGeneration;
  try{
    const current=await host.snapshot();
    if(paused||generation!==samplingGeneration)return; // Ignore snapshots from before a local pause, including after resuming.
    if(previous&&current.identity!==previous.identity){paused=true;throw new Error('你已切换到另一份文档。请重新打开 WorkProof 面板，为新文档开始记录。');}
    if(lastSample&&performance.now()-lastSample>15000)event('gap',current);
    lastSample=performance.now();
    if(previous&&(current.contentHash!==previous.contentHash||current.paragraphs!==previous.paragraphs))event('edit',current,Math.max(0,current.characters-previous.characters),Math.max(0,previous.characters-current.characters));
    previous=current;
    if(force)await flush();
  }catch(error){if(generation===samplingGeneration)throw error;}
  finally{if(generation===samplingGeneration)sampling=false;paint();}
}
function clearDelivery(){for(const url of deliveryUrls)URL.revokeObjectURL(url);deliveryUrls=[];element('delivery').hidden=true;for(const id of ['save-artifact','save-proof'])(element(id) as HTMLAnchorElement).removeAttribute('href');}
function prepareDownload(id:string,blob:Blob,name:string){const link=element(id) as HTMLAnchorElement,url=URL.createObjectURL(blob);deliveryUrls.push(url);link.href=url;link.download=name;}
async function connect(){
  const controller=new AbortController();pairing=controller;element('cancel-pairing').hidden=false;paint();
  try{
  const request=await api('/v1/pairing',{source:host.source},false,controller.signal);
  message('请打开 WorkProof 桌面窗口，核对当前网址并点击“允许连接”。');
  for(let tries=0;tries<100;tries++){
    await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error('已取消连接，没有开始新的记录。'));};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},1000);controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();});
    const grant=await api(`/v1/pairing/${request.ticket}`,undefined,false,controller.signal);
    if(controller.signal.aborted)throw new Error('已取消连接，没有开始新的记录。');
    if(grant.approved){token=grant.token;message('已连接本机。点击开始记录。');return;}
  }
  throw new Error('连接请求已过期，请重试。');
  }finally{if(pairing===controller){pairing=null;element('cancel-pairing').hidden=true;paint();}}
}
async function start(){
  if(session)throw new Error('这份文档已经在记录中。');
  if(!token)await connect();
  previous=await host.snapshot();
  deliveryName=host.source==='word'?previous.name.replace(/\.[^.]*$/,'')+'.docx':previous.name;
  const result=await api('/v1/sessions',{file_name:deliveryName,started_at:new Date().toISOString(),source:host.source});
  session=result.session_id;next=0;started=performance.now();lastSample=started;paused=false;event('start',previous);await flush();
  message(previous.metrics?'记录中。保存结构数量和变化时间，文件内容留在本机。':'记录中。正在保存文字数量等变化，不保存文档正文。');paint();
}
async function pause(){
  if(!session)return;
  const resuming=paused;
  if(paused){
    await flush();const current=await host.snapshot();
    if(previous&&current.identity!==previous.identity)throw new Error('你已切换到另一份文档。请重新打开 WorkProof 面板，为新文档开始记录。');
    previous=current;event('gap',previous);event('resume',previous);
  }
  else{paused=true;samplingGeneration++;sampling=false;paint();message('已暂停本机采样，正在保存已有操作。');event('pause',previous!);}
  try{await flush();if(resuming){paused=false;lastSample=performance.now();}message(paused?'已暂停。继续后会标明这段未记录的时间。':'记录中。');}catch(error){if(!token)throw error;message('已暂停本机采样，部分操作尚未保存。请保持面板打开，恢复连接后点击继续记录；未保存的操作仍在本面板内存中。');}paint();
}
async function exportProof(){
  if(!session||paused)throw new Error('请先开始或继续记录。');
  busy=true;paint();
  clearDelivery();
  try{
    while(sampling)await new Promise(r=>setTimeout(r,20));
    await sample(true);
    const before=await host.snapshot();
    const artifact=await host.artifact();const after=await host.snapshot();
    if(before.identity!==after.identity||before.contentHash!==after.contentHash)throw new Error('导出期间文档发生变化，请停止编辑后重试。');
    if(artifact.name!==deliveryName)throw new Error('导出文件名与记录不一致，请重新开始记录。');
    const digest=fingerprint(artifact.bytes);event('save',after,0,0,digest);await flush();
    const proof=await api(`/v1/sessions/${session}/export`,{artifact_hash:digest,artifact_bytes:artifact.bytes.length});
    const latest=await host.snapshot();if(latest.contentHash!==after.contentHash||latest.identity!==after.identity)throw new Error('生成证书时文档又被修改了。请停止编辑后重试。');
    prepareDownload('save-artifact',new Blob([artifact.bytes.slice().buffer],{type:'application/octet-stream'}),artifact.name);
    prepareDownload('save-proof',new Blob([JSON.stringify(proof,null,2)],{type:'application/json'}),artifact.name+'.wproof');
    element('delivery').hidden=false;message('交付文件已准备。请分别点击保存作品和保存证书，并检查下载位置。这一对文件对应本次准备的版本；之后另存或继续修改的版本需要重新导出。');
  }finally{busy=false;paint();}
}
async function safe(fn:()=>Promise<void>){try{await fn();}catch(error){message(paused&&session&&token&&pending.length?'已暂停本机采样，部分操作尚未保存。请保持面板打开，恢复连接后点击继续记录。':String(error instanceof Error?error.message:error));}}
async function runAction(fn:()=>Promise<void>){
  if(busy)return;
  busy=true;paint();
  try{
    if(fn===pause&&!paused){await fn();return;}
    // A timer snapshot or durable write already in progress must settle first.
    while(sampling)await new Promise(resolve=>setTimeout(resolve,20));
    if(delivering)await delivering;
    await fn();
  }catch(error){message(String(error instanceof Error?error.message:error));}
  finally{busy=false;paint();}
}
for(const [id,fn] of [['start',start],['pause',pause],['export',exportProof]] as const)element(id).addEventListener('click',()=>void runAction(fn));
element('cancel-pairing').addEventListener('click',()=>{pairing?.abort();});
window.addEventListener('pagehide',()=>{pairing?.abort();clearDelivery();});
setInterval(()=>{if(session&&!paused&&!busy&&performance.now()-lastSample>(previous&&previous.characters>1_000_000?5000:900))void safe(async()=>{await sample();await flush();});},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session&&!paused&&!busy)void safe(()=>sample(true));});
window.addEventListener('beforeunload',event=>{if(session){event.preventDefault();event.returnValue='';}});
void safe(async()=>{host=await detectHost();element('host').textContent=host.label;message('WorkProof 不会上传作品。第一次开始时，请回到 WorkProof 窗口核对网址并允许连接。');paint();});
