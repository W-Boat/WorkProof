import {savedRecordingUI} from '../frontend/saved-recording.js';
import {adapterIcon} from '../frontend/adapter-icons.js';
import {connectionConsent} from '../frontend/connection-consent.js';
// Independent owners must not release one another's interaction freeze.
const interactionLocks=new Set();
function syncInteractionLocks(){
  const blocked=interactionLocks.size>0;
  document.querySelector('main').inert=blocked;
  document.querySelector('.workspace-nav').inert=blocked||document.body.classList.contains('simple-writing');
}
function setInteractionLock(reason,locked){
  if(locked)interactionLocks.add(reason);else interactionLocks.delete(reason);
  syncInteractionLocks();
}
window.workproofSetInteractionLock=setInteractionLock;
window.workproofSyncInteractionLocks=syncInteractionLocks;
setInteractionLock('engine',true);
let last=-1;
let refreshing=false,engineReady=false,launching=false;
let visibleConnections=[],connectionsKnown=false;
document.body.dataset.platform=/Win/i.test(navigator.platform)?'windows':'other';
let closingAction=null,closeTask=null;
async function performWindowAction(action){
  if(action!=='close'&&action!=='quit'){
    try{await window.__TAURI__.core.invoke('window_action',{action});}catch(error){showMessage(errorText(error),'error');}
    return;
  }
  if(!closingAction||action==='quit')closingAction=action;
  if(closeTask)return closeTask;
  closeTask=Promise.resolve().then(async()=>{
    try{
      if(typeof window.workproofBeforeClose!=='function')throw new Error('工作台正在加载，请稍后再试。');
      await window.workproofBeforeClose();
      await window.__TAURI__.core.invoke('window_action',{action:closingAction});
    }catch(error){window.workproofCancelClose?.();showMessage(errorText(error),'error');}
    finally{closingAction=null;closeTask=null;}
  });
  return closeTask;
}
window.workproofTrayListeners=Promise.all([
  window.__TAURI__?.event?.listen('workproof-pairing-requested',()=>consent.checkNotice()),
  window.__TAURI__?.event?.listen('workproof-close-requested',()=>performWindowAction('close')),
  window.__TAURI__?.event?.listen('workproof-quit-requested',()=>performWindowAction('quit')),
  window.__TAURI__?.event?.listen('workproof-tray-view',event=>{
    if(['library','verification','connections','settings'].includes(event.payload))void requestView(event.payload);
  }),
]);
for(const button of document.querySelectorAll('[data-window]'))button.addEventListener('click',()=>performWindowAction(button.dataset.window));
const titlebar=document.querySelector('.app-header');
titlebar.addEventListener('mousedown',event=>{
  if(document.body.dataset.platform==='windows'&&event.button===0&&event.detail===1&&!event.target.closest('button,fluent-button,fluent-dropdown,a,input,select'))performWindowAction('drag');
});
titlebar.addEventListener('dblclick',event=>{
  if(document.body.dataset.platform==='windows'&&!event.target.closest('button,fluent-button,fluent-dropdown,a,input,select'))performWindowAction('maximize');
});
const appearance=document.getElementById('appearance-mode'),systemAppearance=matchMedia('(prefers-color-scheme: dark)');
let appearanceMode='system';
try{const saved=localStorage.getItem('workproof.appearance');if(['system','light','dark'].includes(saved))appearanceMode=saved;}catch{}
function applyAppearance(){document.documentElement.dataset.theme=appearanceMode==='system'?(systemAppearance.matches?'dark':'light'):appearanceMode;appearance.value=appearanceMode;sendVerifierAppearance();}
appearance.addEventListener('change',()=>{appearanceMode=appearance.value;applyAppearance();try{localStorage.setItem('workproof.appearance',appearanceMode);}catch{}});
systemAppearance.addEventListener('change',applyAppearance);applyAppearance();
function updateConnectionBadges(){
  const selected=document.getElementById('creation-tool').value;
  for(const badge of document.querySelectorAll('[data-connection]')){
    const source=badge.dataset.connection,count=visibleConnections.filter(value=>value.source===source).length;
    badge.textContent=!engineReady?'服务未就绪':!connectionsKnown?'待检查':count?'已允许':source==='vscode'||source==='blender'?'宿主内查看':'未允许';
    badge.title=count?'已允许此加载项连接，不表示软件当前仍在运行或正在记录。':'尚无有效的加载项连接授权。自动连接的软件请在宿主中查看状态。';
    badge.dataset.connected=String(engineReady&&connectionsKnown&&count>0);
    const button=badge.closest('button');button.classList.toggle('selected-tool',source===selected);
  }
  const count=visibleConnections.filter(value=>value.source===selected).length;
  const text=!engineReady?'记录服务未就绪':!connectionsKnown?'正在检查连接…':count?`已允许 ${count} 个连接 · 记录状态请在软件中查看`:selected==='vscode'||selected==='blender'?'此软件自动连接 · 请在软件中查看记录状态':'尚未连接 · 首次使用请先安装加载项';
  document.getElementById('selected-connection').textContent=text;
}
const launchIds=['open-word','open-powerpoint','install','check-office','install-office'];
function updateLaunchButtons(){for(const id of launchIds)document.getElementById(id).disabled=!engineReady||launching;}
const feedback=document.getElementById('message');
const feedbackText=document.createElement('span');feedbackText.id='message-text';
const feedbackDismiss=document.createElement('button');feedbackDismiss.id='dismiss-message';
feedbackDismiss.type='button';feedbackDismiss.setAttribute('aria-label','关闭提示');
const dismissIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');
dismissIcon.setAttribute('viewBox','0 0 20 20');dismissIcon.setAttribute('width','20');dismissIcon.setAttribute('height','20');dismissIcon.setAttribute('aria-hidden','true');
const dismissPath=document.createElementNS('http://www.w3.org/2000/svg','path');
dismissPath.setAttribute('d','M5.5 5.5l9 9m0-9l-9 9');dismissPath.setAttribute('fill','none');dismissPath.setAttribute('stroke','currentColor');dismissPath.setAttribute('stroke-width','1.5');dismissPath.setAttribute('stroke-linecap','round');
dismissIcon.append(dismissPath);feedbackDismiss.append(dismissIcon);
feedback.replaceChildren(feedbackText,feedbackDismiss);feedback.hidden=true;
let feedbackTimer=null,feedbackHovered=false,feedbackFocused=false,feedbackPreviousFocus=null;
function pauseFeedback(){clearTimeout(feedbackTimer);feedbackTimer=null;}
function dismissFeedback(){
  const restoreFocus=feedback.contains(document.activeElement);
  pauseFeedback();feedback.hidden=true;feedbackText.textContent='';feedbackFocused=false;feedbackHovered=false;
  if(restoreFocus){
    const target=feedbackPreviousFocus?.isConnected&&!feedbackPreviousFocus.closest('[inert],[hidden]')?feedbackPreviousFocus:document.querySelector('.workspace-nav [aria-current=page]');
    target?.focus({preventScroll:true});
  }
}
function scheduleFeedback(){
  pauseFeedback();
  if(!feedback.hidden&&feedback.dataset.state!=='error'&&!feedbackHovered&&!feedbackFocused)feedbackTimer=setTimeout(dismissFeedback,6000);
}
feedback.addEventListener('pointerenter',()=>{feedbackHovered=true;pauseFeedback();});
feedback.addEventListener('pointerleave',()=>{feedbackHovered=false;scheduleFeedback();});
feedback.addEventListener('focusin',()=>{feedbackFocused=true;pauseFeedback();});
feedback.addEventListener('focusout',event=>{if(!feedback.contains(event.relatedTarget)){feedbackFocused=false;scheduleFeedback();}});
feedbackDismiss.addEventListener('click',dismissFeedback);
function showMessage(text,state='info'){
  if(!text){dismissFeedback();return;}
  if(!feedback.contains(document.activeElement))feedbackPreviousFocus=document.activeElement;
  feedbackText.textContent=text;feedback.dataset.state=state;feedback.hidden=false;
  feedbackHovered=feedback.matches(':hover');feedbackFocused=feedback.contains(document.activeElement);
  scheduleFeedback();
}
const errorText=error=>error instanceof Error?error.message:String(error);
updateLaunchButtons();
const views={'external-document':['外部文档',''],library:['我的文档','开始写作，也能回到之前的编辑过程。'],document:['文档',''],verification:['文件核验','核对作品与证书，文件留在本机。'],connections:['应用连接','在熟悉的软件中创作，由 WorkProof 保存过程。'],settings:['设置','调整外观与记录方式。']};
function selectView(view,focus=false){
  if(!Object.hasOwn(views,view))view='library';
  document.body.dataset.view=view;
  for(const button of document.querySelectorAll('.workspace-nav [data-view]')){
    if(button.dataset.view===(['document','external-document'].includes(view)?'library':view))button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  document.getElementById('workspace-title').textContent=views[view][0];
  document.getElementById('workspace-description').textContent=views[view][1];
  document.querySelector('main').scrollTop=0;
  if(focus)document.getElementById('workspace-title').focus({preventScroll:true});
  updateConnectionBadges();
  window.dispatchEvent(new CustomEvent('workproof-view',{detail:view}));
}
let navigationRequest=0;
async function requestView(view){
  const request=++navigationRequest;
  try{
    if(view!==document.body.dataset.view&&await window.workproofUI.beforeNavigate?.()===false)return false;
    if(request!==navigationRequest)return false;
    selectView(view,true);
    drawerOpen=false;renderNavigation();
    return true;
  }catch(error){if(request===navigationRequest)showMessage(errorText(error),'error');return false;}
}
window.workproofUI={selectView,requestView,showMessage};
document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();void requestView('library');});
for(const button of document.querySelectorAll('.workspace-nav [data-view]'))button.addEventListener('click',()=>void requestView(button.dataset.view));
for(const button of document.querySelectorAll('[data-tool]'))button.addEventListener('click',()=>{
  if(launching)return;
  const select=document.getElementById('creation-tool');select.value=button.dataset.tool;select.dispatchEvent(new Event('change'));void requestView('connections');
});
const connectionCards=new Map();
const adapterName=source=>({word:'Word',powerpoint:'PowerPoint',wps:'WPS',vscode:'VS Code',photoshop:'Photoshop',blender:'Blender',krita:'Krita'}[source]||source);
const consent=connectionConsent({nameOf:adapterName,showMessage,onDecision:()=>refresh()});
const pairingInbox=document.createElement('fluent-button');pairingInbox.id='pairing-inbox';pairingInbox.dataset.keepLabel='true';pairingInbox.dataset.icon='plug_connected';pairingInbox.setAttribute('appearance','subtle');pairingInbox.hidden=true;document.getElementById('status').before(pairingInbox);
let latestRequests=[];pairingInbox.addEventListener('click',()=>{if(latestRequests.length)void consent.open(latestRequests[0].ticket);});
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
      const title=document.createElement('strong'),origin=document.createElement('p'),expiry=document.createElement('p'),button=document.createElement('fluent-button');
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
      const heading=document.createElement('div');heading.className='connection-card-heading';heading.append(adapterIcon(connection.source),title);card.append(heading,origin,expiry,button);connectionCards.set(connection.ticket,card);region.append(card);
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
    engineReady=s.ready===true;document.body.dataset.engineLoading=String(!engineReady);setInteractionLock('engine',!engineReady);document.getElementById('engine-loading').hidden=engineReady;updateLaunchButtons();
    document.getElementById('status').dataset.state=engineReady?'ready':'preparing';
    document.getElementById('status').textContent=s.ready?'记录服务已就绪':'正在准备记录服务…';
    window.dispatchEvent(new CustomEvent('workproof-engine',{detail:{ready:engineReady,sessions:s.sessions,events:s.events}}));
    document.getElementById('sessions').textContent=s.sessions.toLocaleString();
    document.getElementById('events').textContent=s.events.toLocaleString();
    document.querySelector('.trace').classList.toggle('active',last>=0&&s.events>last);last=s.events;
    const [requests,connections]=await Promise.all([window.__TAURI__.core.invoke('pending_adapters'),window.__TAURI__.core.invoke('adapter_connections')]);
    showConnections(connections);latestRequests=requests;if(pairingInbox.dataset.count!==String(requests.length)){pairingInbox.dataset.count=String(requests.length);pairingInbox.hidden=!requests.length;pairingInbox.textContent='连接申请 · '+requests.length;pairingInbox.setAttribute('aria-label','查看连接申请 · '+requests.length);}
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
        const heading=document.createElement('div');heading.className='connection-card-heading';heading.append(adapterIcon(request.source),title);card.append(heading,origin,note);
        const details=document.createElement('fluent-button');details.dataset.keepLabel='true';details.textContent='查看连接申请';details.setAttribute('aria-label','查看 '+adapterName(request.source)+' 连接申请');details.addEventListener('click',()=>void consent.open(request.ticket));card.append(details);
        for(const [text,approve] of [['允许连接',true],['拒绝',false]]){
          const button=document.createElement('fluent-button');button.textContent=text;
          button.addEventListener('click',async()=>{
            const buttons=Array.from(card.querySelectorAll('fluent-button'));for(const item of buttons)item.disabled=true;
            try{await window.__TAURI__.core.invoke('decide_adapter',{ticket:request.ticket,approve});await refresh();}
            catch(error){showMessage(errorText(error),'error');for(const item of buttons)item.disabled=false;}
          });card.append(button);
        }
        region.append(card);
      }
    }
    await consent.checkNotice();
  }catch{document.body.dataset.engineLoading='false';setInteractionLock('engine',false);document.getElementById('engine-loading').hidden=true;engineReady=false;connectionsKnown=false;updateLaunchButtons();updateConnectionBadges();const status=document.getElementById('status');status.dataset.state='error';status.textContent='暂时无法连接记录服务。请退出并重新打开 WorkProof。';}
  finally{refreshing=false;}
}
refresh();setInterval(refresh,1500);document.addEventListener('visibilitychange',refresh);
document.getElementById('refresh-connections').addEventListener('click',refresh);
for(const [id,command] of [['install','install_vscode'],['verify-browser','open_verifier_browser'],['open-word','open_word'],['open-powerpoint','open_powerpoint']]){
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
function sendVerifierAppearance(){window.dispatchEvent(new Event('workproof:appearance-changed'));}
const verifyButton=document.getElementById('verify'),verifierRoot=document.getElementById('desktop-verifier-root');
const verifierIntro=document.getElementById('verification-intro'),verifierControls=document.getElementById('verifier-controls');
const verifierFeedback=document.getElementById('verification-load-status');
let unmountVerifier=null;
verifyButton.addEventListener('click',async()=>{
  if(verifyButton.disabled)return;
  verifyButton.disabled=true;verifierFeedback.textContent='正在加载本机核验工具…';
  try{
    const {mountNativeVerifier}=await import('../frontend/native-verifier.tsx');
    unmountVerifier=mountNativeVerifier(verifierRoot);verifierRoot.hidden=false;
    verifierControls.hidden=false;verifierIntro.hidden=true;verifierFeedback.textContent='';
    document.getElementById('verifier-heading').focus({preventScroll:true});
  }catch{verifierFeedback.textContent='核验组件未能加载，请更新完整安装包或在浏览器中核验。';}
  finally{verifyButton.disabled=false;}
});
document.getElementById('close-verifier').addEventListener('click',()=>{
  unmountVerifier?.();unmountVerifier=null;verifierRoot.hidden=true;
  verifierControls.hidden=true;verifierIntro.hidden=false;verifyButton.focus();
});

const navPreference=document.getElementById('navigation-mode'),motionPreference=document.getElementById('reduce-motion');
const narrowNavigation=matchMedia('(max-width:640px)');
let navigationMode='auto',drawerOpen=false;
try{const saved=localStorage.getItem('workproof.navigation-mode'),legacy=localStorage.getItem('workproof.compact-nav');navigationMode=['auto','open','closed'].includes(saved)?saved:legacy===null?'auto':legacy==='true'?'closed':'open';}catch{}
function renderNavigation(){
  const compact=narrowNavigation.matches||navigationMode==='closed'||navigationMode==='auto'&&document.body.dataset.view==='document';
  document.body.classList.toggle('compact-nav',compact);
  document.body.classList.toggle('nav-drawer-open',narrowNavigation.matches&&drawerOpen);
  document.getElementById('nav-dismiss').hidden=!narrowNavigation.matches||!drawerOpen;
  const expanded=narrowNavigation.matches?drawerOpen:!compact;
  const toggle=document.getElementById('collapse-nav');toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',expanded?'收起侧栏':'展开侧栏');
  navPreference.value=navigationMode;
}
function saveNavigation(){try{localStorage.setItem('workproof.navigation-mode',navigationMode);}catch{}renderNavigation();}
function dismissNavigation(){if(!drawerOpen)return;drawerOpen=false;renderNavigation();document.getElementById('collapse-nav').focus();}
narrowNavigation.addEventListener('change',()=>{drawerOpen=narrowNavigation.matches&&navigationMode==='open';renderNavigation();});
document.getElementById('collapse-nav').addEventListener('click',()=>{if(narrowNavigation.matches){drawerOpen=!drawerOpen;navigationMode=drawerOpen?'open':'closed';}else navigationMode=document.body.classList.contains('compact-nav')?'open':'closed';saveNavigation();});
document.getElementById('nav-dismiss').addEventListener('click',dismissNavigation);
document.addEventListener('keydown',event=>{if(event.key==='Escape')dismissNavigation();});
navPreference.addEventListener('change',()=>{navigationMode=navPreference.value;drawerOpen=narrowNavigation.matches&&navigationMode==='open';saveNavigation();});
drawerOpen=narrowNavigation.matches&&navigationMode==='open';renderNavigation();
window.addEventListener('workproof-view',renderNavigation);
function applyMotion(){document.documentElement.dataset.reduceMotion=String(motionPreference.checked);try{localStorage.setItem('workproof.reduce-motion',String(motionPreference.checked));}catch{}sendVerifierAppearance();}
try{motionPreference.checked=localStorage.getItem('workproof.reduce-motion')==='true';}catch{}applyMotion();motionPreference.addEventListener('change',applyMotion);

const guides={
  illustrator:{steps:['在 Illustrator 打开并保存本地 .ai 作品，再选择同一份文件开始。','继续创作，WorkProof 定期采样路径和对象几何。切换作品会暂停当前记录。','完成后在 Illustrator 保存作品，再导出证书。'],note:'Windows 开发版。通过 Illustrator 脚本接口观察几何变化和文件保存。采样可能错过短时间内的变化，填充、效果和具体命令暂不覆盖。'},
  'sai2-file':{steps:['先在 SAI2 中保存作品，再选择下方“选择作品并开始”。','保持 WorkProof 运行，稳定后观察到的保存版本会写入本机记录。','完成后先在 SAI2 保存，再导出证书并结束；将原作品和证书一起交付。'],note:'这是文件保存版本观察，不是 SAI2 内部插件。不会采集图层、笔触或未保存的编辑，也不能证明文件由哪个进程写入。文件移动或无法读取时会暂停。'},
  word:{steps:['点击“打开 Word 并开始记录”。已有文档会继续使用，新文档会先提示保存。','首次使用时，在这里允许 Word 连接。Word 显示“已开始记录”后即可创作。','完成后在 Word 的 WorkProof 侧栏导出作品和证书，将两个文件一起交付。'],note:'Windows 桌面版 Word：先点击上方“检查安装状态”。未安装时，保存并退出 Word，再点击“安装 / 修复加载项”。安装后即可从这里打开 Word；也可以使用 Word 中的 WorkProof 标签。网页版和 Mac 需要单独安装网页加载项。'},
  powerpoint:{steps:['点击“打开 PowerPoint 并开始记录”，新演示文稿请先保存。','首次使用时在这里允许 PowerPoint 连接。侧栏显示已开始后再创作。','完成后在 PowerPoint 的 WorkProof 侧栏导出演示文稿和证书，一起交付。'],note:'需要 Windows 桌面版 PowerPoint。先点击上方“检查安装状态”。未安装时，保存并退出 PowerPoint，再点击“安装 / 修复加载项”；安装后从这里打开软件即可。'},
  wps:{steps:['打开 WPS 文档，在 WorkProof 标签中选择“打开记录工作台”。','点击开始记录，回到这里核对网址并允许连接。','完成后导出作品和证书，将这两个文件一起交付。'],note:'WPS 暂未提供面向普通用户的一键安装包，当前需按接入说明安装。没有安装入口时，请联系学校或团队。'},
  vscode:{steps:['先点击下方按钮，安装 WorkProof 插件。','打开文件，点击 VS Code 底部的 WorkProof，选择记录当前文件。','完成后导出证书，将它与这份作品一起交付。'],note:'需要先安装 VS Code。插件会自动连接本机的 WorkProof。'},
  photoshop:{steps:['先安装 WorkProof 插件，再从 Photoshop 的插件菜单打开它。','选择作品副本的位置，点击开始，并回到这里允许连接。','完成后导出 PSD 或 PSB 副本和证书，将这两个文件一起交付。'],note:'Photoshop 当前提供测试版插件文件，尚未提供正式的一键安装包。请交付本次导出的 PSD 或 PSB 副本。'},
  krita:{steps:['在 Krita 中导入 WorkProof Python 插件，启用后重启软件。','保存作品，在 WorkProof 面板点开始，再回到这里允许连接。','完成后从 Krita 面板保存并导出证书，将原作品和证书一起交付。'],note:'当前为 Krita 5.2 / Qt5 开发插件，需要手动导入 ZIP。首次安装请使用“工具 → 脚本 → 从文件导入 Python 插件”，在 Python 插件管理器启用并重启。画面采样不等于完整笔触记录。'},
  blender:{steps:['在 Blender 设置中选择“从磁盘安装”，导入 WorkProof 插件文件。','先保存工程，在侧栏 WorkProof 面板中点击开始记录。','完成后保存并导出，将工程和旁边的证书一起交付。'],note:'需要 Blender 4.2 或更新版本。插件会自动连接本机的 WorkProof。'}
};
const creationTool=document.getElementById('creation-tool');
const requirements={illustrator:'Windows · 记录本地 .ai 作品的几何摘要和保存版本。','sai2-file':'Windows · 仅记录已保存的 .sai2 文件版本，不记录逐笔绘画。',krita:'需要已启用 Python 插件的 Krita 5.2 / Qt5；开发版暂需手动安装。',word:'首次使用前，请先安装 Word 原生加载项。',powerpoint:'首次使用前，请先安装 PowerPoint 原生加载项。',wps:'当前需要手动接入，尚未提供一键安装包。',vscode:'先安装插件，再到 VS Code 中选择要记录的文件。',photoshop:'当前为测试版插件，需要手动安装。',blender:'适用于 Blender 4.2 及以上版本，需要安装插件。'};
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

// Immutable installer metadata comes from Rust's build, never the user's clock.
async function showBuildInformation(){
  try{
    const info=await window.__TAURI__.core.invoke('app_info');
    if(typeof info?.version!=='string'||typeof info.source!=='string'||typeof info.build_number!=='string')throw new Error('Missing build metadata');
    const epoch=Number(info.built_at),built=new Date(epoch*1000);
    if(!Number.isFinite(epoch)||epoch<=0||!Number.isFinite(built.getTime()))throw new Error('Invalid build time');
    document.getElementById('app-version').textContent=info.version;
    const source=info.source==='development'?'开发构建':info.source.slice(0,12);
    document.getElementById('app-build').textContent=info.build_number==='local'?source:`${info.build_number} · ${source}`;
    document.getElementById('app-build').title=info.source;
    document.getElementById('app-built-at').textContent=new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'long'}).format(built);
    document.getElementById('app-built-at').title=built.toISOString();
  }catch{
    for(const id of ['app-version','app-build','app-built-at'])document.getElementById(id).textContent='暂未读取';
  }
}
void showBuildInformation();

savedRecordingUI({ready:()=>engineReady,onSaved:()=>refresh()});
