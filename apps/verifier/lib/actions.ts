import type {RecordEntry} from './evidence';

export const commandLabels:Record<string,string>={backspace:'退格',delete_forward:'向前删除',space:'空格',enter:'回车',copy:'复制',paste:'粘贴',cut:'剪切',undo_commands:'撤销',redo_commands:'重做',format_commands:'格式快捷键',cursor_moves:'移动光标'};
export function summarizeActions(records:RecordEntry[]){
  const commands=new Map<string,number>();
  const observations=new Map<string,number>();
  for(const {event} of records){
    for(const key of Object.keys(commandLabels)){
      const count=event.metrics?.[key];
      if(typeof count==='number'&&Number.isSafeInteger(count)&&count>0)commands.set(key,(commands.get(key)||0)+count);
    }
    if(['undo','redo','format','layout'].includes(event.kind))observations.set(event.kind,(observations.get(event.kind)||0)+1);
  }
  return {commands:[...commands].sort((a,b)=>b[1]-a[1]),observations:[...observations]};
}
