let last=-1;
let refreshing=false,engineReady=false,launching=false;
let visibleConnections=[],connectionsKnown=false;
document.body.dataset.platform=/Win/i.test(navigator.platform)?'windows':'other';
async function performWindowAction(action){
  try{await window.__TAURI__.core.invoke('window_action',{action});}
  catch(error){showMessage(errorText(error),'error');}
}
for(const button of document.querySelectorAll('[data-window]'))button.addEventListener('click',()=>performWindowAction(button.dataset.window));
const titlebar=document.querySelector('.app-header');
titlebar.addEventListener('mousedown',event=>{
  if(document.body.dataset.platform==='windows'&&event.button===0&&event.detail===1&&!event.target.closest('button,a,input,select'))performWindowAction('drag');
});
titlebar.addEventListener('dblclick',event=>{
  if(document.body.dataset.platform==='windows'&&!event.target.closest('button,a,input,select'))performWindowAction('maximize');
});
const appearance=document.getElementById('appearance-mode'),systemAppearance=matchMedia('(prefers-color-scheme: dark)');
let appearanceMode='system';
try{const saved=localStorage.getItem('workproof.appearance');if(['system','light','dark'].includes(saved))appearanceMode=saved;}catch{}
function applyAppearance(){document.documentElement.dataset.theme=appearanceMode==='system'?(systemAppearance.matches?'dark':'light'):appearanceMode;appearance.value=appearanceMode;}
appearance.addEventListener('change',()=>{appearanceMode=appearance.value;applyAppearance();try{localStorage.setItem('workproof.appearance',appearanceMode);}catch{}});
systemAppearance.addEventListener('change',applyAppearance);applyAppearance();
function updateConnectionBadges(){
  const selected=document.getElementById('creation-tool').value;
  for(const badge of document.querySelectorAll('[data-connection]')){
    const source=badge.dataset.connection,count=visibleConnections.filter(value=>value.source===source).length;
    badge.textContent=!engineReady?'服务未就绪':!connectionsKnown?'待检查':count?'已连接':source==='vscode'||source==='blender'?'宿主内查看':'未连接';
    badge.dataset.connected=String(engineReady&&connectionsKnown&&count>0);
    const button=badge.closest('button');button.classList.toggle('selected-tool',document.body.dataset.view==='create'&&source===selected);
  }
  const count=visibleConnections.filter(value=>value.source===selected).length;
  const text=!engineReady?'记录服务未就绪':!connectionsKnown?'正在检查连接…':count?`已允许 ${count} 个连接 · 记录状态请在软件中查看`:selected==='vscode'||selected==='blender'?'此软件自动连接 · 请在软件中查看记录状态':'尚未连接 · 首次使用请先安装加载项';
  document.getElementById('selected-connection').textContent=text;
}
const launchIds=['open-word','open-powerpoint','install','check-office','install-office'];
function updateLaunchButtons(){for(const id of launchIds)document.getElementById(id).disabled=!engineReady||launching;}
function showMessage(text,state='info'){
  const message=document.getElementById('message');message.textContent=text;message.dataset.state=state;
  if(state==='error')message.scrollIntoView({block:'nearest',behavior:'auto'});
}
const errorText=error=>error instanceof Error?error.message:String(error);
updateLaunchButtons();
const views={create:['创作记录','选择软件，开始记录你的创作过程。'],verification:['证书核验','选择作品和证书，在 WorkProof 内完成核验与分享。'],connections:['连接管理','查看已允许的软件，或处理新的连接请求。'],settings:['设置与工具','本机运行说明与图片、PDF 证书工具。']};
function selectView(view,focus=false){
  if(!Object.hasOwn(views,view))view='create';
  document.body.dataset.view=view;
  for(const button of document.querySelectorAll('.workspace-nav button')){
    if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  document.getElementById('workspace-title').textContent=views[view][0];
  document.getElementById('workspace-description').textContent=views[view][1];
  document.querySelector('main').scrollTop=0;
  if(focus)document.getElementById('workspace-title').focus({preventScroll:true});
  updateConnectionBadges();
}
for(const button of document.querySelectorAll('.workspace-nav button[data-view]'))button.addEventListener('click',()=>selectView(button.dataset.view,true));
for(const button of document.querySelectorAll('.workspace-nav button[data-tool]'))button.addEventListener('click',()=>{
  const select=document.getElementById('creation-tool');select.value=button.dataset.tool;select.dispatchEvent(new Event('change'));selectView('create',true);
});
const connectionCards=new Map();
const adapterName=source=>({word:'Word',powerpoint:'PowerPoint',wps:'WPS',photoshop:'Photoshop'}[source]||source);
function showConnections(connections){
  visibleConnections=connections;connectionsKnown=true;updateConnectionBadges();
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
          showMessage('已断开连接。这个软件要再次获得允许才能继续提交记录；已经在处理的操作可能完成。已有记录不会删除。');
          await refresh();
        }catch(error){showMessage(errorText(error),'error');button.disabled=false;}
      });
      card.append(title,origin,expiry,button);connectionCards.set(connection.ticket,card);region.append(card);
    }
    const minutes=Math.ceil(connection.expires_in_seconds/60);
    card.querySelector('.connection-expiry').textContent=`已开始 ${connection.sessions} 份记录 · ${minutes>0?'约 '+minutes+' 分钟后需重新允许':'即将需要重新允许'}`;
  }
}
async function refresh(){
  if(document.hidden||refreshing)return;
  refreshing=true;
  try{
    const s=await window.__TAURI__.core.invoke('engine_status');
    engineReady=s.ready===true;updateLaunchButtons();
    document.getElementById('status').dataset.state=engineReady?'ready':'preparing';
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
          button.addEventListener('click',async()=>{
            const buttons=Array.from(card.querySelectorAll('button'));for(const item of buttons)item.disabled=true;
            try{await window.__TAURI__.core.invoke('decide_adapter',{ticket:request.ticket,approve});await refresh();}
            catch(error){showMessage(errorText(error),'error');for(const item of buttons)item.disabled=false;}
          });card.append(button);
        }
        region.append(card);
      }
    }
  }catch{engineReady=false;connectionsKnown=false;updateLaunchButtons();updateConnectionBadges();const status=document.getElementById('status');status.dataset.state='error';status.textContent='暂时无法连接记录服务。请退出并重新打开 WorkProof。';}
  finally{refreshing=false;}
}
refresh();setInterval(refresh,1500);document.addEventListener('visibilitychange',refresh);
document.getElementById('refresh-connections').addEventListener('click',refresh);
for(const [id,command] of [['install','install_vscode'],['verify','open_verifier'],['verify-browser','open_verifier_browser'],['open-word','open_word'],['open-powerpoint','open_powerpoint']]){
  document.getElementById(id).addEventListener('click',async()=>{
    const isLaunch=launchIds.includes(id);if(isLaunch&&(!engineReady||launching))return;
    const button=document.getElementById(id),label=button.textContent;
    if(isLaunch){launching=true;updateLaunchButtons();}else button.disabled=true;
    button.textContent=id==='install'?'正在安装插件…':id.startsWith('open-')?'正在打开软件…':'正在打开核验页…';
    showMessage(id.startsWith('open-')?'正在打开软件… 新作品请先保存；首次连接请回到这里允许连接。':'正在处理…');
    try{const result=await window.__TAURI__.core.invoke(command);showMessage(result||'操作已完成。');}
    catch(error){showMessage(errorText(error),'error');if(isLaunch)document.getElementById('installation-help').open=true;}
    finally{button.textContent=label;if(isLaunch){launching=false;updateLaunchButtons();}else button.disabled=false;}
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
const requirements={word:'首次使用前，请先安装 Word 原生加载项。',powerpoint:'首次使用前，请先安装 PowerPoint 原生加载项。',wps:'当前需要手动接入，尚未提供一键安装包。',vscode:'先安装插件，再到 VS Code 中选择要记录的文件。',photoshop:'当前为测试版插件，需要手动安装。',blender:'适用于 Blender 4.2 及以上版本，需要安装插件。'};
try{const saved=localStorage.getItem('workproof.creation-tool');if(Object.hasOwn(guides,saved))creationTool.value=saved;}catch{}
function showGuide(){const guide=guides[creationTool.value];const steps=document.getElementById('creation-steps');steps.replaceChildren();for(const text of guide.steps){const li=document.createElement('li');li.textContent=text;steps.append(li);}document.getElementById('installation-note').textContent=guide.note;document.getElementById('tool-requirement').textContent=requirements[creationTool.value];document.getElementById('install').hidden=creationTool.value!=='vscode';document.getElementById('open-word').hidden=creationTool.value!=='word';document.getElementById('open-powerpoint').hidden=creationTool.value!=='powerpoint';try{localStorage.setItem('workproof.creation-tool',creationTool.value);}catch{}}
creationTool.addEventListener('change',showGuide);showGuide();
creationTool.addEventListener('change',updateConnectionBadges);updateConnectionBadges();
function showOfficeSetup(){document.getElementById('office-setup').hidden=!['word','powerpoint'].includes(creationTool.value);document.getElementById('office-setup-result').textContent='首次使用可在这里检查并安装加载项。请先保存并退出对应的 Office 软件。';}
creationTool.addEventListener('change',showOfficeSetup);showOfficeSetup();
for(const id of ['check-office','install-office'])document.getElementById(id).addEventListener('click',async()=>{
  if(launching||!engineReady)return;
  const host=creationTool.value,install=id==='install-office';
  if(!['word','powerpoint'].includes(host))return;
  launching=true;updateLaunchButtons();creationTool.disabled=true;
  const result=document.getElementById('office-setup-result');result.textContent=install?'正在安装加载项，请稍候…':'正在检查安装状态…';
  try{
    const value=await window.__TAURI__.core.invoke('office_setup',{host,install});
    if(typeof value?.installed!=='boolean')throw new Error('安装状态无法识别，请更新完整配套包。');
    result.textContent=value.installed?(install?'加载项已安装。现在可以打开软件并开始记录。':'已检测到加载项注册。可打开软件，在 WorkProof 侧栏确认是否正常加载。'):'还没有安装加载项。点击“安装 / 修复加载项”继续。';
  }catch(error){result.textContent=errorText(error);}
  finally{launching=false;creationTool.disabled=false;updateLaunchButtons();}
});

document.getElementById('verify-image').addEventListener('click',async()=>{
  const button=document.getElementById('verify-image'),result=document.getElementById('image-result');
  button.disabled=true;result.textContent='请在系统窗口中依次选择作品和独立可信的 CA 文件；完成选择后核验通常需要几秒。';
  try{
    const report=await window.__TAURI__.core.invoke('verify_image');
    if(report.cancelled===true){result.textContent='已取消，本次没有核验。';return;}
    if(!['full','selective'].includes(report.scope)||!Number.isSafeInteger(report.disclosed)||!Number.isSafeInteger(report.total)||report.disclosed<0||report.disclosed>report.total)throw new Error('核验结果无法识别，请更新完整安装包。');
    result.textContent=report.scope==='selective'?`已披露的 ${report.disclosed} 条记录通过检查（全部记录共 ${report.total} 条）。作品匹配、签名及所选 CA 信任检查通过；未披露记录不在本次检查范围内。`:`作品匹配、签名、完整过程记录和所选 CA 信任检查通过，共 ${report.total} 条记录。`;
  }catch(error){result.textContent=String(error);}
  finally{button.disabled=false;}
});

const embedConsent=document.getElementById('embed-consent'),embedButton=document.getElementById('embed-image');
let embedding=false;
embedConsent.addEventListener('change',()=>{embedButton.disabled=embedding||!embedConsent.checked;});
embedButton.addEventListener('click',async()=>{
  const result=document.getElementById('embed-result');result.textContent='';
  if(!embedConsent.checked){result.textContent='请先确认同意公开证书中的过程信息。';return;}
  embedding=true;embedButton.disabled=true;embedConsent.disabled=true;
  result.textContent='请在系统窗口中依次选择原文件、创作证书、签名链、私钥和新的保存位置。可随时取消。';
  try{
    const report=await window.__TAURI__.core.invoke('embed_image',{consent:true});
    if(report.cancelled===true){result.textContent='已取消，没有生成新文件。';return;}
    if(!['full','selective'].includes(report.scope)||!Number.isSafeInteger(report.disclosed)||!Number.isSafeInteger(report.total)||report.disclosed<2||report.disclosed>report.total)throw new Error('返回结果无法识别，请检查输出位置，不要直接交付未核验文件。');
    result.textContent=`新文件已生成，包含${report.scope==='selective'?'选择性披露的':'完整的'} ${report.disclosed} 条过程记录。它尚未通过独立可信 CA 核验；请使用上方入口检查后再交付。`;
  }catch(error){result.textContent=String(error);}
  finally{embedding=false;embedConsent.checked=false;embedConsent.disabled=false;embedButton.disabled=true;}
});
