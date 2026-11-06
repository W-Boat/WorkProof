import {Editor, generateHTML} from '@tiptap/core';
import {editorExtensions} from './editor-extensions.js';
import {initializeWritingWorkspace} from './writing-workspace.js';
import {groupActions} from './action-flow.mjs';

const $=id=>document.getElementById(id);
const ipc=(command,args)=>window.__TAURI__.core.invoke(command,args);
const ui=window.workproofUI;
const extensions=editorExtensions;
const labels={edit:'修改文字',format:'调整格式或结构',undo:'撤销修改',redo:'重做修改',copy:'复制命令',paste:'粘贴命令',cut:'剪切命令',backspace:'退格命令',delete_forward:'向后删除命令',space:'空格键',enter:'回车键',cursor:'移动光标',selection:'调整选区',focus:'回到编辑',blur:'离开编辑',transaction:'编辑器事务',keyboard:'键盘操作',input:'完成输入',beforeinput:'准备输入',compositionstart:'开始输入法合成',compositionupdate:'输入法合成',compositionend:'完成输入法合成',drop:'放入内容',dragstart:'开始拖动',dragend:'结束拖动',import:'导入 Word',layout:'切换页面布局'};
let editor=null,active=null,documents=[],pending=[],inflight=null,dirty=false,saving=null,saveTimer,maxSaveTimer,refreshTimer;
let suppressed=false,opening=false,exporting=false,intent=null,lastSelection='',selectionAt=0,historyToken=0;
let recentFrame=null;
let closing=false,editableBeforeClose=true,creating=false;
const workspace=initializeWritingWorkspace({getEditor:()=>editor,getActive:()=>active,record:addAction,hint,flush,showMessage:(...args)=>ui.showMessage(...args)});
const requestId=()=>crypto.randomUUID().replaceAll('-','');
const errorText=e=>e instanceof Error?e.message:String(e);
const time=ms=>new Date(ms).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fullText=doc=>doc.textBetween(0,doc.content.size,'\n');
function setEditable(value){const was=suppressed;suppressed=true;try{editor?.setEditable(value&&!closing,false);}finally{suppressed=was;}}
function state(text,kind='pending'){$('save-state').textContent=text;$('save-state').dataset.state=kind;$('editor-status').textContent=text;}
function changedText(before,after){
  const a=Array.from(before),b=Array.from(after);let prefix=0,suffix=0;
  while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  return {inserted:b.length-prefix-suffix,deleted:a.length-prefix-suffix,text:b.slice(prefix,b.length-suffix).join(''),chars:b.length};
}
function addAction(kind,extra={}){
  if(suppressed||!active||!editor||exporting)return;
  const selection=editor.state.selection;
  const action={kind,elapsed_ms:Math.max(0,Date.now()-active.created),inserted:0,deleted:0,chars:Array.from(editor.getText()).length,steps:[],selection:{from:selection.from,to:selection.to},detail:null,metrics:{},...extra};
  if(pending.length>=1024){setEditable(false);ui.showMessage('待保存的操作过多，编辑已暂停。请点击保存，成功后可继续。','error');}
  pending.push(action);dirty=true;state('待保存');if(recentFrame===null)recentFrame=requestAnimationFrame(()=>{recentFrame=null;renderRecent();});scheduleSave();
}
function commandAction(kind,key=kind){addAction(kind,{metrics:{[key]:1}});}
function hint(kind){intent={kind,at:performance.now()};}
function keydown(_view,event){
  addAction('keyboard',{detail:{key:event.key,code:event.code,repeat:event.repeat,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,composing:event.isComposing}});
  const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
  if(mod&&key==='s'){event.preventDefault();flush().catch(reportError);return true;}
  if(mod&&((key==='z'&&!event.shiftKey))){hint('undo');return false;}
  if(mod&&(key==='y'||key==='z'&&event.shiftKey)){hint('redo');return false;}
  if(mod&&['b','i','u'].includes(key)){hint('format');return false;}
  if(!event.isComposing){
    if(event.key==='Backspace')commandAction('backspace');
    else if(event.key==='Delete')commandAction('delete_forward');
    else if(event.key===' ')commandAction('space');
    else if(event.key==='Enter')commandAction('enter');
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))commandAction('cursor','cursor_moves');
  }
  return false;
}
function transaction({transaction:tr,editor:instance}){
  if(suppressed)return;
  const detail={doc_changed:tr.docChanged,selection_set:tr.selectionSet,stored_marks_set:tr.storedMarksSet,meta_keys:Object.keys(tr.meta||{}).slice(0,64)};
  if(!tr.docChanged){addAction(tr.selectionSet?'selection':'transaction',{detail,selection:{from:tr.selection.from,to:tr.selection.to}});return;}
  const delta=changedText(fullText(tr.before),fullText(tr.doc));
  let kind=intent&&performance.now()-intent.at<600?intent.kind:delta.inserted||delta.deleted?'edit':'format';intent=null;
  const metrics={};
  if(kind==='undo')metrics.undo_commands=1;else if(kind==='redo')metrics.redo_commands=1;else if(kind==='format')metrics.format_commands=1;
  const spaces=(delta.text.match(/ /g)||[]).length,lines=(delta.text.match(/\n/g)||[]).length;
  if(spaces)metrics.spaces_inserted=spaces;if(lines)metrics.line_breaks_inserted=lines;
  addAction(kind,{inserted:delta.inserted,deleted:delta.deleted,chars:delta.chars,steps:tr.steps.map(s=>s.toJSON()),selection:{from:tr.selection.from,to:tr.selection.to},detail,metrics});
  $('editor-word-count').textContent=`${delta.chars.toLocaleString()} 字符`;updateToolbar(instance);
  $('certificate-result').hidden=true;$('certificate-empty').hidden=false;
  workspace.changed();
}
function updateToolbar(instance=editor){
  if(!instance)return;
  for(const b of document.querySelectorAll('[data-command]')){
    const k=b.dataset.command;
    if(['bold','italic','underline','strike','subscript','superscript','bulletList','orderedList','taskList','blockquote','codeBlock'].includes(k))b.setAttribute('aria-pressed',String(instance.isActive(k)));
    if(k==='undo')b.disabled=!instance.can().undo();if(k==='redo')b.disabled=!instance.can().redo();
  }
  $('paragraph-style').value=instance.isActive('heading',{level:1})?'h1':instance.isActive('heading',{level:2})?'h2':instance.isActive('heading',{level:3})?'h3':'paragraph';
  $('text-align').value=instance.getAttributes('paragraph').textAlign||instance.getAttributes('heading').textAlign||'left';
  const textStyle=instance.getAttributes('textStyle');$('font-family').value=textStyle.fontFamily||'';$('font-size').value=textStyle.fontSize||'12pt';$('line-height').value=textStyle.lineHeight||'1.5';
}
function scheduleSave(){
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush().catch(reportError),650);
  if(!maxSaveTimer)maxSaveTimer=setTimeout(()=>{maxSaveTimer=null;flush().catch(reportError);},2000);
}
function reportError(error){state('未保存 · 请重试','error');ui.showMessage(errorText(error),'error');}
async function flush(){
  workspace.validate();
  clearTimeout(saveTimer);clearTimeout(maxSaveTimer);maxSaveTimer=null;
  if(saving){await saving;if(dirty||pending.length||inflight)return flush();return;}
  if(!active||(!dirty&&!pending.length&&!inflight))return;
  saving=(async()=>{
    state('正在保存…');
    while(dirty||pending.length||inflight){
      if(!inflight){
        const title=$('document-title').value.trim();if(!title||Array.from(title).length>120)throw new Error('请填写 1–120 字的文档名称。');
        inflight={id:active.id,expected_revision:active.revision,request_id:requestId(),title,content:editor.getJSON(),actions:pending.slice(0,256)};dirty=false;
      }
      const result=await ipc('editor_save',{input:inflight});
      if(!Number.isSafeInteger(result?.revision)||result.revision<active.revision)throw new Error('保存结果无法识别，请保留当前窗口并重试。');
      active.revision=result.revision;active.title=inflight.title;pending.splice(0,inflight.actions.length);inflight=null;
    }
    if(!exporting)setEditable(true);state('已保存到本机','saved');
    const id=active.id;
    try{const loaded=await ipc('editor_load',{id});if(active?.id===id){active={...active,...loaded};renderRecent();if(document.querySelector('[data-tab=process]').getAttribute('aria-selected')==='true')renderProcess();}}
    catch(error){ui.showMessage('文档已保存，但过程列表暂未刷新。'+errorText(error),'error');}
    clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>loadLibrary(),600);
  })();
  try{await saving;}finally{saving=null;}
}
window.workproofCancelClose=()=>{
  if(!closing)return;
  closing=false;workspace.setClosing(false);
  document.querySelector('main').inert=false;document.querySelector('.workspace-nav').inert=false;
  setEditable(editableBeforeClose||(!dirty&&!pending.length&&!inflight));
};
window.workproofBeforeClose=async()=>{
  // Let the editor observe the final browser input before freezing its DOM.
  await new Promise(resolve=>setTimeout(resolve,0));
  if(opening||creating||importing||exporting)throw new Error('文档正在打开、导入或导出，请完成后再关闭或退出。');
  if(editor?.view.composing)throw new Error('请先完成当前输入，再关闭或退出。');
  if(closing)return;
  editableBeforeClose=editor?.isEditable??true;closing=true;
  setEditable(false);workspace.setClosing(true);
  document.querySelector('main').inert=true;document.querySelector('.workspace-nav').inert=true;
  try{await flush();}
  catch(error){window.workproofCancelClose();reportError(error);throw new Error('文档尚未保存，窗口已保留。请重试保存后再关闭。');}
};
window.addEventListener('beforeunload',event=>{if(dirty||pending.length||inflight){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)flush().catch(reportError);});

