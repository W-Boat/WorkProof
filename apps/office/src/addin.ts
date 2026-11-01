import {detectHost,fingerprint,type Host,type Snapshot} from './hosts';
const collector='http://127.0.0.1:43127';
type Event={seq:number;elapsed_ms:number;kind:string;inserted:number;deleted:number;chars:number;checkpoint:string;metrics:Record<string,number>};
let host:Host,token='',session='',deliveryName='',next=0,started=0,previous:Snapshot|null=null,paused=true,busy=false,sampling=false,lastSample=0;
let pending:Event[]=[],delivering:Promise<void>|null=null;
const element=(id:string)=>document.getElementById(id)!;
function message(text:string){element('status').textContent=text;}
function paint(){element('count').textContent=String(next-pending.length);element('pause').textContent=paused?'继续记录':'暂停记录';element('start').toggleAttribute('disabled',!!session||!host||busy);element('pause').toggleAttribute('disabled',!session||!token||busy);element('export').toggleAttribute('disabled',!session||!token||paused||busy);}
async function api(route:string,body?:unknown,authenticated=true):Promise<any>{
  const result=await fetch(collector+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)}).catch(()=>{throw new Error('无法连接本机 WorkProof。请确认桌面应用已打开，并允许加载项连接本机服务后重试。');});
  const data=await result.json();
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
  pending.push({seq:next++,elapsed_ms:Math.floor(performance.now()-started),kind,inserted,deleted,chars:snapshot.characters,checkpoint,metrics:{characters:snapshot.characters,paragraphs:snapshot.paragraphs}});paint();
}
async function flush(){
  if(delivering)return delivering;
  delivering=(async()=>{while(pending.length){const batch=pending.slice(0,128);await api(`/v1/sessions/${session}/events`,{events:batch});pending.splice(0,batch.length);paint();}})();
  try{await delivering;}finally{delivering=null;}
}
async function sample(force=false){
  if(!session||paused||sampling)return;
  sampling=true;
  try{
    const current=await host.snapshot();
    if(previous&&current.identity!==previous.identity){paused=true;throw new Error('你已切换到另一份文档。请重新打开 WorkProof 面板，为新文档开始记录。');}
    if(lastSample&&performance.now()-lastSample>15000)event('gap',current);
    lastSample=performance.now();
    if(previous&&(current.contentHash!==previous.contentHash||current.paragraphs!==previous.paragraphs))event('edit',current,Math.max(0,current.characters-previous.characters),Math.max(0,previous.characters-current.characters));
    previous=current;
    if(force)await flush();
  }finally{sampling=false;paint();}
}
function save(blob:Blob,name:string){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function connect(){
  const request=await api('/v1/pairing',{source:host.source},false);
  message('请打开 WorkProof 桌面窗口，核对当前网址并点击“允许连接”。');
  for(let tries=0;tries<100;tries++){
    await new Promise(r=>setTimeout(r,1000));const grant=await api(`/v1/pairing/${request.ticket}`,undefined,false);
    if(grant.approved){token=grant.token;message('已连接本机。点击开始记录。');return;}
  }
  throw new Error('连接请求已过期，请重试。');
}
async function start(){
  if(session)throw new Error('这份文档已经在记录中。');
  if(!token)await connect();
  previous=await host.snapshot();
  deliveryName=host.source==='word'?previous.name.replace(/\.[^.]*$/,'')+'.docx':previous.name;
  const result=await api('/v1/sessions',{file_name:deliveryName,started_at:new Date().toISOString(),source:host.source});
  session=result.session_id;next=0;started=performance.now();lastSample=started;paused=false;event('start',previous);await flush();
  message('记录中。正在保存文字数量等变化，不保存文档正文。');paint();
}
async function pause(){
  if(!session)return;
  if(paused){
    await flush();const current=await host.snapshot();
    if(previous&&current.identity!==previous.identity)throw new Error('你已切换到另一份文档。请重新打开 WorkProof 面板，为新文档开始记录。');
    previous=current;event('gap',previous);event('resume',previous);paused=false;lastSample=performance.now();
  }
  else{await sample(true);event('pause',previous!);paused=true;}
  await flush();message(paused?'已暂停。继续后会标明这段未记录的时间。':'记录中。');paint();
}
async function exportProof(){
  if(!session||paused)throw new Error('请先开始或继续记录。');
  busy=true;paint();
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
    save(new Blob([artifact.bytes.slice().buffer],{type:'application/octet-stream'}),artifact.name);
    save(new Blob([JSON.stringify(proof,null,2)],{type:'application/json'}),artifact.name+'.wproof');
    message('作品和证书已下载。请把这两个文件一起发送；另存的其他版本可能无法通过检查。');
  }finally{busy=false;paint();}
}
async function safe(fn:()=>Promise<void>){try{await fn();}catch(error){message(String(error instanceof Error?error.message:error));}}
async function runAction(fn:()=>Promise<void>){
  if(busy)return;
  busy=true;paint();
  try{
    // A timer snapshot or durable write already in progress must settle first.
    while(sampling)await new Promise(resolve=>setTimeout(resolve,20));
    if(delivering)await delivering;
    await fn();
  }catch(error){message(String(error instanceof Error?error.message:error));}
  finally{busy=false;paint();}
}
for(const [id,fn] of [['start',start],['pause',pause],['export',exportProof]] as const)element(id).addEventListener('click',()=>void runAction(fn));
setInterval(()=>{if(session&&!paused&&!busy&&performance.now()-lastSample>(previous&&previous.characters>1_000_000?5000:900))void safe(async()=>{await sample();await flush();});},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session&&!paused&&!busy)void safe(()=>sample(true));});
window.addEventListener('beforeunload',event=>{if(session){event.preventDefault();event.returnValue='';}});
void safe(async()=>{host=await detectHost();element('host').textContent=host.label;message('WorkProof 不会上传作品。第一次开始时，请回到 WorkProof 窗口核对网址并允许连接。');paint();});
