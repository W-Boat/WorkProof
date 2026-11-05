// Presentation only. Original events remain untouched and are saved separately.
const quiet=new Set(['keyboard','input','beforeinput','selection','transaction','compositionstart','compositionupdate','compositionend']);
const names={write:'连续写作',erase:'退格与删除',paste:'粘贴内容',copy:'复制',cut:'剪切',format:'调整格式',undo:'撤销',redo:'重做',layout:'调整版式',navigation:'浏览文档',session:'切换编辑状态',import:'导入文档'};
export function groupActions(newestFirst,gap=1800){
  const result=[];let buffer=[];
  for(const item of [...newestFirst].reverse()){
    const a=item.action,previous=result.at(-1);let type;
    if(quiet.has(a.kind)){if(previous&&a.elapsed_ms-previous.meaningfulEnd<=gap){previous.items.push(item);previous.end=a.elapsed_ms;}else buffer.push(item);continue;}
    if(a.kind==='edit'||a.kind==='markdown')type=a.deleted>a.inserted?'erase':'write';
    else if(['backspace','delete_forward'].includes(a.kind))type='erase';
    else if(['space','enter'].includes(a.kind))type='write';
    else if(a.kind==='cursor')type='navigation';
    else if(['focus','blur'].includes(a.kind))type='session';
    else type=Object.hasOwn(names,a.kind)?a.kind:'write';
    // A paste/cut DOM command and its immediately resulting transaction belong
    // to one operation. Later typing is a separate writing flow.
    if(a.kind==='edit'&&previous&&previous.edits===0&&['paste','cut'].includes(previous.type)&&a.elapsed_ms-previous.meaningfulEnd<250)type=previous.type;
    let group=previous;
    if(!group||group.type!==type||a.elapsed_ms-group.meaningfulEnd>gap){
      group={key:`${a.elapsed_ms}-${type}-${item.revision}`,type,label:names[type],start:a.elapsed_ms,end:a.elapsed_ms,meaningfulEnd:a.elapsed_ms,items:buffer,inserted:0,deleted:0,commands:0,edits:0,count:0,revision:item.revision};result.push(group);buffer=[];
    }else if(buffer.length){group.items.push(...buffer);buffer=[];}
    group.items.push(item);group.end=a.elapsed_ms;group.meaningfulEnd=a.elapsed_ms;group.revision=item.revision;
    group.inserted+=a.inserted||0;group.deleted+=a.deleted||0;
    if(a.kind==='edit'||a.kind==='markdown'||['format','undo','redo','import','layout'].includes(a.kind))group.edits++;
    else group.commands++;
    group.count=Math.max(1,group.commands,group.edits);
  }
  if(buffer.length)result.push({key:`${buffer[0].action.elapsed_ms}-navigation`,type:'navigation',label:'浏览与选择',start:buffer[0].action.elapsed_ms,end:buffer.at(-1).action.elapsed_ms,meaningfulEnd:buffer.at(-1).action.elapsed_ms,items:buffer,inserted:0,deleted:0,count:buffer.length,revision:buffer.at(-1).revision});
  return result.reverse();
}
