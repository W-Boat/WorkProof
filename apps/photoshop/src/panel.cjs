const ps=require('photoshop');
const {storage,entrypoints}=require('uxp');
const {blake3}=require('@noble/hashes/blake3.js');
const {Recorder}=require('./controller.cjs');
const {createHost}=require('./host.cjs');
const element=id=>document.getElementById(id);
async function request(path,body,token){
  // UXP native fetch only. Never invent a website Origin or send the collector master token.
  const controller=typeof AbortController==='function'?new AbortController():null;
  let timer;
  try{
    return await Promise.race([
      (async()=>{const response=await fetch('http://127.0.0.1:43127'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),...(controller?{signal:controller.signal}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'本机引擎请求失败');return data;})(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(new Error('本机引擎响应超时，请确认托盘程序仍在运行。'));},10000);})
    ]);
  }finally{clearTimeout(timer);}
}
const recorder=new Recorder({host:createHost(ps,storage),request,hash:bytes=>Array.from(blake3(bytes),n=>n.toString(16).padStart(2,'0')).join(''),changed:state=>{
  element('status').textContent=state.message;
  element('count').textContent=`${state.committed} 条已提交事件 · ${state.queued} 条待提交`;
  element('start').disabled=state.recording||state.busy;
  element('evolution').disabled=state.recording||state.busy;
  element('pause').disabled=!state.recording||state.busy;
  element('pause').textContent=state.paused?'继续记录':'暂停记录';
  element('export').disabled=!state.recording||state.busy;
  element('stop').disabled=!state.recording||state.busy;
}});
async function safe(operation){try{await operation();}catch(error){recorder.error=error.message||String(error);recorder.paint();}}
for(const [id,operation] of [['start',()=>{recorder.evolution=!!element('evolution').checked;return recorder.start();}],['pause',()=>recorder.pause()],['export',()=>recorder.export()],['stop',()=>recorder.stop()]])element(id).addEventListener('click',()=>void safe(operation));
let interval;
entrypoints.setup({panels:{workproof:{
  show(){if(!interval)interval=setInterval(()=>void safe(()=>recorder.sample()),1000);recorder.paint();},
  hide(){if(interval)clearInterval(interval);interval=null;void safe(()=>recorder.hidden());},
  destroy(){if(interval)clearInterval(interval);interval=null;void recorder.dispose();}
}}});
