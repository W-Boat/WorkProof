let last=-1;
const connectionCards=new Map();
const adapterName=source=>({word:'Word',wps:'WPS',photoshop:'Photoshop'}[source]||source);
function showConnections(connections){
  const region=document.getElementById('adapter-connections');
  if(!region)return;
  document.getElementById('no-connections').hidden=connections.length>0;
  const live=new Set(connections.map(connection=>connection.ticket));
  for(const [ticket,card] of connectionCards){if(!live.has(ticket)){card.remove();connectionCards.delete(ticket);}}
  for(const connection of connections){
    let card=connectionCards.get(connection.ticket);
    if(!card){
      card=document.createElement('div');card.className='connection-card';
      const title=document.createElement('strong'),origin=document.createElement('p'),expiry=document.createElement('p'),button=document.createElement('button');
      title.textContent=adapterName(connection.source)+' · 已允许连接';
      origin.textContent=connection.channel==='native'?'本机插件自声明 · 身份未认证':connection.origin;
      expiry.className='connection-expiry';button.textContent='断开 '+adapterName(connection.source)+' 连接';
      button.addEventListener('click',async()=>{
        button.disabled=true;
        try{
          await window.__TAURI__.core.invoke('revoke_adapter',{ticket:connection.ticket});
          document.getElementById('message').textContent='已撤销连接。后续请求将被拒绝；正在处理的请求可能完成，已有记录不会删除。重新使用时需再次批准。';
          await refresh();
        }catch(error){document.getElementById('message').textContent=String(error);button.disabled=false;}
      });
      card.append(title,origin,expiry,button);connectionCards.set(connection.ticket,card);region.append(card);
    }
    const minutes=Math.ceil(connection.expires_in_seconds/60);
    card.querySelector('.connection-expiry').textContent=`${connection.sessions} 个记录会话 · ${minutes>0?'约 '+minutes+' 分钟后到期':'即将到期'}`;
  }
}
async function refresh(){
  if(document.hidden)return;
  try{
    const s=await window.__TAURI__.core.invoke('engine_status');
    document.getElementById('status').textContent=s.ready?'本地引擎就绪 · 等待或接收插件事件':'引擎正在启动';
    document.getElementById('sessions').textContent=s.sessions.toLocaleString();
    document.getElementById('events').textContent=s.events.toLocaleString();
    document.querySelector('.trace').classList.toggle('active',last>=0&&s.events>last);last=s.events;
    const [requests,connections]=await Promise.all([window.__TAURI__.core.invoke('pending_adapters'),window.__TAURI__.core.invoke('adapter_connections')]);
    showConnections(connections);
    let region=document.getElementById('adapter-requests');
    if(!region){region=document.createElement('section');region.id='adapter-requests';document.getElementById('message').after(region);}
    const signature=JSON.stringify(requests);
    if(region.dataset.requests!==signature){
      region.dataset.requests=signature;region.replaceChildren();
      for(const request of requests){
        const card=document.createElement('div'),title=document.createElement('strong'),origin=document.createElement('p');
        const native=request.channel==='native';
        title.textContent=`连接请求：${request.source}（${native?'本机插件自声明':'网页声明'}）`;origin.textContent=native?'本机原生连接 · 无网站来源':request.origin;
        const note=document.createElement('p');note.textContent=native?'仅当你刚在 Photoshop 中点击连接时允许。插件身份未认证，此授权仅操作自己的会话，不授予本机路径读取。':'仅允许你正在使用的加载项网址。此授权可创建该来源自己的记录，不授予本机文件访问。';
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
