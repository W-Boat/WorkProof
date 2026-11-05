import {EditorView,basicSetup} from 'codemirror';
import {markdown} from '@codemirror/lang-markdown';

const $=id=>document.getElementById(id);
// Both presentations edit the same Tiptap document and use its recording pipeline.
export function initializeWritingWorkspace({getEditor,getActive,record,hint,flush,showMessage}){
  let mode='word',source=null,sourceId=null,syncing=false,sourceError=null;
  const drafts=new Map();
  const sourceVisible=()=>!$('markdown-source-panel').hidden;
  const requiresRichDocument=node=>{
    if(['image','pageBreak','taskList','taskItem','table'].includes(node.type))return true;
    if(node.marks?.some(mark=>!['bold','italic','strike','code','link'].includes(mark.type)))return true;
    const a=node.attrs||{};
    if(a.indent||a.spaceAfter||a.textAlign&&a.textAlign!=='left')return true;
    return node.content?.some(requiresRichDocument)||false;
  };
  function rememberDraft(){if(source&&sourceId)drafts.set(sourceId,{text:source.state.doc.toString(),document:JSON.stringify(getEditor()?.getJSON())});}
  function sourceChanged(update){
    if(syncing||!update.docChanged)return;
    const editor=getEditor();if(!editor)return;
    try{
      const text=update.state.doc.toString();
      const parsed=editor.schema.nodeFromJSON(editor.markdown.parse(text));
      hint('edit');editor.view.dispatch(editor.state.tr.replaceWith(0,editor.state.doc.content.size,parsed.content).setDocAttribute('markdownSource',text));
      sourceError=null;
      rememberDraft();
    }catch(error){sourceError=new Error('Markdown 尚未完成解析，请修正源码后再保存或切换文档。');showMessage(sourceError.message+String(error),'error');}
  }
  function openSource(){
    const editor=getEditor();if(!editor)return;
    if(requiresRichDocument(editor.getJSON())){showMessage('这份文档包含分页、表格或精细排版，请在正文中继续编辑。Markdown 模式仍可直接使用。');return;}
    const id=getActive()?.id,draft=drafts.get(id),json=JSON.stringify(editor.getJSON());
    let stored=editor.state.doc.attrs.markdownSource;
    if(typeof stored==='string'){
      try{if(!editor.schema.nodeFromJSON(editor.markdown.parse(stored)).content.eq(editor.state.doc.content))stored=null;}catch{stored=null;}
    }
    const text=draft?.document===json?draft.text:stored??editor.getMarkdown();
    source?.destroy();sourceId=id;
    $('markdown-source-panel').hidden=false;
    $('tiptap-editor').hidden=true;
    source=new EditorView({doc:text,parent:$('markdown-source'),extensions:[basicSetup,markdown(),EditorView.lineWrapping,EditorView.contentAttributes.of({'aria-label':'Markdown 源码'}),EditorView.updateListener.of(sourceChanged),EditorView.domEventHandlers({keydown(event){record('keyboard',{detail:{key:event.key,code:event.code,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,composing:event.isComposing,source:'markdown'}});if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();flush().catch(error=>showMessage(String(error),'error'));return true;}return false;},copy(){record('copy',{metrics:{copy:1}});},paste(){record('paste',{metrics:{paste:1}});},cut(){record('cut',{metrics:{cut:1}});}})]});
    $('toggle-source').setAttribute('aria-pressed','true');source.focus();
  }
  function closeSource(){if(sourceError){showMessage(sourceError.message,'error');return false;}rememberDraft();source?.destroy();source=null;$('markdown-source').replaceChildren();$('markdown-source-panel').hidden=true;$('tiptap-editor').hidden=false;$('toggle-source').setAttribute('aria-pressed','false');return true;}
  $('toggle-source').addEventListener('click',()=>sourceVisible()?closeSource():openSource());
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    if(button.dataset.mode==='word'&&!closeSource())return;
    mode=button.dataset.mode;
    $('write-panel').dataset.editMode=mode;
    document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.mode===mode)));
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
  return {outline,changed(){outline();if(source&&sourceId!==getActive()?.id)closeSource();},validate(){if(sourceError)throw sourceError;},markdownText(){
    const editor=getEditor();if(requiresRichDocument(editor.getJSON()))throw new Error('文档含有 Markdown 无法保留的排版，请选择 Word 或网页作品导出。');
    if(source)return source.state.doc.toString();const text=editor.state.doc.attrs.markdownSource;
    if(typeof text==='string'){try{if(editor.schema.nodeFromJSON(editor.markdown.parse(text)).content.eq(editor.state.doc.content))return text;}catch{}}
    return editor.getMarkdown();
  },openFind(){ $('find-panel').hidden=false;$('find-text').focus();},closeSource};
}