async function openDocument(doc){
  if(opening||exporting)return;opening=true;
  try{
    await flush();workspace.closeSource();workspace.rememberPagination();suppressed=true;editor?.destroy();active=doc;pending=[];inflight=null;dirty=false;intent=null;lastSelection='';
    $('document-title').value=doc.title;
    const domEvents={keydown,copy:()=>{commandAction('copy');return false;},paste:()=>{commandAction('paste');return false;},cut:()=>{commandAction('cut');return false;},beforeinput:(_v,event)=>{addAction('beforeinput',{detail:{input_type:event.inputType}});if(event.inputType==='historyUndo')hint('undo');if(event.inputType==='historyRedo')hint('redo');return false;},input:(_v,event)=>{addAction('input',{detail:{input_type:event.inputType}});return false;},focus:()=>{addAction('focus');return false;},blur:()=>{addAction('blur');return false;}};
    for(const type of ['compositionstart','compositionupdate','compositionend','drop','dragstart','dragend'])domEvents[type]=(_v,event)=>{addAction(type,{detail:{data:typeof event.data==='string'?event.data.slice(0,2048):null}});return false;};
    editor=new Editor({element:$('tiptap-editor'),extensions:extensions(true),content:doc.content,editorProps:{attributes:{'aria-label':'文档正文',role:'textbox','aria-multiline':'true',spellcheck:'true'},handleDOMEvents:domEvents},onTransaction:transaction,onSelectionUpdate:({editor:e})=>updateToolbar(e)});
    restorePageLayout();workspace.applyMode();suppressed=false;workspace.changed();state('已保存到本机','saved');$('editor-word-count').textContent=`${Array.from(editor.getText()).length.toLocaleString()} 字符`;
    $('certificate-result').hidden=true;$('certificate-empty').hidden=false;renderRecent();updateToolbar();ui.selectView('document');selectTab('write');
  }catch(error){reportError(error);}finally{suppressed=false;opening=false;}
}
async function createDocument(){
  if(opening||creating||exporting||closing)return;
  creating=true;
  const buttons=[$('new-document'),$('first-document')];buttons.forEach(b=>b.disabled=true);
  try{await flush();const doc=await ipc('editor_create',{title:'未命名文档',started:new Date().toISOString()});await openDocument(doc);$('document-title').focus();$('document-title').select();await loadLibrary();}
  catch(error){ui.showMessage(errorText(error),'error');}finally{creating=false;buttons.forEach(b=>b.disabled=false);}
}
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function renderLibrary(){
  const query=($('document-search').value||'').trim().toLocaleLowerCase();$('document-list').replaceChildren();
  const filtered=documents.filter(d=>d.title.toLocaleLowerCase().includes(query));
  for(const doc of filtered){const row=element('div','document-row');row.setAttribute('role','listitem');const icon=element('i','glyph','\uE8A5');icon.setAttribute('aria-hidden','true');const label=element('div');label.append(element('strong','',doc.title),element('p','',`${new Date(doc.modified).toLocaleString('zh-CN')} · ${doc.revision+1} 个保存版本`));const open=element('fluent-button','','继续编辑');open.setAttribute('aria-label',`继续编辑 ${doc.title}`);open.addEventListener('click',async()=>{open.disabled=true;try{await flush();await openDocument(await ipc('editor_load',{id:doc.id}));}catch(error){ui.showMessage(errorText(error),'error');}finally{open.disabled=false;}});row.append(icon,label,open);$('document-list').append(row);}
  $('library-empty').hidden=documents.length>0;
  $('library-error').textContent=query&&!filtered.length?'没有找到这份文档。':'';
}
let listing=false;
async function loadLibrary(){
  if(listing)return;listing=true;
  try{const result=await ipc('editor_list');if(!Array.isArray(result))throw new Error('文档列表无法识别。');documents=result;renderLibrary();}
  catch(error){$('library-error').textContent=errorText(error);}finally{listing=false;}
}
let engineSeen=false;
window.addEventListener('workproof-engine',event=>{if(event.detail.ready&&!engineSeen){engineSeen=true;loadLibrary();}});
window.addEventListener('workproof-view',event=>{if(event.detail==='library')loadLibrary();});
$('new-document').addEventListener('click',createDocument);$('first-document').addEventListener('click',createDocument);$('reload-documents').addEventListener('click',loadLibrary);$('document-search').addEventListener('input',renderLibrary);
$('document-title').addEventListener('input',()=>{if(active){dirty=true;state('待保存');scheduleSave();$('certificate-result').hidden=true;$('certificate-empty').hidden=false;}});
$('back-library').addEventListener('click',async()=>{try{await flush();ui.selectView('library',true);}catch(error){reportError(error);}});
$('save-document').addEventListener('click',()=>flush().catch(reportError));

