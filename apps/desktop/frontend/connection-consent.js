import {adapterIcon} from './adapter-icons.js';

export function connectionConsent({nameOf,showMessage,onDecision}){
  let dialog=null,current=null,busy=false;
  const invoke=(command,args)=>window.__TAURI__.core.invoke(command,args);
  function create(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='connection-consent';dialog.className='connection-consent';dialog.setAttribute('aria-labelledby','connection-consent-title');
    const heading=document.createElement('div');heading.className='connection-consent-heading';
    const title=document.createElement('h2');title.id='connection-consent-title';heading.append(title);
    const origin=document.createElement('p');origin.id='connection-consent-origin';origin.dataset.selectable='true';
    const note=document.createElement('p');note.id='connection-consent-note';
    const scope=document.createElement('p');scope.textContent='允许后，这个插件才能提交并导出自己的创作记录。它不能通过 WorkProof 读取本机其他文件。';
    const status=document.createElement('p');status.id='connection-consent-status';status.setAttribute('role','alert');
    const actions=document.createElement('div');actions.className='dialog-actions';
    for(const [action,label] of [['later','稍后处理'],['deny','拒绝'],['allow','允许连接']]){
      const button=document.createElement('fluent-button');button.textContent=label;button.dataset.keepLabel='true';button.dataset.decision=action;
      button.setAttribute('appearance',action==='allow'?'primary':action==='later'?'subtle':'secondary');
      button.addEventListener('click',async()=>{
        if(busy)return;if(action==='later'){dialog.close();return;}
        const ticket=current;busy=true;for(const item of actions.children)item.disabled=true;
        try{await invoke('decide_adapter',{ticket,approve:action==='allow'});dialog.close();await onDecision();}
        catch(error){status.textContent=error instanceof Error?error.message:String(error);}
        finally{busy=false;for(const item of actions.children)item.disabled=false;}
      });actions.append(button);
    }
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>{current=null;});
    dialog.append(heading,origin,note,scope,status,actions);document.body.append(dialog);
  }
  async function open(ticket){
    try{
      const requests=await invoke('pending_adapters'),request=requests.find(request=>request.ticket===ticket);
      if(!request){showMessage('这份连接申请已过期或已处理。请在插件中重新发起连接。');return;}
      create();
      if(dialog.open){if(current!==ticket)dialog.querySelector('#connection-consent-status').textContent='还有其他连接申请，请先处理当前申请。';return;}
      current=ticket;
      const title=dialog.querySelector('h2');title.textContent='允许 '+nameOf(request.source)+' 连接？';
      dialog.querySelector('.connection-consent-heading').replaceChildren(adapterIcon(request.source),title);
      dialog.querySelector('#connection-consent-origin').textContent=request.channel==='native'?'本机插件 · 发布者尚未认证':'来源地址：'+request.origin;
      dialog.querySelector('#connection-consent-note').textContent='请确认这是你刚在 '+nameOf(request.source)+' 中发起的连接。软件名称由插件自行提供。';
      dialog.querySelector('#connection-consent-status').textContent='';dialog.showModal();dialog.querySelector('[data-decision=later]').focus();
    }catch(error){showMessage(error instanceof Error?error.message:String(error),'error');}
  }
  async function checkNotice(){
    // Older/unsupported runtimes retain the prominent in-app request list.
    const ticket=await invoke('take_pairing_notice').catch(()=>null);if(ticket)await open(ticket);
  }
  return {open,checkNotice};
}
