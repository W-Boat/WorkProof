import {icon} from './icons.js';
const $=id=>document.getElementById(id);
const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};

export function initializeWorkspaceTools({commands,canOpen,onError,getEditor}){
  const trigger=node('fluent-button','workspace-command-trigger');trigger.id='workspace-commands';
  trigger.setAttribute('appearance','subtle');trigger.setAttribute('aria-label','快捷命令（Ctrl+K）');
  trigger.setAttribute('data-icon','search');trigger.textContent='快捷命令';
  document.querySelector('.app-header').insertBefore(trigger,document.querySelector('.window-controls'));
  const dialog=node('dialog','workspace-command-dialog');dialog.id='command-dialog';dialog.setAttribute('aria-labelledby','command-title');
  const heading=node('h2','','快捷命令');heading.id='command-title';
  const input=node('input','command-search');input.type='search';input.placeholder='搜索功能或文档';input.setAttribute('aria-label','搜索功能或文档');input.autocomplete='off';
  const list=node('ul','command-results');list.setAttribute('aria-label','可用命令');
  const empty=node('p','command-empty','没有找到。试试“新建”“查找”或文档名称。');empty.hidden=true;
  const note=node('p','command-help','↑ ↓ 选择 · Enter 执行 · Esc 关闭');
  dialog.append(heading,input,list,empty,note);document.body.append(dialog);
  let previous=null,busy=false,restoreFocus=true;
  const available=()=>commands().filter(command=>command.enabled!==false);
  function close(restore=true){restoreFocus=restore;if(dialog.open)dialog.close();}
  async function run(id){
    if(busy||!canOpen())return;
    const command=available().find(item=>item.id===id);if(!command)return;
    close(false);busy=true;
    try{await command.run();}catch(error){onError(error);}finally{busy=false;}
  }
  function render(){
    const query=input.value.trim().toLocaleLowerCase();list.replaceChildren();
    const found=available().filter(command=>`${command.title} ${command.description||''}`.toLocaleLowerCase().includes(query)).slice(0,30);
    for(const command of found){
      const li=node('li'),button=node('button','command-option');button.type='button';
      const copy=node('span','command-copy');copy.append(node('strong','',command.title));
      if(command.description)copy.append(node('span','command-description',command.description));
      button.append(icon(command.icon||'document'),copy);
      if(command.shortcut)button.append(node('kbd','',command.shortcut));
      button.addEventListener('click',()=>run(command.id));li.append(button);list.append(li);
    }
    empty.hidden=found.length>0;
  }
  function open(){if(busy||!canOpen()||document.querySelector('dialog[open]'))return;previous=document.activeElement;restoreFocus=true;input.value='';render();dialog.showModal();input.focus();}
  trigger.addEventListener('click',open);input.addEventListener('input',render);
  dialog.addEventListener('close',()=>{if(restoreFocus&&!document.querySelector('dialog[open]')&&previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true});});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
  dialog.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    const buttons=[...list.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!buttons.length)return;
      const next=index<0?(event.key==='ArrowDown'?0:buttons.length-1):(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();
    }else if(event.key==='Enter'&&event.target===input){event.preventDefault();buttons[0]?.click();}
    else if(event.key==='Escape'){event.preventDefault();close();}
  });
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.defaultPrevented||!canOpen())return;
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='k'){event.preventDefault();dialog.open?close():open();}
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='n'&&!document.querySelector('dialog[open]')){
      event.preventDefault();run('new');
    }
  });

  const stats=node('dialog','workspace-statistics');stats.id='document-statistics';stats.setAttribute('aria-labelledby','statistics-title');
  const statsTitle=node('h2','','文档统计');statsTitle.id='statistics-title';const values=node('dl','statistics-values');
  const done=node('fluent-button');done.setAttribute('appearance','primary');done.setAttribute('data-keep-label','true');done.textContent='完成';
  stats.append(statsTitle,values,node('p','statistics-note','只统计当前正文。英文词按连续字母统计，中文按汉字统计。'),done);document.body.append(stats);
  done.addEventListener('click',()=>stats.close());stats.addEventListener('close',()=>$('editor-word-count')?.focus({preventScroll:true}));
  function showStatistics(){
    const editor=getEditor();if(!editor||!canOpen()||document.querySelector('dialog[open]'))return;
    const text=editor.getText();let characters=0,nonblank=0,han=0,paragraphs=0;
    for(const character of text){characters++;if(!/\s/u.test(character))nonblank++;if(/\p{Script=Han}/u.test(character))han++;}
    editor.state.doc.descendants(item=>{if(['paragraph','heading'].includes(item.type.name)&&item.textContent.trim())paragraphs++;});
    const rows=[['字符（含空白）',characters],['非空白字符',nonblank],['汉字',han],['英文词',(text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[]).length],['文字段落（含标题）',paragraphs]];
    values.replaceChildren(...rows.map(([label,count])=>{const row=node('div');row.append(node('dt','',label),node('dd','',count.toLocaleString()));return row;}));stats.showModal();done.focus();
  }
  $('editor-word-count').addEventListener('click',showStatistics);
  return {open,showStatistics};
}