function allActions(){return [...pending].reverse().map(action=>({action,revision:active.revision+1})).concat(active?.actions||[]).slice(0,300);}
function eventItem(item,fresh=false){const a=item.action,entry=element('li',`event-item${fresh?' fresh':''}`),details=element('details','action-details'),summary=element('summary','',labels[a.kind]||a.kind);details.append(summary);const delta=a.inserted||a.deleted?` · +${a.inserted} / −${a.deleted} 字符`:'';details.append(element('small','',`${time(active.created+a.elapsed_ms)}${delta}`));const data=element('pre','',JSON.stringify({selection:a.selection,steps:a.steps,detail:a.detail},null,2));details.append(data);entry.append(details);return entry;}
const expandedFlows=new Set();
function flowItem(group){
  const entry=element('li','event-item'),details=element('details','action-details');details.dataset.flow=group.key;details.open=expandedFlows.has(group.key);
  details.append(element('summary','',`${group.label} - ${group.count}次`),element('small','',`${time(active.created+group.start)} – ${time(active.created+group.end)} · +${group.inserted} / −${group.deleted} 字符`));
  let populated=false;
  const populate=()=>{if(populated)return;populated=true;const list=element('ol','raw-actions');list.append(...group.items.map(item=>eventItem(item)));details.append(list);};
  if(details.open)populate();details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open){expandedFlows.add(group.key);populate();}else expandedFlows.delete(group.key);});entry.append(details);return entry;
}
function renderRecent(){
  if(!active)return;const actions=allActions(),groups=groupActions(actions);$('recent-actions').replaceChildren(...groups.slice(0,12).map(flowItem));$('no-actions').hidden=actions.length>0;$('action-count').textContent=`${groups.length} 段流程`;
}
function selectTab(tab){
  for(const button of document.querySelectorAll('[data-tab]')){const selected=button.dataset.tab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$(button.dataset.tab+'-panel').hidden=!selected;}
  if(tab==='process')flush().then(renderProcess).catch(reportError);
}
const tabs=[...document.querySelectorAll('[data-tab]')];tabs.forEach((b,i)=>{b.addEventListener('click',()=>selectTab(b.dataset.tab));b.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();selectTab(tabs[n].dataset.tab);tabs[n].focus();});});
$('view-process').addEventListener('click',()=>selectTab('process'));$('back-write').addEventListener('click',()=>selectTab('write'));
function renderProcess(){
  if(!active)return;const versions=[...(active.versions||[])].reverse(),actions=allActions();
  $('process-summary').textContent=`${active.revision+1} 个保存版本 · ${active.event_count} 条已保存记录（含起点与保存检查点）`;
  $('version-flow').replaceChildren();
  for(const [i,v] of versions.entries()){if(i)$('version-flow').append(element('span','version-edge'));const button=element('button','version-node',`版本 ${v.revision+1}`);button.setAttribute('aria-pressed',String(i===versions.length-1));button.append(element('small','',time(v.saved)));button.dataset.revision=v.revision;button.addEventListener('click',()=>showVersion(v.revision));$('version-flow').append(button);}
  const slider=$('version-slider');slider.max=Math.max(0,versions.length-1);slider.value=slider.max;slider.oninput=()=>{const v=versions[Number(slider.value)];if(v)showVersion(v.revision);};
  const groups=groupActions(actions);$('full-actions').replaceChildren(...groups.map(flowItem));
  $('action-route').replaceChildren(...[...groups].reverse().map(group=>{const button=element('button','flow-node',`${group.label} - ${group.count}次`);button.dataset.type=group.type;button.append(element('small','',time(active.created+group.start)));button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{for(const node of $('action-route').children)node.setAttribute('aria-pressed',String(node===button));$('flow-detail').replaceChildren(flowItem(group));if(group.revision<=active.revision)showVersion(group.revision);});return button;}));
  const counts=new Map();for(const group of groups){counts.set(group.label,(counts.get(group.label)||0)+group.count);}
  $('action-chart').replaceChildren();const ordered=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,8),max=Math.max(1,...ordered.map(x=>x[1]));
  for(const [label,count] of ordered){const row=element('div','chart-row'),track=element('div','chart-track'),fill=element('div','chart-fill');fill.style.width=`${count/max*100}%`;track.append(fill);row.append(element('span','',label),track,element('span','',String(count)));$('action-chart').append(row);}
  if(versions.length)showVersion(versions.at(-1).revision);
}
async function showVersion(revision){
  const token=++historyToken,id=active.id;
  try{const content=await ipc('editor_version',{id,revision});if(token!==historyToken||active?.id!==id)return;$('history-preview').innerHTML=generateHTML(content,extensions());$('history-version-label').textContent=`版本 ${revision+1}`;$('version-caption').textContent=`版本 ${revision+1} · 只读预览`;
    const versions=[...active.versions].reverse();$('version-slider').value=versions.findIndex(v=>v.revision===revision);for(const button of document.querySelectorAll('[data-revision]'))button.setAttribute('aria-pressed',String(Number(button.dataset.revision)===revision));
  }catch(error){ui.showMessage(errorText(error),'error');}
}
function paragraphAttributes(attrs){
  if(!editor)return;
  const {from,to}=editor.state.selection,tr=editor.state.tr;
  editor.state.doc.nodesBetween(from,to,(node,pos)=>{if(['paragraph','heading'].includes(node.type.name))tr.setNodeMarkup(pos,undefined,{...node.attrs,...attrs});});
  hint('format');editor.view.dispatch(tr);editor.commands.focus();
}
function indentParagraph(amount){
  const {from,to}=editor.state.selection,tr=editor.state.tr;
  editor.state.doc.nodesBetween(from,to,(node,pos)=>{if(['paragraph','heading'].includes(node.type.name))tr.setNodeMarkup(pos,undefined,{...node.attrs,indent:Math.max(0,Math.min(8,(node.attrs.indent||0)+amount))});});hint('format');editor.view.dispatch(tr);
}
const commands={undo:c=>c.undo(),redo:c=>c.redo(),bold:c=>c.toggleBold(),italic:c=>c.toggleItalic(),underline:c=>c.toggleUnderline(),strike:c=>c.toggleStrike(),subscript:c=>c.toggleSubscript(),superscript:c=>c.toggleSuperscript(),clear:c=>c.unsetAllMarks().clearNodes(),bulletList:c=>c.toggleBulletList(),orderedList:c=>c.toggleOrderedList(),taskList:c=>c.toggleTaskList(),blockquote:c=>c.toggleBlockquote(),table:c=>c.insertTable({rows:3,cols:3,withHeaderRow:true}),tableRow:c=>c.addRowAfter(),tableColumn:c=>c.addColumnAfter(),deleteRow:c=>c.deleteRow(),deleteColumn:c=>c.deleteColumn(),mergeCells:c=>c.mergeCells(),splitCell:c=>c.splitCell(),deleteTable:c=>c.deleteTable(),codeBlock:c=>c.toggleCodeBlock(),pageBreak:c=>c.insertPageBreak(),pages:c=>c.togglePagination()};
document.querySelectorAll('[data-command]').forEach(b=>{b.addEventListener('mousedown',event=>event.preventDefault());b.addEventListener('click',()=>{
  if(!editor||b.disabled)return;const command=b.dataset.command;if(!workspace.closeSource())return;
  try{
    if(command==='find'){workspace.openFind();return;}
    if(command==='image'){$('image-file').click();return;}
    if(command==='link'){$('link-url').value=editor.getAttributes('link').href||'';$('link-dialog').showModal();$('link-url').focus();return;}
    if(command==='print'){window.print();return;}
    if(command==='indent'||command==='outdent'){indentParagraph(command==='indent'?1:-1);return;}
    hint(['undo','redo'].includes(command)?command:'format');commands[command]?.(editor.chain().focus()).run();
    if(command==='pages'){workspace.rememberPagination();b.setAttribute('aria-pressed',String(editor.storage.PaginationPlus.enabled));addAction('layout',{detail:{command:'togglePagination'},metrics:{layout_changes:1}});}updateToolbar();
  }catch(error){ui.showMessage(errorText(error),'error');}
});});
$('font-family').addEventListener('change',event=>{if(!editor)return;hint('format');const chain=editor.chain().focus();(event.target.value?chain.setFontFamily(event.target.value):chain.unsetFontFamily()).run();});
$('font-size').addEventListener('change',event=>{if(editor){hint('format');editor.chain().focus().setFontSize(event.target.value).run();}});
$('line-height').addEventListener('change',event=>{if(editor){hint('format');editor.chain().focus().setLineHeight(event.target.value).run();}});
$('paragraph-space').addEventListener('change',event=>paragraphAttributes({spaceAfter:Number(event.target.value)}));
for(const [button,input,command] of [['text-color-button','text-color','setColor'],['highlight-button','highlight-color','setHighlight']]){
  $(button).addEventListener('click',()=>$(input).click());$(input).addEventListener('input',event=>{if(!editor)return;hint('format');editor.chain().focus()[command](command==='setHighlight'?{color:event.target.value}:event.target.value).run();});
}
$('link-cancel').addEventListener('click',()=>$('link-dialog').close());
$('link-confirm').addEventListener('click',event=>{event.preventDefault();const href=$('link-url').value.trim();if(href&&!/^(https?:\/\/|mailto:)/i.test(href)){ui.showMessage('请输入以 https://、http:// 或 mailto: 开头的链接。','error');return;}hint('format');const chain=editor.chain().focus().extendMarkRange('link');(href?chain.setLink({href}):chain.unsetLink()).run();$('link-dialog').close();});
$('image-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file||!editor)return;
  try{if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)||file.size>512*1024)throw new Error('请选择不超过 512 KB 的 PNG、JPEG、GIF 或 WebP 图片。');
    const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(file);});
    hint('format');editor.chain().focus().setImage({src,alt:file.name}).run();
  }catch(error){ui.showMessage(errorText(error),'error');}
});
$('writing-zoom').addEventListener('change',event=>{$('tiptap-editor').style.zoom=event.target.value;addAction('layout',{detail:{zoom:Number(event.target.value)}});});
function restorePageLayout(){
  const layout=editor?.state.doc.attrs.pageLayout||{size:'A4',orientation:'portrait',margin:'normal'};
  $('page-size').value=layout.size;$('page-orientation').value=layout.orientation;$('page-margin').value=layout.margin;
  applyPageLayout(layout);
}
function applyPageLayout(layout){
  if(!editor)return;const size=layout.size==='LETTER'?[680,880]:[680,960],landscape=layout.orientation==='landscape',margin={narrow:16,normal:32,wide:56}[layout.margin]||32;
  editor.commands.updatePageWidth(size[landscape?1:0]);editor.commands.updatePageHeight(size[landscape?0:1]);editor.commands.updateMargins({top:margin,bottom:margin,left:margin,right:margin});
}
for(const id of ['page-size','page-orientation','page-margin'])$(id).addEventListener('change',()=>{
  if(!editor)return;const layout={size:$('page-size').value,orientation:$('page-orientation').value,margin:$('page-margin').value};hint('layout');editor.view.dispatch(editor.state.tr.setDocAttribute('pageLayout',layout));applyPageLayout(layout);
});
$('paragraph-style').addEventListener('change',event=>{if(!editor)return;hint('format');const value=event.target.value,chain=editor.chain().focus();if(value==='paragraph')chain.setParagraph().run();else chain.setHeading({level:Number(value.slice(1))}).run();});
$('text-align').addEventListener('change',event=>{if(editor){hint('format');editor.chain().focus().setTextAlign(event.target.value).run();}});
async function exportDocument(){
  if(!active||exporting||closing)return;
  const buttons=[$('export-document'),$('export-from-certificate')];buttons.forEach(b=>b.disabled=true);
  try{workspace.validate();if(!workspace.closeSource())return;exporting=true;setEditable(false);await flush();let docx=null,markdown=null;if($('export-format').value==='docx'){const bytes=await wordOperation('export',{content:editor.getJSON()});docx=Array.from(bytes);}if($('export-format').value==='markdown'){markdown=workspace.markdownText();}const out=await ipc('editor_export',{id:active.id,docx,markdown});if(out?.cancelled)return;
    if(out?.saved!==true||out.report?.valid!==true||out.report?.file_match!==true||out.report?.signature_valid!==true||typeof out.html!=='string'||!/^[a-f0-9]{64}$/.test(out.fingerprint))throw new Error('导出结果未能确认，请不要交付未经核验的文件。');
    $('export-preview').srcdoc=out.html;$('exported-name').textContent=out.file_name;$('certificate-name').textContent=active.title;$('certificate-count').textContent=`${out.event_count} 条核验记录`;$('certificate-fingerprint').textContent=out.fingerprint;$('certificate-empty').hidden=true;$('certificate-result').hidden=false;selectTab('certificate');ui.showMessage('作品和证书已保存，请将两个文件一起交付。');
  }catch(error){ui.showMessage(errorText(error),'error');}finally{exporting=false;setEditable(true);buttons.forEach(b=>b.disabled=false);}
}
$('export-document').addEventListener('click',exportDocument);$('export-from-certificate').addEventListener('click',exportDocument);
$('copy-fingerprint').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('certificate-fingerprint').textContent);ui.showMessage('作品指纹已复制。');}catch{ui.showMessage('复制未完成，请选中完整指纹后按 Ctrl+C。','error');}});
function wordOperation(action,data){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('word-worker.js',document.baseURI),{type:'module'});
    const done=(error,result)=>{clearTimeout(timeout);worker.terminate();error?reject(new Error(error)):resolve(result);};
    const timeout=setTimeout(()=>done('Word 转换超时，已停止本次操作。原文档仍保留。'),20000);
    worker.onmessage=event=>{if(event.data.ready){worker.postMessage({action,...data});return;}done(event.data.error,event.data.result);};worker.onerror=()=>done('Word 插件未能加载，请更新完整安装包。');
  });
}
let importing=false;
$('import-word').addEventListener('click',()=>$('word-file').click());
$('word-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file||importing||opening||exporting)return;
  importing=true;$('import-word').disabled=true;
  try{
    if(!file.name.toLowerCase().endsWith('.docx')||file.size>8*1024*1024)throw new Error('请选择不超过 8 MB 的 .docx 文件。');
    await flush();const content=await wordOperation('import',{bytes:await file.arrayBuffer()});
    const title=file.name.replace(/\.docx$/i,'').slice(0,120)||'导入的 Word 文档';const doc=await ipc('editor_create',{title,started:new Date().toISOString()});await openDocument(doc);
    hint('import');editor.commands.setContent(content);await flush();ui.showMessage('Word 正文、常用格式和表格已导入，从现在开始记录。复杂版式请在 Word 中核对。');await loadLibrary();
  }catch(error){ui.showMessage(errorText(error),'error');}finally{importing=false;$('import-word').disabled=false;}
});
$('import-markdown').addEventListener('click',()=>$('markdown-file').click());
$('markdown-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file||importing||opening||exporting)return;importing=true;$('import-markdown').disabled=true;
  try{
    if(!/\.(md|markdown|txt)$/i.test(file.name)||file.size>512*1024)throw new Error('请选择不超过 512 KB 的 Markdown 或文本文件。');
    const text=await file.text();await flush();const doc=await ipc('editor_create',{title:file.name.replace(/\.(md|markdown|txt)$/i,'').slice(0,120)||'Markdown 文档',started:new Date().toISOString()});await openDocument(doc);
    const parsed=editor.schema.nodeFromJSON(editor.markdown.parse(text));hint('import');editor.view.dispatch(editor.state.tr.replaceWith(0,editor.state.doc.content.size,parsed.content).setDocAttribute('markdownSource',text));await flush();
    document.querySelector('[data-mode=markdown]').click();ui.showMessage('Markdown 已导入，从现在开始记录。');await loadLibrary();
  }catch(error){ui.showMessage(errorText(error),'error');}finally{importing=false;$('import-markdown').disabled=false;}
});
await loadLibrary();
