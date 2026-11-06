const $=id=>document.getElementById(id);
export const sourceLabels={editor:'内置编辑器',word:'Word',powerpoint:'PowerPoint',wps:'WPS',vscode:'VS Code',photoshop:'Photoshop',blender:'Blender'};
export function sourceLabel(source){return Object.hasOwn(sourceLabels,source)?sourceLabels[source]:source||'其他应用';}
export function recordTime(document){
  if(Number.isFinite(document.modified_ms))return document.modified_ms;
  const started=Date.parse(document.started_at);
  return Number.isFinite(started)?started+(Number.isFinite(document.last_elapsed_ms)?document.last_elapsed_ms:0):null;
}
export function displayTime(milliseconds){return milliseconds!==null&&Number.isFinite(milliseconds)?new Date(milliseconds).toLocaleString('zh-CN'):'时间未记录';}
export function groupExternalDocuments(documents){
  const grouped=new Map();
  for(const document of documents){
    let path=document.local_path;
    if(typeof path==='string'&&(/^[a-z]:[\\/]/i.test(path)||/^\\\\/.test(path)))path=path.replaceAll('/','\\').toLowerCase();
    const key=path?`${document.source}\0${document.demo?'demo':'recorded'}\0${path}`:`session\0${document.id}`;
    if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(document);
  }
  return [...grouped.values()].map(sessions=>{
    sessions.sort((a,b)=>(recordTime(b)??0)-(recordTime(a)??0)||(b.recent_order||0)-(a.recent_order||0));
    return {type:'external',doc:sessions[0],source:sessions[0].source,time:recordTime(sessions[0]),sessions};
  });
}
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
const actionLabels={edit:'修改文字',text_delta:'修改文字',format:'调整格式',undo:'撤销',redo:'重做',copy:'复制',paste:'粘贴',cut:'剪切',backspace:'退格',delete_forward:'删除',space:'空格',enter:'回车',cursor:'移动光标',selection:'选择内容',checkpoint:'保存检查点',start:'开始记录',stop:'停止记录',layer:'调整图层',structure:'调整结构',snapshot:'记录快照'};
export function externalRecords({ipc,flush,ui}){
  let current=null,nextBefore=null,token=0,loading=false,sessions=[];
  const seen=new Set();
  function renderFileState(){
    $('external-open-file').hidden=!current?.local_path;$('external-open-file').disabled=!current?.can_open;
    if($('external-file-status'))$('external-file-status').textContent=current?.file_available?(current.can_open?'可打开这次记录对应的本机文件。':'请在原应用中打开此文件。'):current?.local_path?'原文件当前无法打开，请确认文件仍在原位置。':'文件位置未记录。你可以在原应用中打开文件，继续记录。';
  }
  function renderRecord(record){
    const event=record.event,row=element('li','event-item'),details=element('details','action-details');
    const editingLabels={powerpoint:'修改演示文稿',blender:'修改模型',photoshop:'修改画面'};
    const label=event.kind==='edit'&&Object.hasOwn(editingLabels,current.source)?editingLabels[current.source]:actionLabels[event.kind]||({layout:'调整版式',save:'保存作品',pause:'暂停记录',resume:'继续记录',interaction:'操作软件'}[event.kind])||'文档操作';
    const summary=element('summary','',`${label} · 第 ${event.seq+1} 条`);
    const start=Date.parse(current.started_at),date=Number.isFinite(start)?displayTime(start+event.elapsed_ms):`开始后 ${Math.round(event.elapsed_ms/1000)} 秒`;
    const delta=event.inserted||event.deleted?` · +${event.inserted} / −${event.deleted} 字符`:'';
    details.append(summary,element('small','',`${date}${delta}`));
    let populated=false;details.addEventListener('toggle',()=>{if(details.open&&!populated){populated=true;details.append(element('pre','',JSON.stringify({动作:event.kind,指标:event.metrics||{},记录指纹:record.hash},null,2)));}});
    row.append(details);return row;
  }
  async function loadPage(id,beforeSeq,requestToken){
    if(loading)return;loading=true;$('external-load-more').disabled=true;
    try{
      const result=await ipc('external_document_load',{id,beforeSeq,limit:200});
      if(requestToken!==token)return;
      if(result?.document?.id!==id||!Array.isArray(result.records))throw new Error('这份文档的记录无法识别。');
      current=result.document;
      $('external-document-title').textContent=current.title;
      $('external-document-source').textContent=sourceLabel(current.source);
      $('external-document-summary').textContent=`${Number(current.event_count).toLocaleString()} 条记录 · 记录时间 ${displayTime(recordTime(current))}${current.demo?' · 演示记录':''}。此记录仅含过程统计，原文件请用对应软件打开。`;
      renderFileState();
      for(const record of result.records){if(seen.has(record.event.seq))continue;seen.add(record.event.seq);$('external-actions').append(renderRecord(record));}
      $('external-empty').hidden=seen.size>0;
      nextBefore=result.next_before;
      $('external-load-more').hidden=!result.has_more;
      if(result.has_more&&!Number.isSafeInteger(nextBefore))throw new Error('更早的记录暂时无法读取，请重新打开这份文档。');
    }finally{loading=false;$('external-load-more').disabled=false;if($('external-session-select'))$('external-session-select').disabled=false;}
  }
  async function open(document,group=[document],focus=true){
    if(loading)return;
    await flush();const requestToken=++token;current=document;sessions=group;nextBefore=null;seen.clear();
    const select=$('external-session-select');
    if(select){select.replaceChildren(...sessions.map(session=>{const option=element('option','',`${displayTime(recordTime(session))} · ${session.event_count} 条记录`);option.value=session.id;return option;}));select.value=document.id;select.hidden=sessions.length<2;select.disabled=true;}
    $('external-actions').replaceChildren();$('external-document-title').textContent=document.title;
    $('external-document-source').textContent=sourceLabel(document.source);$('external-document-summary').textContent='正在读取创作记录…';
    $('external-empty').hidden=true;$('external-load-more').hidden=true;renderFileState();
    ui.selectView('external-document');
    try{await loadPage(document.id,null,requestToken);if(focus&&requestToken===token)$('external-document-title').focus({preventScroll:true});}catch(error){$('external-document-summary').textContent='读取记录失败，请返回文档列表后重试。';throw error;}
  }
  $('external-session-select')?.addEventListener('change',async event=>{const selected=sessions.find(session=>session.id===event.target.value);if(selected){try{await open(selected,sessions,false);}catch(error){ui.showMessage(String(error),'error');}}});
  $('external-load-more').addEventListener('click',async()=>{if(!current||nextBefore===null)return;try{await loadPage(current.id,nextBefore,token);}catch(error){ui.showMessage(String(error),'error');}});
  $('external-back-library').addEventListener('click',()=>ui.selectView('library',true));
  $('external-open-file').addEventListener('click',async()=>{
    if(!current?.can_open)return;const button=$('external-open-file');button.disabled=true;
    try{await ipc('external_document_open',{id:current.id});}catch(error){ui.showMessage(String(error),'error');}finally{button.disabled=!current?.can_open;}
  });
  $('external-connection-help')?.addEventListener('click',()=>{
    const select=$('creation-tool');if([...select.options].some(option=>option.value===current?.source)){select.value=current.source;select.dispatchEvent(new Event('change'));}
    ui.selectView('connections',true);
  });
  return {open};
}
