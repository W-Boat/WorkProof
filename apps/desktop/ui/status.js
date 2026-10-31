let last=-1;
async function refresh(){
  if(document.hidden)return;
  try{
    const s=await window.__TAURI__.core.invoke('engine_status');
    document.getElementById('status').textContent=s.ready?'本地引擎就绪 · 等待或接收插件事件':'引擎正在启动';
    document.getElementById('sessions').textContent=s.sessions.toLocaleString();
    document.getElementById('events').textContent=s.events.toLocaleString();
    document.querySelector('.trace').classList.toggle('active',last>=0&&s.events>last);last=s.events;
  }catch{document.getElementById('status').textContent='无法读取引擎状态，请重启托盘程序。';}
}
refresh();setInterval(refresh,1500);document.addEventListener('visibilitychange',refresh);
for(const [id,command] of [['install','install_vscode'],['verify','open_verifier']]){
  document.getElementById(id).addEventListener('click',async()=>{
    const button=document.getElementById(id);button.disabled=true;
    const message=document.getElementById('message');message.textContent='正在处理…';
    try{const result=await window.__TAURI__.core.invoke(command);message.textContent=result||'核验工作台已在浏览器中打开。';}
    catch(error){message.textContent=String(error);}finally{button.disabled=false;}
  });
}
