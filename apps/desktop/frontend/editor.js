import {adapterIcon} from './adapter-icons.js';
import {initializeWritingWorkspace} from './writing-workspace.js';
import {groupActions} from './action-flow.mjs';
import {externalRecords,sourceLabel,groupExternalDocuments,displayTime} from './external-records.js';
import {icon} from './icons.js';
import {draftTemplates} from './draft-templates.js';
import {initializeWorkspaceTools} from './workspace-tools.js';

const $=id=>document.getElementById(id);
const ipc=(command,args)=>window.__TAURI__.core.invoke(command,args);
const ui=window.workproofUI;
let editorRuntime=null,runtimeLoading=null;
async function loadEditorRuntime(){
  if(editorRuntime)return editorRuntime;
  if(!runtimeLoading)runtimeLoading=import('./editor-runtime.js');
  try{editorRuntime=await runtimeLoading;return editorRuntime;}
  catch(error){runtimeLoading=null;throw error;}
}
const labels={edit:'修改文字',format:'调整格式或结构',undo:'撤销修改',redo:'重做修改',copy:'复制命令',paste:'粘贴命令',cut:'剪切命令',backspace:'退格命令',delete_forward:'向后删除命令',space:'空格键',enter:'回车键',cursor:'移动光标',selection:'调整选区',focus:'回到编辑',blur:'离开编辑',transaction:'编辑器事务',keyboard:'键盘操作',input:'完成输入',beforeinput:'准备输入',compositionstart:'开始输入法合成',compositionupdate:'输入法合成',compositionend:'完成输入法合成',drop:'放入内容',dragstart:'开始拖动',dragend:'结束拖动',import:'导入内容',layout:'切换页面布局'};
let editor=null,active=null,documents=[],pending=[],inflight=null,dirty=false,saving=null,saveTimer,maxSaveTimer,refreshTimer;
let externalDocuments=[],libraryLoadError='',libraryStates={};
$('library-state-filter').addEventListener('change',renderLibrary);
let suppressed=false,opening=false,exporting=false,intent=null,lastSelection='',selectionAt=0,historyToken=0,selectedVersion=null;
let recentFrame=null;
let linkContext=null;
let closing=false,editableBeforeClose=true,creating=false;
const workspace=initializeWritingWorkspace({getEditor:()=>editor,getActive:()=>active,record:addAction,hint,flush,showMessage:(...args)=>ui.showMessage(...args)});
const externalLibrary=externalRecords({ipc,flush,ui});
const requestId=()=>crypto.randomUUID().replaceAll('-','');
const errorText=e=>e instanceof Error?e.message:String(e);
const time=ms=>new Date(ms).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fullText=doc=>doc.textBetween(0,doc.content.size,'\n');
// A selection or keyboard event does not change ProseMirror's immutable doc.
// Keep only the current document count; never cache historical document text.
let characterSnapshot=null;
function editorCharacters(){
  const doc=editor.state.doc;
  if(characterSnapshot?.owner===editor&&characterSnapshot.doc===doc)return characterSnapshot.count;
  let count=0;for(const character of editor.getText())count++;
  characterSnapshot={owner:editor,doc,count};return count;
}

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
  const action={kind,elapsed_ms:Math.max(0,Date.now()-active.created),inserted:0,deleted:0,chars:Object.hasOwn(extra,'chars')?extra.chars:editorCharacters(),steps:[],selection:{from:selection.from,to:selection.to},detail:null,metrics:{},...extra};
  if(pending.length>=1024){setEditable(false);ui.showMessage('待保存的操作过多，编辑已暂停。请点击保存，成功后可继续。','error');}
  pending.push(action);dirty=true;state('待保存');if(recentFrame===null)recentFrame=requestAnimationFrame(()=>{recentFrame=null;renderRecent();});scheduleSave();
}
function commandAction(kind,key=kind){addAction(kind,{metrics:{[key]:1}});}
function hint(kind){intent={kind,at:performance.now()};}
function keydown(_view,event){
  addAction('keyboard',{detail:{key:event.key,code:event.code,repeat:event.repeat,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,composing:event.isComposing}});
  const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
  if(mod&&key==='s'){event.preventDefault();flush().catch(reportError);return true;}
  if(mod&&key==='k'){event.preventDefault();openLinkDialog();return true;}
  if(mod&&(key==='f'||key==='h')){event.preventDefault();workspace.openFind(key==='h');return true;}
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
  if(tr.getMeta('workproofTemplate'))Object.assign(detail,{source:'builtin-template',template_id:tr.getMeta('workproofTemplate')});
  if(!tr.docChanged){addAction(tr.selectionSet?'selection':'transaction',{detail,selection:{from:tr.selection.from,to:tr.selection.to}});if(tr.storedMarksSet)updateToolbar(instance);return;}
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
function setSelectState(control,values){
  const selected=[...new Set(values)],value=selected.length===1?String(selected[0]):'__mixed';
  control.querySelector('[data-selection-value]')?.remove();
  if(![...control.options].some(option=>option.value===value)){
    const option=document.createElement('option');option.value=value;option.textContent=value==='__mixed'?'多种格式':value;option.disabled=true;option.dataset.selectionValue='true';control.prepend(option);
  }
  control.value=value;control.dataset.mixed=String(value==='__mixed');
}
function updateToolbar(instance=editor){
  if(!instance)return;
  const {selection,doc,storedMarks}=instance.state,styles=[],markSets=[],paragraphs=[];
  if(selection.empty){const marks=storedMarks||selection.$from.marks();styles.push(marks.find(mark=>mark.type.name==='textStyle')?.attrs||{});markSets.push(new Set(marks.map(mark=>mark.type.name)));}
  doc.nodesBetween(selection.from,selection.to,(node,pos)=>{
    if(node.isText&&!selection.empty&&pos+node.nodeSize>selection.from){styles.push(node.marks.find(mark=>mark.type.name==='textStyle')?.attrs||{});markSets.push(new Set(node.marks.map(mark=>mark.type.name)));}
    if(['paragraph','heading'].includes(node.type.name))paragraphs.push(node);
  });
  if(!styles.length)styles.push({});
  for(const b of document.querySelectorAll('[data-command]')){
    const k=b.dataset.command;
    if(['bold','italic','underline','strike','subscript','superscript','bulletList','orderedList','taskList','blockquote','codeBlock'].includes(k))b.setAttribute('aria-pressed',String(instance.isActive(k)));
    if(['bold','italic','underline','strike','subscript','superscript'].includes(k)&&markSets.length){const activeMarks=markSets.filter(marks=>marks.has(k)).length;b.setAttribute('aria-pressed',activeMarks===0?'false':activeMarks===markSets.length?'true':'mixed');}
    if(k==='undo')b.disabled=!instance.can().undo();if(k==='redo')b.disabled=!instance.can().redo();
    const tableCommands={tableRow:'addRowAfter',tableColumn:'addColumnAfter',deleteRow:'deleteRow',deleteColumn:'deleteColumn',mergeCells:'mergeCells',splitCell:'splitCell',deleteTable:'deleteTable'};
    if(tableCommands[k])b.disabled=!instance.can()[tableCommands[k]]();
  }
  setSelectState($('paragraph-style'),paragraphs.length?paragraphs.map(node=>node.type.name==='heading'?`h${node.attrs.level}`:'paragraph'):['paragraph']);
  setSelectState($('text-align'),paragraphs.length?paragraphs.map(node=>node.attrs.textAlign||'left'):['left']);
  setSelectState($('paragraph-space'),paragraphs.length?paragraphs.map(node=>node.attrs.spaceAfter||0):[0]);
  setSelectState($('font-family'),styles.map(style=>style.fontFamily||''));setSelectState($('font-size'),styles.map(style=>style.fontSize||'12pt'));setSelectState($('line-height'),styles.map(style=>style.lineHeight||'1.5'));
  const textColors=styles.map(style=>style.color||'#000000');
  const highlights=[];
  if(selection.empty)highlights.push((storedMarks||selection.$from.marks()).find(mark=>mark.type.name==='highlight')?.attrs.color||'');
  else doc.nodesBetween(selection.from,selection.to,node=>{if(node.isText)highlights.push(node.marks.find(mark=>mark.type.name==='highlight')?.attrs.color||'');});
  for(const [inputId,buttonId,values,fallback] of [['text-color','text-color-button',textColors,'#000000'],['highlight-color','highlight-button',highlights,'#ffff00']]){
    const colors=[...new Set(values)],mixed=colors.length>1,value=colors[0]||fallback;
    if(/^#[\da-f]{6}$/i.test(value))$(inputId).value=value;
    $(buttonId).dataset.mixed=String(mixed);$(buttonId).style.setProperty('--format-color',mixed?'transparent':value);
    $(buttonId).title=mixed?'所选文字使用了多种颜色':`${buttonId==='text-color-button'?'文字颜色':'高亮颜色'} ${colors[0]||'未设置'}`;
  }
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
let openingLibraryEntry=false;
ui.beforeNavigate=async()=>{
  if(opening||creating||importing||exporting||openingLibraryEntry){
    ui.showMessage('正在处理文档，请稍候再切换页面。');
    return false;
  }
  if(document.body.dataset.view!=='document')return true;
  editor?.view.domObserver.flush();
  if(editor?.view.composing){
    ui.showMessage('请先完成当前输入，再切换页面。');
    return false;
  }
  try{await flush();return true;}
  catch(error){reportError(error);return false;}
};
window.workproofCancelClose=()=>{
  if(!closing)return;
  closing=false;workspace.setClosing(false);
  window.workproofSetInteractionLock('closing',false);
  setEditable(editableBeforeClose||(!dirty&&!pending.length&&!inflight));
};
window.workproofBeforeClose=async()=>{
  // Let the editor observe the final browser input before freezing its DOM.
  await new Promise(resolve=>setTimeout(resolve,0));
  editor?.view.domObserver.flush();
  if(opening||creating||importing||exporting||openingLibraryEntry)throw new Error('文档正在打开、导入或导出，请完成后再关闭或退出。');
  if(editor?.view.composing)throw new Error('请先完成当前输入，再关闭或退出。');
  if(closing)return;
  editableBeforeClose=editor?.isEditable??true;closing=true;
  setEditable(false);workspace.setClosing(true);
  window.workproofSetInteractionLock('closing',true);
  try{await flush();}
  catch(error){window.workproofCancelClose();reportError(error);throw new Error('文档尚未保存，窗口已保留。请重试保存后再关闭。');}
};
window.addEventListener('beforeunload',event=>{if(dirty||pending.length||inflight){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)flush().catch(reportError);});

async function openDocument(doc){
  if(opening||exporting)return;opening=true;
  try{
    await flush();await loadEditorRuntime();workspace.closeFind();workspace.closeSource();workspace.rememberPagination();suppressed=true;characterSnapshot=null;editor?.destroy();active=doc;pending=[];inflight=null;dirty=false;intent=null;lastSelection='';
    selectedVersion=null;expandedFlows.clear();$('flow-detail').replaceChildren();$('flow-detail').hidden=true;$('history-preview').replaceChildren();
    $('document-title').value=doc.title;
    const domEvents={keydown,copy:()=>{commandAction('copy');return false;},paste:()=>{commandAction('paste');return false;},cut:()=>{commandAction('cut');return false;},beforeinput:(_v,event)=>{addAction('beforeinput',{detail:{input_type:event.inputType}});if(event.inputType==='historyUndo')hint('undo');if(event.inputType==='historyRedo')hint('redo');return false;},input:(_v,event)=>{addAction('input',{detail:{input_type:event.inputType}});return false;},focus:()=>{addAction('focus');return false;},blur:()=>{addAction('blur');return false;}};
    for(const type of ['compositionstart','compositionupdate','compositionend','drop','dragstart','dragend'])domEvents[type]=(_v,event)=>{addAction(type,{detail:{data:typeof event.data==='string'?event.data.slice(0,2048):null}});return false;};
    editor=new editorRuntime.Editor({element:$('tiptap-editor'),extensions:editorRuntime.editorExtensions(true),content:doc.content,editorProps:{attributes:{'aria-label':'文档正文',role:'textbox','aria-multiline':'true',spellcheck:'true'},handleDOMEvents:domEvents},onTransaction:transaction,onSelectionUpdate:({editor:e})=>updateToolbar(e)});
    restorePageLayout();workspace.setDocumentKind(doc.kind);suppressed=false;workspace.changed();state('已保存到本机','saved');$('editor-word-count').textContent=`${editorCharacters().toLocaleString()} 字符`;
    $('certificate-result').hidden=true;$('certificate-empty').hidden=false;renderRecent();updateToolbar();ui.selectView('document');selectTab('write');
  }catch(error){reportError(error);}finally{suppressed=false;opening=false;}
}
async function createDocument(kind,templateId='blank'){
  if(opening||creating||exporting||closing||importing||openingLibraryEntry)return;
  creating=true;
  const buttons=[$('new-document'),$('first-document')];buttons.forEach(b=>b.disabled=true);
  try{
    const template=draftTemplates.find(item=>item.id===templateId);
    try{await flush();}catch(error){reportError(error);return;}
    const doc=await ipc('editor_create',{title:template?.title||'未命名文档',started:new Date().toISOString(),kind});await openDocument(doc);
    if(active?.id!==doc.id)throw new Error('新文档尚未打开，请从我的文档重试。');
    if(template){hint('import');editor.view.dispatch(editor.state.tr.replaceWith(0,editor.state.doc.content.size,editor.schema.nodeFromJSON(template.content).content).setMeta('workproofTemplate',template.id));await flush();}
    $('document-title').focus();$('document-title').select();await loadLibrary();
  }
  catch(error){ui.showMessage(errorText(error),'error');}finally{creating=false;buttons.forEach(b=>b.disabled=false);}
}
function chooseDocumentKind(templateId='blank'){
  if(opening||creating||exporting||closing||importing||openingLibraryEntry||document.querySelector('dialog[open]'))return;
  const dialog=$('document-kind-dialog');
  dialog.returnValue='';
  dialog.addEventListener('close',()=>{
    const kind=dialog.returnValue;
    if(kind==='word'||kind==='markdown')createDocument(kind,templateId);
  },{once:true});
  dialog.showModal();
}
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
const librarySort=element('select');librarySort.id='library-sort';librarySort.setAttribute('aria-label','文档排序');
for(const [value,label] of [['recent','最近修改'],['title','按名称排序']]){const option=element('option','',label);option.value=value;librarySort.append(option);}
try{librarySort.value=localStorage.getItem('workproof.library-sort')==='title'?'title':'recent';}catch{}
$('library-source-filter').after(librarySort);
const librarySummary=element('p','library-summary');librarySummary.id='library-summary';librarySummary.setAttribute('role','status');$('document-list').before(librarySummary);
librarySort.addEventListener('change',()=>{try{localStorage.setItem('workproof.library-sort',librarySort.value);}catch{}renderLibrary();});
const titleOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
let deletionDialog=null;
function confirmLibraryDeletion(doc,kind){
  if(!deletionDialog){
    deletionDialog=element('dialog','library-delete-dialog');deletionDialog.id='library-delete-dialog';deletionDialog.setAttribute('aria-labelledby','library-delete-title');
    const heading=element('h2','','永久删除这份文档？');heading.id='library-delete-title';
    const description=element('p');description.id='library-delete-description';
    const actions=element('div','dialog-actions');
    for(const [value,label] of [['cancel','取消'],['delete','永久删除']]){const button=element('fluent-button','',label);button.dataset.keepLabel='true';button.setAttribute('appearance',value==='delete'?'primary':'secondary');button.addEventListener('click',()=>deletionDialog.close(value));actions.append(button);}
    deletionDialog.append(heading,description,actions);document.body.append(deletionDialog);
  }
  deletionDialog.querySelector('p').textContent=`“${doc.title}”${kind==='external'?'在 WorkProof 中的全部记录将永久删除，原应用中的文件会保留。':'及其编辑版本、过程记录将永久删除。'} 此操作无法恢复。`;
  deletionDialog.returnValue='';deletionDialog.showModal();deletionDialog.querySelector('fluent-button').focus();
  return new Promise(resolve=>deletionDialog.addEventListener('close',()=>resolve(deletionDialog.returnValue==='delete'),{once:true}));
}
let libraryRowsSignature='';
function renderLibrary(){
  const list=$('document-list'),focusKey=document.activeElement?.closest('[data-document-key]')?.dataset.documentKey;
  const query=($('document-search').value||'').trim().toLocaleLowerCase();
  const rows=document.createDocumentFragment();
  let restoreFocus;
  const selectedSource=$('library-source-filter')?.value||'all';
  const entries=documents.map(doc=>({type:'editor',doc,source:'editor',time:Number(doc.modified)})).concat(groupExternalDocuments(externalDocuments));
  entries.sort((a,b)=>librarySort.value==='title'?titleOrder.compare(a.doc.title,b.doc.title):((b.time??0)-(a.time??0))||titleOrder.compare(a.doc.title,b.doc.title));
  const selectedState=$('library-state-filter').value;
  const stateEntries=entries.filter(entry=>(libraryStates[entry.type+':'+entry.doc.id]||'active')===selectedState);
  const filtered=stateEntries.filter(entry=>(selectedSource==='all'||selectedSource===entry.source)&&`${entry.doc.title} ${sourceLabel(entry.source)} ${entry.source}`.toLocaleLowerCase().includes(query));
  // Engine readiness and catalog refreshes can deliver identical data between
  // pointer-down and pointer-up. Keep existing controls alive in that case;
  // replacing them cancels an otherwise valid click and loses keyboard focus.
  // Only summarize row metadata, never serialize the document body here.
  const signature=JSON.stringify([selectedState,filtered.map(({type,doc,source,time,sessions})=>
    [type,doc.id,doc.title,source,time,doc.revision,doc.demo,sessions?.map(session=>[session.id,session.event_count])]
  )]);
  const rowsChanged=signature!==libraryRowsSignature;
  if(rowsChanged){
  for(const entry of filtered){
    const {doc}=entry,row=element('div','document-row');row.setAttribute('role','listitem');row.dataset.documentKey=`${entry.type}:${doc.id}`;row.dataset.source=entry.source;
    const label=element('div'),description=entry.type==='editor'?`${doc.revision+1} 个保存版本`:`${entry.sessions.length} 次记录 · ${entry.sessions.reduce((sum,session)=>sum+Number(session.event_count),0).toLocaleString()} 条记录${doc.demo?' · 演示记录':''}`;
    label.append(element('strong','',doc.title),element('p','',`${sourceLabel(entry.source)} · ${displayTime(entry.time)} · ${description}`));
    const action=entry.type==='editor'?'继续编辑':'查看记录',open=element('fluent-button','',action);open.setAttribute('aria-label',`${action} ${doc.title}`);open.dataset.icon=entry.type==='external'?'text_bullet_list_ltr':'document_text';
    open.addEventListener('click',async()=>{if(closing||openingLibraryEntry||creating||importing||opening||exporting)return;openingLibraryEntry=true;open.disabled=true;try{
      if(entry.type==='external')await externalLibrary.open(doc,entry.sessions);else{await flush();await openDocument(await ipc('editor_load',{id:doc.id}));}
    }catch(error){ui.showMessage(errorText(error),'error');}finally{openingLibraryEntry=false;open.disabled=false;}});
    if(row.dataset.documentKey===focusKey)restoreFocus=open;
    const actions=element('div','library-row-actions');actions.append(open);
    if(entry.type==='external'&&/\.(docx|md|markdown|txt)$/i.test(doc.title)){
      const copy=element('fluent-button','','编辑副本');copy.setAttribute('aria-label','在内置编辑器打开副本 '+doc.title);copy.dataset.icon='document_text';
      copy.addEventListener('click',async()=>{
        if(importing||opening||closing||creating||exporting||openingLibraryEntry)return;
        copy.disabled=true;openingLibraryEntry=true;
        try{
          const result=await ipc('external_document_read',{id:doc.id});
          if(!result||!Array.isArray(result.bytes)||typeof result.name!=='string')throw new Error('原文件未能读取。');
          const target=/\.docx$/i.test(result.name)?$('word-file'):$('markdown-file');
          const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(result.bytes)],result.name));
          target.files=transfer.files;openingLibraryEntry=false;target.dispatchEvent(new Event('change',{bubbles:true}));
        }catch(error){ui.showMessage(errorText(error),'error');}finally{openingLibraryEntry=false;copy.disabled=false;}
      });actions.append(copy);
    }

    for(const [state,title,glyph] of (selectedState==='active'?[['archived','归档','archive'],['delete','删除','delete']]:[['active','恢复到我的文档','arrow_left'],['delete','删除','delete']])){
      const manage=element('fluent-button','',title);manage.dataset.icon=glyph;manage.setAttribute('aria-label',title+' '+doc.title);manage.title=title;
      manage.addEventListener('click',async()=>{
        manage.disabled=true;
        try{
          if(state==='delete'&&!await confirmLibraryDeletion(doc,entry.type))return;
          await flush();
          const ids=entry.type==='external'?entry.sessions.map(session=>session.id):[doc.id];
          if(state==='delete'){
            await ipc('library_delete',{kind:entry.type,ids});
            if(entry.type==='editor'&&active?.id===doc.id){active=null;editor?.destroy();editor=null;}
            await loadLibrary();ui.showMessage('已永久删除 WorkProof 中的文档和记录。');return;
          }
          await ipc('library_set_state',{kind:entry.type,ids,state});
          for(const id of ids)libraryStates[entry.type+':'+id]=state;
          renderLibrary();
          ui.showMessage(state==='trash'?'已移入回收站。原文件仍保存在原位置。':state==='archived'?'文档已归档。':'文档已恢复。');
        }catch(error){ui.showMessage(errorText(error),'error');}finally{manage.disabled=false;}
      });actions.append(manage);
    }
    row.append(entry.type==='external'?adapterIcon(entry.source):icon('document_text'),label,actions);rows.append(row);
  }
  list.replaceChildren(rows);
  libraryRowsSignature=signature;
  if(focusKey&&document.body.dataset.view==='library')(restoreFocus??$('document-search')).focus({preventScroll:true});
  }
  $('library-empty').hidden=entries.length>0||selectedState!=='active';
  librarySummary.textContent=`${selectedState==='archived'?'已归档':selectedState==='trash'?'回收站':'我的文档'} · ${filtered.length} 份${query||selectedSource!=='all'?`，本分组共 ${stateEntries.length} 份`:''}`;
  $('library-error').textContent=libraryLoadError||(!filtered.length&&(entries.length||selectedState!=='active')?(stateEntries.length?'没有找到符合条件的文档。':selectedState==='archived'?'还没有已归档文档。':selectedState==='trash'?'回收站为空。':'还没有文档。'):'');
}
let listing=false,libraryRefreshPending=false,lastLibraryRefresh=0,catalogRefreshTimer=null,lastCatalogStamp='',lastSessionCount=null;
async function loadLibrary(){
  if(listing){libraryRefreshPending=true;return;}listing=true;
  const results=await Promise.allSettled([ipc('editor_list'),ipc('external_documents_list'),ipc('library_states')]);
  try{
    libraryLoadError='';
    for(const [index,result] of results.entries()){
      if(index===2){if(result.status==='fulfilled'&&result.value&&typeof result.value==='object'&&!Array.isArray(result.value))libraryStates=Object.fromEntries(Object.entries(result.value).map(([id,state])=>[id,state==='trash'?'active':state]));else libraryLoadError+='归档与回收站状态暂未读取，请点击刷新重试。';continue;}
      if(result.status==='fulfilled'&&Array.isArray(result.value)){if(index===0)documents=result.value;else externalDocuments=result.value;}
      else libraryLoadError+=(index===0?'内置文档':'外部应用文档')+'暂未读取，请点击刷新重试。';
    }
    renderLibrary();
  }finally{listing=false;lastLibraryRefresh=Date.now();if(libraryRefreshPending){libraryRefreshPending=false;loadLibrary();}}
}
let engineSeen=false;
window.addEventListener('workproof-engine',event=>{
  const status=event.detail;if(!status.ready)return;
  const stamp=`${status.sessions}:${status.events}`,newSession=lastSessionCount!==status.sessions;
  lastSessionCount=status.sessions;
  if(!engineSeen){engineSeen=true;lastCatalogStamp=stamp;loadLibrary();return;}
  if(stamp===lastCatalogStamp)return;lastCatalogStamp=stamp;
  if(document.body.dataset.view!=='library')return;
  if(newSession){clearTimeout(catalogRefreshTimer);catalogRefreshTimer=null;loadLibrary();return;}
  if(catalogRefreshTimer===null)catalogRefreshTimer=setTimeout(()=>{catalogRefreshTimer=null;if(document.body.dataset.view==='library')loadLibrary();},Math.max(0,10000-(Date.now()-lastLibraryRefresh)));
});
window.addEventListener('workproof-view',event=>{if(event.detail==='library')loadLibrary();});
$('new-document').addEventListener('click',()=>chooseDocumentKind());$('first-document').addEventListener('click',()=>chooseDocumentKind());$('reload-documents').addEventListener('click',loadLibrary);$('document-search').addEventListener('input',renderLibrary);
$('library-source-filter')?.addEventListener('change',renderLibrary);
$('document-title').addEventListener('input',()=>{if(active){dirty=true;state('待保存');scheduleSave();$('certificate-result').hidden=true;$('certificate-empty').hidden=false;}});
$('back-library').addEventListener('click',()=>void ui.requestView('library'));
$('save-document').addEventListener('click',()=>flush().catch(reportError));
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||!active||closing||document.body.dataset.view!=='document')return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();flush().catch(reportError);}
});

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
  document.dispatchEvent(new CustomEvent('workproof-editor-tab',{detail:tab}));
  for(const button of document.querySelectorAll('[data-tab]')){const selected=button.dataset.tab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$(button.dataset.tab+'-panel').hidden=!selected;}
  if(tab==='process')flush().then(renderProcess).catch(reportError);
}
const tabs=[...document.querySelectorAll('[data-tab]')];tabs.forEach((b,i)=>{b.addEventListener('click',()=>selectTab(b.dataset.tab));b.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();selectTab(tabs[n].dataset.tab);tabs[n].focus();});});
$('view-process').addEventListener('click',()=>{selectTab('process');$('tab-process').focus();});
$('back-write').addEventListener('click',()=>{selectTab('write');$('tab-write').focus();});
$('open-process-replay').addEventListener('click',async()=>{
  if(!active||opening||exporting||closing||document.querySelector('#process-replay'))return;
  const button=$('open-process-replay'),id=active.id;button.disabled=true;
  try{
    await flush();const doc=await ipc('editor_load',{id});
    const {openProcessReplay}=await import('./process-replay.js');
    if(active?.id!==id||document.body.dataset.view!=='document'||closing)return;
    openProcessReplay({document:doc,invoke:ipc,returnFocus:button,renderContent:content=>editorRuntime.generateHTML(content,editorRuntime.editorExtensions())});
  }catch(error){reportError(error);}finally{button.disabled=false;}
});
function renderProcess(){
  if(!active)return;const versions=[...(active.versions||[])].reverse(),actions=allActions();
  $('process-summary').textContent=`${active.revision+1} 个保存版本 · ${active.event_count} 条已保存记录（含起点与保存检查点）`;
  $('version-flow').replaceChildren();
  const revision=versions.some(version=>version.revision===selectedVersion)?selectedVersion:versions.at(-1)?.revision;
  for(const [i,v] of versions.entries()){if(i)$('version-flow').append(element('span','version-edge'));const button=element('button','version-node',`版本 ${v.revision+1}`);button.setAttribute('aria-pressed',String(v.revision===revision));button.append(element('small','',time(v.saved)));button.dataset.revision=v.revision;button.addEventListener('click',()=>showVersion(v.revision));$('version-flow').append(button);}
  const slider=$('version-slider');slider.max=Math.max(0,versions.length-1);slider.value=slider.max;slider.oninput=()=>{const v=versions[Number(slider.value)];if(v)showVersion(v.revision);};
  const groups=groupActions(actions);$('full-actions').replaceChildren(...groups.map(flowItem));
  $('flow-detail').replaceChildren();
  $('flow-detail').hidden=true;
  $('action-route').replaceChildren(...[...groups].reverse().map(group=>{
    const button=element('button','flow-node',`${group.label} - ${group.count}次`);
    button.dataset.type=group.type;
    button.append(element('small','',time(active.created+group.start)));
    button.setAttribute('aria-pressed','false');
    button.addEventListener('click',()=>{
      for(const node of $('action-route').children)node.setAttribute('aria-pressed',String(node===button));
      $('flow-detail').replaceChildren(flowItem(group));
      $('flow-detail').hidden=false;
      if(group.revision<=active.revision)showVersion(group.revision);
    });
    return button;
  }));
  const counts=new Map();for(const group of groups){counts.set(group.label,(counts.get(group.label)||0)+group.count);}
  $('action-chart').replaceChildren();const ordered=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,8),max=Math.max(1,...ordered.map(x=>x[1]));
  for(const [label,count] of ordered){const row=element('div','chart-row'),track=element('div','chart-track'),fill=element('div','chart-fill');fill.style.width=`${count/max*100}%`;track.append(fill);row.append(element('span','',label),track,element('span','',String(count)));$('action-chart').append(row);}
  if(revision!==undefined)showVersion(revision);
}
async function showVersion(revision){
  const token=++historyToken,id=active.id;selectedVersion=revision;
  try{const content=await ipc('editor_version',{id,revision});if(token!==historyToken||active?.id!==id)return;$('history-preview').innerHTML=editorRuntime.generateHTML(content,editorRuntime.editorExtensions());$('history-version-label').textContent=`版本 ${revision+1}`;$('version-caption').textContent=`版本 ${revision+1} · 只读预览`;
    const versions=[...active.versions].reverse();$('version-slider').value=versions.findIndex(v=>v.revision===revision);for(const button of document.querySelectorAll('[data-revision]'))button.setAttribute('aria-pressed',String(Number(button.dataset.revision)===revision));
  }catch(error){if(token===historyToken&&active?.id===id)ui.showMessage(errorText(error),'error');}
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
    if(command==='link'){openLinkDialog();return;}
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
function linkError(text){$('link-url').setCustomValidity(text);if($('link-error'))$('link-error').textContent=text;else if(text)$('link-url').reportValidity();}
function openLinkDialog(){
  if(!editor||closing||exporting||!workspace.closeSource())return;
  editor.view.domObserver.flush();
  const {from,to,$from}=editor.state.selection,range=editorRuntime.getMarkRange($from,editor.schema.marks.link),withinLink=range&&from>=range.from&&to<=range.to;
  linkContext={id:active.id,from,to,range:withinLink?range:{from,to},existing:withinLink,applied:false};
  const existingMark=withinLink?editor.state.doc.nodeAt(range.from)?.marks.find(mark=>mark.type===editor.schema.marks.link):null;
  $('link-url').value=existingMark?.attrs.href||'';linkError('');
  if($('link-dialog-title'))$('link-dialog-title').textContent=withinLink?'编辑链接':'插入链接';
  if($('link-remove'))$('link-remove').hidden=!withinLink;
  $('link-dialog').showModal();$('link-url').focus();$('link-url').select();
}
function applyLink(remove=false){
  if(!editor||closing||exporting||linkContext?.id!==active?.id)return;
  const href=$('link-url').value.trim();
  if(!remove&&href){
    try{const url=new URL(href);if(!['https:','http:','mailto:'].includes(url.protocol)||url.protocol==='mailto:'&&!url.pathname)throw new Error();}
    catch{linkError('请输入完整的 https://、http:// 或 mailto: 链接。');$('link-url').focus();return;}
  }
  if(!remove&&!href&&!linkContext.existing){linkError('请填写链接地址。');$('link-url').focus();return;}
  hint('format');const {range}=linkContext,chain=editor.chain().setTextSelection(range);
  if(remove||!href)chain.unsetLink().run();
  else if(range.from===range.to)chain.insertContent({type:'text',text:href,marks:[{type:'link',attrs:{href}}]}).run();
  else chain.setLink({href}).run();
  linkContext.applied=true;$('link-dialog').close();updateToolbar();
}
$('link-url').addEventListener('input',()=>linkError(''));
$('link-cancel').addEventListener('click',event=>{event.preventDefault();$('link-dialog').close();});
$('link-confirm').addEventListener('click',event=>{event.preventDefault();applyLink();});
$('link-remove')?.addEventListener('click',event=>{event.preventDefault();applyLink(true);});
$('link-dialog').querySelector('form').addEventListener('submit',event=>{event.preventDefault();applyLink();});
$('link-dialog').addEventListener('close',()=>{
  if(editor&&linkContext?.id===active?.id&&!closing){if(!linkContext.applied)editor.commands.setTextSelection({from:linkContext.from,to:linkContext.to});editor.view.focus();}
  linkContext=null;
});
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
  const format=active.kind==='markdown'?'markdown':'docx';
  let frozen=false;
  try{
    workspace.validate();
    editor.view.domObserver.flush();
    if(editor.view.composing)throw new Error('请先完成当前输入，再导出。');
    workspace.setClosing(true);frozen=true;exporting=true;
    $('document-title').disabled=true;setEditable(false);
    try{await flush();}catch(error){reportError(error);return;}
    let docx=null,markdown=null;
    if(format==='docx')docx=Array.from(await wordOperation('export',{content:editor.getJSON()}));
    if(format==='markdown')markdown=workspace.markdownText();
    const out=await ipc('editor_export',{id:active.id,docx,markdown});
    if(out?.cancelled)return;
    if(out?.saved!==true||out.report?.valid!==true||out.report?.file_match!==true||out.report?.signature_valid!==true||typeof out.html!=='string'||!/^[a-f0-9]{64}$/.test(out.fingerprint))throw new Error('导出结果未能确认，请不要交付未经核验的文件。');
    $('export-preview').srcdoc=out.html;$('exported-name').textContent=out.file_name;$('certificate-name').textContent=active.title;$('certificate-count').textContent=`${out.event_count} 条核验记录`;$('certificate-fingerprint').textContent=out.fingerprint;$('certificate-empty').hidden=true;$('certificate-result').hidden=false;selectTab('certificate');$('tab-certificate').focus();ui.showMessage('作品和证书已保存，请将两个文件一起交付。');
  }catch(error){ui.showMessage(errorText(error),'error');}
  finally{
    exporting=false;
    if(frozen){workspace.setClosing(false);$('document-title').disabled=false;setEditable(true);}
    buttons.forEach(b=>b.disabled=false);
  }
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
  const file=event.target.files?.[0];event.target.value='';if(!file||importing||opening||exporting||closing||creating||openingLibraryEntry)return;
  importing=true;$('import-word').disabled=true;
  try{
    if(!file.name.toLowerCase().endsWith('.docx')||file.size>8*1024*1024)throw new Error('请选择不超过 8 MB 的 .docx 文件。');
    await flush();const content=await wordOperation('import',{bytes:await file.arrayBuffer()});
    const title=file.name.replace(/\.docx$/i,'').slice(0,120)||'导入的 Word 文档';const doc=await ipc('editor_create',{title,started:new Date().toISOString(),kind:'word'});await openDocument(doc);
    if(active?.id!==doc.id)throw new Error('导入文档尚未打开，请从我的文档重试。');
    hint('import');editor.commands.setContent(content);await flush();ui.showMessage('Word 正文、常用格式和表格已导入，从现在开始记录。复杂版式请在 Word 中核对。');await loadLibrary();
  }catch(error){ui.showMessage(errorText(error),'error');}finally{importing=false;$('import-word').disabled=false;}
});
$('import-markdown').addEventListener('click',()=>$('markdown-file').click());
$('markdown-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file||importing||opening||exporting||closing||creating||openingLibraryEntry)return;importing=true;$('import-markdown').disabled=true;
  try{
    if(!/\.(md|markdown|txt)$/i.test(file.name)||file.size>512*1024)throw new Error('请选择不超过 512 KB 的 Markdown 或文本文件。');
    const text=await file.text();await flush();const doc=await ipc('editor_create',{title:file.name.replace(/\.(md|markdown|txt)$/i,'').slice(0,120)||'Markdown 文档',started:new Date().toISOString(),kind:'markdown'});await openDocument(doc);
    if(active?.id!==doc.id)throw new Error('导入文档尚未打开，请从我的文档重试。');
    const parsed=editor.schema.nodeFromJSON(editor.markdown.parse(text));hint('import');editor.view.dispatch(editor.state.tr.replaceWith(0,editor.state.doc.content.size,parsed.content).setDocAttribute('markdownSource',text));await flush();
    ui.showMessage('Markdown 已导入，从现在开始记录。');await loadLibrary();
  }catch(error){ui.showMessage(errorText(error),'error');}finally{importing=false;$('import-markdown').disabled=false;}
});
const workspaceTools=initializeWorkspaceTools({
  getEditor:()=>editor,canOpen:()=>!closing&&!opening&&!exporting&&!creating&&!importing&&!openingLibraryEntry,
  usesLinkShortcut:event=>{
    if(!editor||!(event.target instanceof Element)||!event.target.closest('#tiptap-editor'))return false;
    editor.view.domObserver.flush();
    const {empty,$from}=editor.state.selection;
    return !empty||Boolean(editorRuntime.getMarkRange($from,editor.schema.marks.link));
  },
  onShortcut:event=>{if(document.body.dataset.view==='document')addAction('keyboard',{detail:{source:'workspace-command',key:event.key,code:event.code,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,repeat:event.repeat,composing:false}});},
  onError:error=>ui.showMessage(errorText(error),'error'),
  commands:()=>{
    const current=Boolean(active&&document.body.dataset.view==='document'),writing=current&&$('tab-write').getAttribute('aria-selected')==='true';
    const navigate=view=>ui.requestView(view);
    return [
      {id:'new',title:'新建空白文档',description:'自动保存正文与编辑过程',icon:'document',shortcut:'Ctrl+N',run:()=>chooseDocumentKind()},
      ...draftTemplates.map(template=>({id:'template:'+template.id,title:'新建'+template.title,description:template.description,icon:'document_text',run:()=>chooseDocumentKind(template.id)})),
      {id:'import-word',title:'导入 Word 文档',description:'打开 .docx，从导入后开始记录',icon:'arrow_upload',run:()=>$('import-word').click()},
      {id:'import-markdown',title:'导入 Markdown 或文本',description:'打开 .md、.markdown 或 .txt',icon:'code',run:()=>$('import-markdown').click()},
      {id:'save',title:'保存当前文档',description:'将正文与待保存动作写入本机',icon:'save',enabled:current,run:()=>flush()},
      {id:'find',title:'查找和替换',icon:'search',enabled:writing,run:()=>{if(workspace.closeSource())workspace.openFind();}},
      {id:'focus',title:'切换专注写作',description:'收起辅助面板，留出更多正文空间',icon:'full_screen_maximize',enabled:writing,run:()=>(document.body.classList.contains('simple-writing')?$('exit-simple-writing'):$('focus-writing')).click()},
      {id:'statistics',title:'查看文档统计',description:'字符、汉字、英文词和段落',icon:'text_bullet_list_ltr',enabled:current,run:()=>workspaceTools.showStatistics()},
      {id:'process',title:'查看编辑过程',description:'回看版本与动作流程',icon:'play',enabled:current,run:()=>$('tab-process').click()},
      {id:'export',title:'导出作品与证书',description:'使用当前选择的文件格式',icon:'arrow_download',enabled:current,run:()=>$('export-document').click()},
      {id:'library',title:'返回我的文档',icon:'document',run:()=>navigate('library')},
      {id:'verify',title:'核验作品与证书',icon:'checkmark',run:()=>navigate('verification')},
      {id:'connections',title:'连接 Word 等外部应用',icon:'plug_connected',run:()=>navigate('connections')},
      ...[...documents].sort((a,b)=>Number(b.modified)-Number(a.modified)).slice(0,8).map(doc=>({id:'resume:'+doc.id,title:'继续编辑 '+doc.title,description:'本机文档',icon:'document_text',run:async()=>{await flush();await openDocument(await ipc('editor_load',{id:doc.id}));}})),
    ];
  },
});
await loadLibrary();
