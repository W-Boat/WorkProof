import {detectHost,fingerprint,type Host,type Snapshot} from './hosts';
const collector='http://127.0.0.1:43127';
type Event={seq:number;elapsed_ms:number;kind:string;inserted:number;deleted:number;chars:number;checkpoint:string;metrics:Record<string,number>};
let host:Host,token='',session='',deliveryName='',next=0,started=0,previous:Snapshot|null=null,paused=true,busy=false,sampling=false,lastSample=0;
let pending:Event[]=[],delivering:Promise<void>|null=null;
const element=(id:string)=>document.getElementById(id)!;
function message(text:string){element('status').textContent=text;}
function paint(){element('count').textContent=String(next-pending.length);element('pause').textContent=paused?'继续记录':'暂停记录';element('start').toggleAttribute('disabled',!!session||!host);element('pause').toggleAttribute('disabled',!session||!token||busy);element('export').toggleAttribute('disabled',!session||!token||paused||busy);}
async function api(route:string,body?:unknown,authenticated=true):Promise<any>{
  const result=await fetch(collector+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const data=await result.json();
  if(!result.ok){
    if(authenticated&&(result.status===401||result.status===403)&&data.error==='PAIRING_REQUIRED'){
      token='';paused=true;paint();
      throw new Error('连接已撤销或过期，已暂停记录。请关闭并重新打开加载项，在桌面重新批准后开始新记录。已有记录保留；未提交事件无法补传到新记录。');
    }
    throw new Error(data.error||'本地引擎请求失败');
  }
  return data;
}
function event(kind:string,snapshot:Snapshot,inserted=0,deleted=0,checkpoint=''){
  if(pending.length>=2048){paused=true;paint();throw new Error('离线事件队列已满，已暂停。连接恢复后点击继续。');}
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
    if(previous&&current.identity!==previous.identity){paused=true;throw new Error('活动文档已改变。请重新加载任务窗，为新文档开始记录。');}
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
  if(session)throw new Error('当前已有会话。');
  if(!token)await connect();
  previous=await host.snapshot();
  deliveryName=host.source==='word'?previous.name.replace(/\.[^.]*$/,'')+'.docx':previous.name;
  const result=await api('/v1/sessions',{file_name:deliveryName,started_at:new Date().toISOString(),source:host.source});
  session=result.session_id;next=0;started=performance.now();lastSample=started;paused=false;event('start',previous);await flush();
  message('记录中。每秒采样文档统计；不记录物理按键时长或文字历史。');paint();
}
async function pause(){
  if(!session)return;
  if(paused){
    await flush();const current=await host.snapshot();
    if(previous&&current.identity!==previous.identity)throw new Error('活动文档已改变。请重新加载任务窗，为新文档开始记录。');
    previous=current;event('gap',previous);event('resume',previous);paused=false;lastSample=performance.now();
  }
  else{await sample(true);event('pause',previous!);paused=true;}
  await flush();message(paused?'已暂停；继续时会披露采集缺口。':'记录中。');paint();
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
    const latest=await host.snapshot();if(latest.contentHash!==after.contentHash||latest.identity!==after.identity)throw new Error('签发期间文档发生变化，请重试。');
    save(new Blob([artifact.bytes.slice().buffer],{type:'application/octet-stream'}),artifact.name);
    save(new Blob([JSON.stringify(proof,null,2)],{type:'application/json'}),artifact.name+'.wproof');
    message('已下载交付件和证书。请交付本次导出的文件，勿用其他另存版本替代。');
  }finally{busy=false;paint();}
}
async function safe(fn:()=>Promise<void>){try{await fn();}catch(error){message(String(error instanceof Error?error.message:error));}}
for(const [id,fn] of [['start',start],['pause',pause],['export',exportProof]] as const)element(id).addEventListener('click',()=>void safe(fn));
setInterval(()=>{if(session&&!paused&&!busy&&performance.now()-lastSample>(previous&&previous.characters>1_000_000?5000:900))void safe(async()=>{await sample();await flush();});},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session&&!paused)void safe(()=>sample(true));});
window.addEventListener('beforeunload',event=>{if(session){event.preventDefault();event.returnValue='';}});
void safe(async()=>{host=await detectHost();element('host').textContent=host.label;message('作品留在本机。首次连接需在桌面窗口确认当前网址。');paint();});
