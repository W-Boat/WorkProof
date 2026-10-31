export type RecordEntry={event:{seq:number;elapsed_ms:number;kind:string;inserted:number;deleted:number;chars:number;checkpoint:string;metrics?:Record<string,number>};hash:string};
export type Proof={manifest:{protocol:string;session_id:string;file_name:string;started_at:string;source:string;event_count:number;chain_head:string;artifact_hash:string;artifact_bytes:number;public_key:string;identity:string;time_evidence:string;demo:boolean;merkle_root?:string};records:RecordEntry[];signature:string};
export type Report={valid:boolean;file_match:boolean;chain_valid:boolean;signature_valid:boolean;merkle_valid:boolean|null;scope:"full"|"selective";disclosed_events:number;total_events:number;errors:string[]};
export type Result={proof:Proof;report:Report;fingerprint:string};
export type Stage='idle'|'working'|'done'|'error';
export const size=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
export const time=(ms:number)=>ms<60000?`${Math.floor(ms/1000)} 秒`:`${Math.floor(ms/60000)} 分 ${Math.floor(ms/1000)%60} 秒`;
export const shorten=(s:string)=>s.slice(0,12)+'…'+s.slice(-8);
export const labels:Record<string,string>={start:'开始记录',edit:'编辑',undo:'撤销',redo:'重做',save:'保存',pause:'暂停',resume:'继续',gap:'采集缺口',stop:'停止',mesh:'网格变化',modifier:'修改器变化',layer:'图层变化',viewport:'视口变化'};
export const metricLabels:Record<string,string>={chars:'字符规模 · UTF-16',vertices:'网格顶点数',edges:'网格边数',faces:'网格面数',objects:'对象数',modifiers:'修改器数',layers:'图层数',groups:'图层组数',visible_layers:'可见图层数',paragraphs:'段落数',characters:'字符数',viewport_changes:'视口变化采样数'};
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function escape(s:string){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));}

