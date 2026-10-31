let last=-1;
async function refresh(){
  if(document.hidden)return;
  try{
    const s=await window.__TAURI__.core.invoke('engine_status');
    document.getElementById('status').textContent=s.ready?'本地引擎就绪 · 等待或接收插件事件':'引擎正在启动';
    document.getElementById('sessions').textContent=s.sessions.toLocaleString();
    document.getElementById('events').textContent=s.events.toLocaleString();
    document.querySelector('.trace').classList.toggle('active',last>=0&&s.events>last);last=s.events;
    const requests=await window.__TAURI__.core.invoke('pending_adapters');
    let region=document.getElementById('adapter-requests');
    if(!region){region=document.createElement('section');region.id='adapter-requests';document.getElementById('message').after(region);}
    const signature=JSON.stringify(requests);
    if(region.dataset.requests!==signature){
      region.dataset.requests=signature;region.replaceChildren();
      for(const request of requests){
        const card=document.createElement('div'),title=document.createElement('strong'),origin=document.createElement('p');
        title.textContent=`连接请求：${request.source}（网页声明）`;origin.textContent=request.origin;
        const note=document.createElement('p');note.textContent='仅允许你正在使用的加载项网址。此授权可创建该来源自己的记录，不授予本机文件访问。';
        card.append(title,origin,note);
        for(const [text,approve] of [['允许连接',true],['拒绝',false]]){
          const button=document.createElement('button');button.textContent=text;
          button.addEventListener('click',async()=>{try{await window.__TAURI__.core.invoke('decide_adapter',{ticket:request.ticket,approve});await refresh();}catch(error){document.getElementById('message').textContent=String(error);}});card.append(button);
        }
        region.append(card);
      }
    }
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
