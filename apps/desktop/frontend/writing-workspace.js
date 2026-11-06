import {EditorView,basicSetup} from 'codemirror';
import {markdown} from '@codemirror/lang-markdown';
import {Compartment,EditorState} from '@codemirror/state';

const $=id=>document.getElementById(id);
// Both presentations edit the same Tiptap document and use its recording pipeline.
export function initializeWritingWorkspace({getEditor,getActive,record,hint,flush,showMessage}){
  let mode='word',source=null,sourceId=null,syncing=false,sourceError=null,sourceIntent=null;
  let wordPagination=true;
  try{wordPagination=localStorage.getItem('workproof.word-pagination')!=='false';}catch{}
  const drafts=new Map();
  const sourceEditability=new Compartment();
  let closing=false;
  function setClosing(value){
    if(value&&source?.composing)throw new Error('请先完成当前输入法输入，再关闭窗口。');
    closing=value;
    source?.dispatch({effects:sourceEditability.reconfigure([EditorView.editable.of(!closing),EditorState.readOnly.of(closing)])});
  }
  const sourceVisible=()=>!$('markdown-source-panel').hidden;
  function losslessMarkdown(){
    const editor=getEditor();if(!editor)return null;
    // StarterKit adds a cursor paragraph after tables, lists and images. It is
    // editor scaffolding and must not force a rewrite of the imported source.
    const contentWithoutCursorParagraph=doc=>{
      const empty=editor.schema.nodes.paragraph.create();
      if(doc.childCount>1&&doc.lastChild.eq(empty)&&!doc.child(doc.childCount-2).isTextblock)return doc.content.cut(0,doc.content.size-doc.lastChild.nodeSize);
      return doc.content;
    };
    const matches=text=>{
      if(typeof text!=='string')return false;
      const parsed=editor.markdown.parse(text);
      if(!parsed.content?.length)parsed.content=[{type:'paragraph'}];
      return contentWithoutCursorParagraph(editor.schema.nodeFromJSON(parsed)).eq(contentWithoutCursorParagraph(editor.state.doc));
    };
    try{
      const saved=editor.state.doc.attrs.markdownSource;
      if(matches(saved))return saved;
      const text=editor.getMarkdown();return matches(text)?text:null;
    }catch{return null;}
  }
  function rememberPagination(){
    const editor=getEditor();if(!editor||mode!=='word')return;
    wordPagination=editor.storage.PaginationPlus.enabled;
    try{localStorage.setItem('workproof.word-pagination',String(wordPagination));}catch{}
  }
  function applyMode(){
    const editor=getEditor();if(!editor)return;
    const enabled=mode==='word'&&wordPagination;
    editor.commands[enabled?'enablePagination':'disablePagination']();
    const button=document.querySelector('[data-command=pages]');
    button.disabled=mode==='markdown';button.setAttribute('aria-pressed',String(enabled));
  }
  function rememberDraft(){if(source&&sourceId)drafts.set(sourceId,{text:source.state.doc.toString(),document:JSON.stringify(getEditor()?.getJSON())});}
  function sourceChanged(update){
    if(syncing)return;
    const selection=update.state.selection;
    if(update.selectionSet)record('selection',{detail:{source:'markdown',ranges:selection.ranges.slice(0,64).map(range=>({anchor:range.anchor,head:range.head})),main_index:selection.mainIndex}});
    if(!update.docChanged)return;
    const editor=getEditor();if(!editor)return;
    const changes=[];let remaining=4096,totalChanges=0;
    update.changes.iterChanges((from,to,newFrom,newTo,inserted)=>{
      totalChanges++;
      if(changes.length>=64)return;
      const text=inserted.sliceString(0,Math.min(inserted.length,remaining));remaining-=text.length;
      changes.push({from,to,new_from:newFrom,new_to:newTo,inserted:text,inserted_length:inserted.length,truncated:text.length<inserted.length});
    });
    record('transaction',{detail:{source:'markdown',doc_changed:true,changes,total_changes:totalChanges,truncated:totalChanges>changes.length}});
    try{
      const text=update.state.doc.toString();
      const parsed=editor.schema.nodeFromJSON(editor.markdown.parse(text));
      const history=update.transactions.some(transaction=>transaction.isUserEvent('undo'))?'undo':update.transactions.some(transaction=>transaction.isUserEvent('redo'))?'redo':sourceIntent&&performance.now()-sourceIntent.at<600?sourceIntent.kind:'edit';
      sourceIntent=null;hint(history);editor.view.dispatch(editor.state.tr.replaceWith(0,editor.state.doc.content.size,parsed.content).setDocAttribute('markdownSource',text));
      sourceError=null;
      rememberDraft();
    }catch(error){sourceError=new Error('Markdown 尚未完成解析，请修正源码后再保存或切换文档。');showMessage(sourceError.message+String(error),'error');}
  }
  const sourceEvents={
    keydown(event){
      record('keyboard',{detail:{key:event.key,code:event.code,repeat:event.repeat,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,composing:event.isComposing,source:'markdown'}});
      const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
      if(mod&&key==='s'){event.preventDefault();flush().catch(error=>showMessage(String(error),'error'));return true;}
      if(mod&&key==='z')sourceIntent={kind:event.shiftKey?'redo':'undo',at:performance.now()};
      else if(mod&&key==='y')sourceIntent={kind:'redo',at:performance.now()};
      else sourceIntent=null;
      if(!event.isComposing){
        const kind={Backspace:'backspace',Delete:'delete_forward',' ':'space',Enter:'enter'}[event.key];
        if(kind)record(kind,{metrics:{[kind]:1},detail:{source:'markdown'}});
        else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))record('cursor',{metrics:{cursor_moves:1},detail:{source:'markdown'}});
      }
      return false;
    },
    copy(){record('copy',{metrics:{copy:1},detail:{source:'markdown'}});},
    paste(){record('paste',{metrics:{paste:1},detail:{source:'markdown'}});},
    cut(){record('cut',{metrics:{cut:1},detail:{source:'markdown'}});},
    beforeinput(event){
      record('beforeinput',{detail:{source:'markdown',input_type:event.inputType,composing:event.isComposing}});
      if(['historyUndo','historyRedo'].includes(event.inputType))sourceIntent={kind:event.inputType==='historyUndo'?'undo':'redo',at:performance.now()};
    },
    input(event){record('input',{detail:{source:'markdown',input_type:event.inputType,composing:event.isComposing}});},
    focus(){record('focus',{detail:{source:'markdown'}});},
    blur(){record('blur',{detail:{source:'markdown'}});}
  };
  for(const type of ['compositionstart','compositionupdate','compositionend','drop','dragstart','dragend'])sourceEvents[type]=event=>{
    record(type,{detail:{source:'markdown',data:typeof event.data==='string'?event.data.slice(0,2048):null}});
  };
  function openSource(){
    const editor=getEditor();if(!editor)return;
    const compatible=losslessMarkdown();
    if(compatible===null){showMessage('这份文档含有 Markdown 无法完整保留的格式，请在正文中继续编辑。');return;}
    const id=getActive()?.id,draft=drafts.get(id),json=JSON.stringify(editor.getJSON());
    let stored=editor.state.doc.attrs.markdownSource;
    if(typeof stored==='string'){
      try{if(!editor.schema.nodeFromJSON(editor.markdown.parse(stored)).content.eq(editor.state.doc.content))stored=null;}catch{stored=null;}
    }
    const text=draft?.document===json?draft.text:stored??compatible;
    source?.destroy();sourceId=id;
    $('markdown-source-panel').hidden=false;
    $('tiptap-editor').hidden=true;
    source=new EditorView({doc:text,parent:$('markdown-source'),extensions:[basicSetup,markdown(),sourceEditability.of([EditorView.editable.of(!closing),EditorState.readOnly.of(closing)]),EditorView.lineWrapping,EditorView.contentAttributes.of({'aria-label':'Markdown 源码'}),EditorView.updateListener.of(sourceChanged),EditorView.domEventHandlers(sourceEvents)]});
    $('toggle-source').setAttribute('aria-pressed','true');source.focus();
  }
  function closeSource(){if(sourceError){showMessage(sourceError.message,'error');return false;}rememberDraft();source?.destroy();source=null;$('markdown-source').replaceChildren();$('markdown-source-panel').hidden=true;$('tiptap-editor').hidden=false;$('toggle-source').setAttribute('aria-pressed','false');return true;}
  $('toggle-source').addEventListener('click',()=>sourceVisible()?closeSource():openSource());
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    if(button.dataset.mode==='word'&&!closeSource())return;
    rememberPagination();
    mode=button.dataset.mode;
    $('write-panel').dataset.editMode=mode;
    document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.mode===mode)));
    applyMode();
    document.dispatchEvent(new Event('workproof:editor-mode'));
    record('layout',{detail:{mode},metrics:{layout_changes:1}});
  }));
  $('write-panel').dataset.editMode=mode;
  $('writing-ribbon').addEventListener('pointerdown',event=>{if(sourceVisible()&&!closeSource()){event.preventDefault();event.stopPropagation();}},true);
  document.querySelectorAll('[data-ribbon]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('[data-ribbon]').forEach(item=>{const selected=item===button;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;$('ribbon-'+item.dataset.ribbon).hidden=!selected;});
  }));
  function outline(){
    const editor=getEditor();if(!editor)return;
    const headings=[];editor.state.doc.descendants((node,pos)=>{if(node.type.name==='heading')headings.push({node,pos});});
    $('outline-items').replaceChildren(...headings.map(({node,pos})=>{
      const button=document.createElement('button');button.type='button';button.className='outline-item';button.dataset.level=node.attrs.level;button.textContent=node.textContent||'未命名标题';
      button.addEventListener('click',()=>editor.chain().focus().setTextSelection(pos+1).scrollIntoView().run());return button;
    }));$('outline-empty').hidden=headings.length>0;
  }
  $('find-close').addEventListener('click',()=>{$('find-panel').hidden=true;getEditor()?.commands.setSearchTerm('');});
  $('find-text').addEventListener('input',()=>{getEditor()?.commands.setSearchTerm($('find-text').value);setTimeout(updateFindCount,100);});
  $('replace-text').addEventListener('input',()=>getEditor()?.commands.setReplaceTerm($('replace-text').value));
  function updateFindCount(){const count=getEditor()?.storage.findAndReplace?.results?.length||0;$('find-count').textContent=`${count} 处`;}
  function nextMatch(backward){const editor=getEditor();editor?.commands[backward?'goToPreviousResult':'goToNextResult']();updateFindCount();}
  $('find-next').addEventListener('click',()=>nextMatch(false));$('find-previous').addEventListener('click',()=>nextMatch(true));
  for(const [id,command] of [['replace-one','replace'],['replace-all','replaceAll']])$(id).addEventListener('click',()=>{hint('format');getEditor()?.commands[command]();updateFindCount();});
  return {outline,applyMode,rememberPagination,setClosing,changed(){outline();if(source&&sourceId!==getActive()?.id)closeSource();},validate(){if(sourceError)throw sourceError;},markdownText(){
    if(sourceError)throw sourceError;
    const text=losslessMarkdown();if(text===null)throw new Error('文档含有 Markdown 无法完整保留的格式，请选择 Word 或网页作品导出。');
    return source?.state.doc.toString()??text;
  },openFind(){ $('find-panel').hidden=false;$('find-text').focus();},closeSource};
}
