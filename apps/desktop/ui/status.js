let last=-1;
const connectionCards=new Map();
const adapterName=source=>({word:'Word',powerpoint:'PowerPoint',wps:'WPS',photoshop:'Photoshop'}[source]||source);
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
      origin.textContent=connection.channel==='native'?'插件称自己来自本机，尚未确认发布者。':connection.origin;
      expiry.className='connection-expiry';button.textContent='断开 '+adapterName(connection.source)+' 连接';
      button.addEventListener('click',async()=>{
        button.disabled=true;
        try{
          await window.__TAURI__.core.invoke('revoke_adapter',{ticket:connection.ticket});
          document.getElementById('message').textContent='已断开连接。这个软件要再次获得允许才能继续提交记录；已经在处理的操作可能完成。已有记录不会删除。';
          await refresh();
        }catch(error){document.getElementById('message').textContent=String(error);button.disabled=false;}
      });
      card.append(title,origin,expiry,button);connectionCards.set(connection.ticket,card);region.append(card);
    }
    const minutes=Math.ceil(connection.expires_in_seconds/60);
    card.querySelector('.connection-expiry').textContent=`已开始 ${connection.sessions} 份记录 · ${minutes>0?'约 '+minutes+' 分钟后需重新允许':'即将需要重新允许'}`;
  }
}
async function refresh(){
  if(document.hidden)return;
  try{
    const s=await window.__TAURI__.core.invoke('engine_status');
    document.getElementById('status').textContent=s.ready?'WorkProof 已就绪，可以开始记录。':'正在准备记录服务…';
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
        title.textContent=`${adapterName(request.source)} 想连接 WorkProof`;origin.textContent=native?'插件称自己来自本机，尚未确认发布者。':request.origin;
        const note=document.createElement('p');note.textContent=native?`请只允许你刚在 ${adapterName(request.source)} 中发起的连接。这次允许只用于提交和导出它自己的记录，不允许通过 WorkProof 读取本机文件。`:'请确认下面的网址属于你刚打开的加载项。这次允许只用于提交和导出它自己的记录，不允许通过 WorkProof 读取本机文件。';
        card.append(title,origin,note);
        for(const [text,approve] of [['允许连接',true],['拒绝',false]]){
          const button=document.createElement('button');button.textContent=text;
          button.addEventListener('click',async()=>{try{await window.__TAURI__.core.invoke('decide_adapter',{ticket:request.ticket,approve});await refresh();}catch(error){document.getElementById('message').textContent=String(error);}});card.append(button);
        }
        region.append(card);
      }
    }
  }catch{document.getElementById('status').textContent='暂时无法连接记录服务。请退出并重新打开 WorkProof。';}
}
refresh();setInterval(refresh,1500);document.addEventListener('visibilitychange',refresh);
for(const [id,command] of [['install','install_vscode'],['verify','open_verifier'],['open-word','open_word'],['open-powerpoint','open_powerpoint']]){
  document.getElementById(id).addEventListener('click',async()=>{
    const button=document.getElementById(id);button.disabled=true;
    const message=document.getElementById('message');message.textContent=id.startsWith('open-')?'正在打开软件… 新作品请先保存；首次连接请回到这里允许连接。':'正在处理…';
    try{const result=await window.__TAURI__.core.invoke(command);message.textContent=result||'已请求系统浏览器打开检查页面。';}
    catch(error){message.textContent=String(error);}finally{button.disabled=false;}
  });
}

const guides={
  word:{steps:['点击“打开 Word 并开始记录”。已有文档会继续使用，新文档会先提示保存。','首次使用时，在这里允许 Word 连接。Word 显示“已开始记录”后即可创作。','完成后在 Word 的 WorkProof 侧栏导出作品和证书，将两个文件一起交付。'],note:'Windows 桌面版 Word 需先双击安装包中的 Install Word.cmd。你也可以在 Word 的 WorkProof 标签中手动开始。网页版和 Mac 使用单独的网页加载项安装方式。'},
  powerpoint:{steps:['点击“打开 PowerPoint 并开始记录”，新演示文稿请先保存。','首次使用时在这里允许 PowerPoint 连接。侧栏显示已开始后再创作。','完成后在 PowerPoint 的 WorkProof 侧栏导出演示文稿和证书，一起交付。'],note:'需要 Windows 桌面版 PowerPoint 和对应的 WorkProof 原生加载项。请先安装完整包。'},
  wps:{steps:['打开 WPS 文档，在 WorkProof 标签中选择“打开记录工作台”。','点击开始记录，回到这里核对网址并允许连接。','完成后导出作品和证书，将这两个文件一起交付。'],note:'WPS 暂未提供面向普通用户的一键安装包，当前需按接入说明安装。没有安装入口时，请联系学校或团队。'},
  vscode:{steps:['先点击下方按钮，安装 WorkProof 插件。','打开文件，点击 VS Code 底部的 WorkProof，选择记录当前文件。','完成后导出证书，将它与这份作品一起交付。'],note:'需要先安装 VS Code。插件会自动连接本机的 WorkProof。'},
  photoshop:{steps:['先安装 WorkProof 插件，再从 Photoshop 的插件菜单打开它。','选择作品副本的位置，点击开始，并回到这里允许连接。','完成后导出 PSD 副本和证书，将这两个文件一起交付。'],note:'Photoshop 当前提供测试版插件文件，尚未提供正式的一键安装包。请交付本次导出的 PSD 副本。'},
  blender:{steps:['在 Blender 设置中选择“从磁盘安装”，导入 WorkProof 插件文件。','先保存工程，在侧栏 WorkProof 面板中点击开始记录。','完成后保存并导出，将工程和旁边的证书一起交付。'],note:'需要 Blender 4.2 或更新版本。插件会自动连接本机的 WorkProof。'}
};
const creationTool=document.getElementById('creation-tool');
function showGuide(){const guide=guides[creationTool.value];const steps=document.getElementById('creation-steps');steps.replaceChildren();for(const text of guide.steps){const li=document.createElement('li');li.textContent=text;steps.append(li);}document.getElementById('installation-note').textContent=guide.note;document.getElementById('install').hidden=creationTool.value!=='vscode';document.getElementById('open-word').hidden=creationTool.value!=='word';document.getElementById('open-powerpoint').hidden=creationTool.value!=='powerpoint';}
creationTool.addEventListener('change',showGuide);showGuide();
