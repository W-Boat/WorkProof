// One lifecycle for app-owned dialogs. Keep native close/returnValue/focus
// semantics; defer the close event until the exit animation has completed.
const registered=new WeakMap();
const pending=new WeakMap();
const reduced=()=>document.documentElement.dataset.reduceMotion==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches;
function closeDialog(dialog,value){
  const nativeClose=registered.get(dialog);
  if(!nativeClose||!dialog.open)return Promise.resolve();
  if(pending.has(dialog))return pending.get(dialog);
  const wasInert=dialog.inert;dialog.inert=true;dialog.dataset.dialogClosing='true';
  const state=getComputedStyle(dialog);
  const animation=reduced()?null:dialog.animate([{opacity:state.opacity,transform:state.transform},{opacity:0,transform:'translateY(4px) scale(.99)'}],{duration:140,easing:'cubic-bezier(.3,0,1,1)',fill:'forwards'});
  const task=(async()=>{
    try{if(animation)await animation.finished;else await Promise.resolve();}catch{}finally{
      try{nativeClose(value);}finally{animation?.cancel();dialog.inert=wasInert;delete dialog.dataset.dialogClosing;pending.delete(dialog);}
    }
  })();pending.set(dialog,task);return task;
}
function register(dialog){
  if(registered.has(dialog))return;
  registered.set(dialog,dialog.close.bind(dialog));
  dialog.close=value=>{void closeDialog(dialog,value);};
  dialog.addEventListener('cancel',event=>{
    event.preventDefault();if(dialog.dataset.closeBlocked!=='true')void closeDialog(dialog);
  });
  dialog.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    if((event.submitter?.getAttribute('formmethod')||form.method)!=='dialog'||event.defaultPrevented)return;
    event.preventDefault();if(dialog.dataset.closeBlocked!=='true')void closeDialog(dialog,event.submitter?.value||'');
  });
}
document.querySelectorAll('dialog').forEach(register);
new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element){if(node.matches('dialog'))register(node);node.querySelectorAll('dialog').forEach(register);}}).observe(document.body,{subtree:true,childList:true});
window.workproofCloseDialog=(dialog,value)=>{
  if(!(dialog instanceof HTMLDialogElement)||dialog.ownerDocument!==document)return Promise.reject(new Error('无效的应用对话框。'));
  register(dialog);return closeDialog(dialog,value);
};
