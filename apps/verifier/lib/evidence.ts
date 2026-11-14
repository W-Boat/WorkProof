export type RecordEntry={event:{seq:number;elapsed_ms:number;kind:string;inserted:number;deleted:number;chars:number;checkpoint:string;metrics?:Record<string,number>};hash:string};
export type Proof={manifest:{protocol:string;session_id:string;file_name:string;started_at:string;source:string;event_count:number;chain_head:string;artifact_hash:string;artifact_bytes:number;public_key:string;identity:string;time_evidence:string;demo:boolean;merkle_root?:string};records:RecordEntry[];signature:string};
export type Report={valid:boolean;file_match:boolean;chain_valid:boolean;signature_valid:boolean;merkle_valid:boolean|null;scope:"full"|"selective";disclosed_events:number;total_events:number;errors:string[]};
export type BehaviorSignal={code:string;severity:'notice'|'warning';start_ms:number;end_ms:number;first_seq:number;last_seq:number;event_count:number;inserted:number;deleted:number;details:Record<string,number>};
export type BehaviorAssessment={version:string;rule_version:string;status:'review'|'no_flags'|'insufficient'|'unavailable'|'not_applicable';scope:'full'|'selective';signals:BehaviorSignal[];signals_truncated?:boolean;measurements?:Record<string,number>;rule_results?:{code:string;status:'triggered'|'within_reference'|'insufficient'|'not_applicable'|'unavailable'}[];summary:{events:number;edits:number;inserted:number;deleted:number;paste_commands:number;bulk_inserted:number;bulk_share:number;duration_ms:number};thresholds:Record<string,number>;limitations:string[]};
export type Result={proof:Proof;report:Report;fingerprint:string;certificateId:string;certificateMatch:boolean|null;behavior?:BehaviorAssessment|null};
export type Stage='idle'|'working'|'done'|'error';
export function behaviorSummary(assessment?:BehaviorAssessment|null,scope:'full'|'selective'='full'){
  if(scope==='selective')return '过程信息不足（仅披露部分记录）';
  if(!assessment||['insufficient','unavailable'].includes(assessment.status))return '过程信息不足';
  if(assessment.status==='not_applicable')return '文字过程规则不适用';
  if(assessment.status==='review'&&assessment.signals.length)return `已显示 ${assessment.signals.length} 处过程提醒${assessment.signals_truncated?'（仅显示部分）':''}，需进一步复核`;
  if(assessment.status==='no_flags')return '过程统计暂未触发提醒';
  return '过程信息不足';
}
export const size=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
export const time=(ms:number)=>ms<60000?`${Math.floor(ms/1000)} 秒`:`${Math.floor(ms/60000)} 分 ${Math.floor(ms/1000)%60} 秒`;
export const shorten=(s:string)=>s.slice(0,12)+'…'+s.slice(-8);
export const labels:Record<string,string>={start:'开始记录',edit:'编辑',undo:'撤销',redo:'重做',save:'保存',pause:'暂停',resume:'继续',gap:'采集缺口',stop:'停止',mesh:'网格变化',modifier:'修改器变化',layer:'图层变化',viewport:'视口变化',interaction:'操作指令',format:'格式变化',layout:'版式变化'};
export const metricLabels:Record<string,string>={chars:'字符规模 · UTF-16',vertices:'网格顶点数',edges:'网格边数',faces:'网格面数',objects:'对象数',sheets:'工作表数',used_cells:'使用区域单元格数',pages:'页数',stories:'文本流数',modifiers:'修改器数',layers:'图层数',groups:'图层组数',visible_layers:'可见图层数',slides: "幻灯片数", shapes: "页面对象数", paragraphs:'段落数',characters:'字符数',viewport_changes:'视口变化采样数',backspace:'退格指令',delete_forward:'向前删除指令',space:'空格键指令',enter:'回车键指令',copy:'复制指令',paste:'粘贴指令',cut:'剪切指令',undo_commands:'撤销指令',redo_commands:'重做指令',format_commands:'格式快捷键指令',cursor_moves:'光标移动指令',layout_changes:'版式变化采样数',spaces_inserted:'新增空格数',line_breaks_inserted:'新增换行数',word_revision_tracking:'Word 修订开关（1 开启，0 关闭）',word_revision_total:'Word 正文修订标记',word_revision_insert:'插入标记',word_revision_delete:'删除标记',word_revision_format:'格式标记',word_revision_other:'其他标记'};
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function escape(s:string){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));}

