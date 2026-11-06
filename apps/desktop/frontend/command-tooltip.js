// One shared tooltip keeps icon commands readable by pointer and keyboard.
const selector='fluent-button,button[data-icon],button[data-window]';
const shortcuts={undo:'Ctrl+Z',redo:'Ctrl+Y',bold:'Ctrl+B',italic:'Ctrl+I',underline:'Ctrl+U'};
const tooltip=document.createElement('div');
tooltip.id='workproof-command-tooltip';tooltip.className='command-tooltip';
tooltip.setAttribute('role','tooltip');tooltip.hidden=true;
document.body.append(tooltip);
let owner=null,showTimer=null,hideTimer=null;
function target(event){return event.composedPath().find(node=>node instanceof Element&&node.matches(selector));}
function preserveTitle(button){
  if(!button.title)return;
  button.dataset.tooltip=button.title;button.removeAttribute('title');
}
for(const button of document.querySelectorAll(selector))preserveTitle(button);
new MutationObserver(records=>{
  for(const record of records){
    if(record.type==='attributes')preserveTitle(record.target);
    else for(const node of record.addedNodes)if(node instanceof Element){
      if(node.matches(selector))preserveTitle(node);
      for(const button of node.querySelectorAll(selector))preserveTitle(button);
    }
  }
}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});
function hide(){
  clearTimeout(showTimer);clearTimeout(hideTimer);tooltip.hidden=true;
  if(owner){
    const ids=(owner.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tooltip.id);
    if(ids.length)owner.setAttribute('aria-describedby',ids.join(' '));else owner.removeAttribute('aria-describedby');
  }
  owner=null;
}
function position(){
  if(!owner?.isConnected){hide();return;}
  const rect=owner.getBoundingClientRect(),tip=tooltip.getBoundingClientRect(),gap=8;
  const side=owner.closest('.workspace-nav');
  let left=side?rect.right+gap:rect.left+(rect.width-tip.width)/2;
  let top=side?rect.top+(rect.height-tip.height)/2:rect.bottom+gap;
  if(top+tip.height>innerHeight-gap)top=rect.top-tip.height-gap;
  if(left+tip.width>innerWidth-gap)left=rect.right-tip.width;
  tooltip.style.left=`${Math.max(gap,Math.min(left,innerWidth-tip.width-gap))}px`;
  tooltip.style.top=`${Math.max(gap,top)}px`;
}
function show(button){
  if(!button.isConnected||button.closest('[inert]'))return;
  hide();owner=button;preserveTitle(button);
  const label=button.getAttribute('aria-label')||button.dataset.tooltip||button.textContent.trim();
  if(!label){owner=null;return;}
  const key=button.id==='save-document'?'Ctrl+S':shortcuts[button.dataset.command]||'';
  const name=document.createElement('span');name.textContent=label;tooltip.replaceChildren(name);
  if(key){const shortcut=document.createElement('kbd');shortcut.textContent=/Mac/i.test(navigator.platform)?key.replace('Ctrl','⌘'):key;tooltip.append(shortcut);}
  const ids=new Set((button.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));ids.add(tooltip.id);button.setAttribute('aria-describedby',[...ids].join(' '));
  tooltip.hidden=false;position();
}
function schedule(button,delay){clearTimeout(hideTimer);clearTimeout(showTimer);showTimer=setTimeout(()=>show(button),delay);}
function leave(){clearTimeout(showTimer);clearTimeout(hideTimer);hideTimer=setTimeout(hide,120);}
document.addEventListener('pointerover',event=>{const button=target(event);if(button&&!button.contains(event.relatedTarget))schedule(button,450);});
document.addEventListener('pointerout',event=>{const button=target(event);if(button&&!button.contains(event.relatedTarget)&&!tooltip.contains(event.relatedTarget))leave();});
document.addEventListener('focusin',event=>{const button=target(event);if(button)schedule(button,0);});
document.addEventListener('focusout',event=>{if(target(event))leave();});
document.addEventListener('pointerdown',hide);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
tooltip.addEventListener('pointerenter',()=>clearTimeout(hideTimer));tooltip.addEventListener('pointerleave',leave);
document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
