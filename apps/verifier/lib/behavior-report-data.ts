import {type BehaviorAssessment} from './evidence';
export type Row={key?:string;name:string;value:number|null|undefined;unit:string;reference:string;code?:string;direction?:'up'|'down';status?:string};
export const names:Record<string,string>={bulk_insertion:'大段或短时集中写入',bulk_dominated:'集中写入占比',sustained_fast_input:'持续高速写入',regular_timing:'写入间隔过于接近',mass_replacement:'成段替换'};
const primaryMeasurements:Record<string,string[]>={bulk_insertion:['peak_single_inserted','peak_burst_inserted'],bulk_dominated:['bulk_share'],sustained_fast_input:['peak_qualified_rate_chars_per_second'],regular_timing:['interval_cv_percent'],mass_replacement:['peak_replacement_inserted','peak_replacement_deleted']};
export function buildBehaviorReport(assessment:BehaviorAssessment|null|undefined,valid:boolean,embedded=true){
  const available=!!(valid&&assessment&&assessment.status!=='unavailable'),full=available&&assessment.scope==='full'&&assessment.status!=='not_applicable'&&assessment.measurements!==undefined&&Object.keys(assessment.measurements).length>0;
  const summary=assessment?.summary,thresholds=assessment?.thresholds||{};
  const triggered=new Set(assessment?.rule_results?assessment.rule_results.filter(rule=>rule.status==='triggered').map(rule=>rule.code):assessment?.signals.map(signal=>signal.code)||[]);
  const measured=assessment?.measurements||{};
  const reference=(key:string,unit='')=>thresholds[key]===undefined?'未提供':`${thresholds[key].toLocaleString()}${unit}`;
  const rows:Row[]=[
    {name:'可见记录',value:available?summary?.events:null,unit:'条',reference:assessment?.scope==='selective'?'仅已披露记录':'已核验的记录数量'},
    {name:'文字修改',value:full?summary?.edits:null,unit:'次',reference:'统计有新增或删除的编辑事件'},
    {name:'累计新增',value:full?summary?.inserted:null,unit:'字符',reference:'编辑记录的新增量之和'},
    {name:'累计删除',value:full?summary?.deleted:null,unit:'字符',reference:'编辑记录的删除量之和'},
    {name:'记录跨度',value:full&&summary?summary.duration_ms/1000:null,unit:'秒',reference:'记录起点至最后事件，不等同于实际劳动时间'},
    {name:'粘贴指令',value:full?summary?.paste_commands:null,unit:'次',reference:'操作被触发的次数；不等于粘贴成功次数'},
    {name:'集中写入的新增量',value:full?summary?.bulk_inserted:null,unit:'字符',reference:`单次或 ${reference('burst_window_ms',' 毫秒')} 内累计新增 ≥ ${reference('bulk_inserted',' 字符')}`,code:'bulk_insertion'},
    {key:'bulk_share',name:'集中写入占比',value:full&&summary?summary.bulk_share*100:null,unit:'%',reference:`累计新增 ≥ ${reference('bulk_dominated_inserted',' 字符')}，且集中写入占比 ≥ ${reference('bulk_dominated_percent','%')}`,code:'bulk_dominated'},
  ];
  const extra:{key:string;name:string;unit:string;reference:string;code:string;direction?:'up'|'down'}[]=[
    {key:'peak_single_deleted',name:'单次最大删除',unit:'字符',reference:'实际观测值，无独立提醒阈值',code:''},
    {key:'edit_span_ms',name:'首末文字修改跨度',unit:'毫秒',reference:'从第一次到最后一次文字修改',code:''},
    {key:'peak_single_inserted',name:'单次最大新增',unit:'字符',reference:`单次新增 ≥ ${reference('bulk_inserted',' 字符')}`,code:'bulk_insertion'},
    {key:'peak_burst_inserted',name:'短时累计最大新增',unit:'字符',reference:`${reference('burst_window_ms',' 毫秒')} 内新增 ≥ ${reference('bulk_inserted',' 字符')}`,code:'bulk_insertion'},
    {key:'bulk_insert_events',name:'单次达到大段写入阈值的事件',unit:'次',reference:'单次新增达到大段写入阈值的编辑事件数',code:'bulk_insertion'},
    {key:'bulk_burst_windows',name:'达到集中写入条件的窗口',unit:'个',reference:'重叠窗口可能包含同一批文字',code:'bulk_insertion'},
    {key:'rate_windows_evaluated',name:'有效速率窗口',unit:'个',reference:`排除单次 ≥ ${reference('rate_excludes_single_insert_at_least',' 字符')} 的写入，相邻间隔 ≤ ${reference('rate_max_gap_ms',' 毫秒')}`,code:'sustained_fast_input'},
    {key:'rate_qualified_windows',name:'达到速率评估样本要求的窗口',unit:'个',reference:`修改 ≥ ${reference('rate_min_events',' 次')} 且新增 ≥ ${reference('rate_min_inserted',' 字符')}`,code:'sustained_fast_input'},
    {key:'peak_rate_chars_per_second',name:'最高观测窗口写入速率',unit:'字符/秒',reference:'实际观测峰值；是否达到完整样本要求见下方判定窗口',code:''},
    {key:'peak_rate_window_ms',name:'最高速率窗口跨度',unit:'毫秒',reference:`同一窗口跨度 ${reference('rate_window_ms')} — ${reference('rate_max_window_ms',' 毫秒')}`,code:''},
    {key:'peak_rate_edits',name:'最高速率窗口修改次数',unit:'次',reference:`同一窗口 ≥ ${reference('rate_min_events',' 次')}`,code:''},
    {key:'peak_rate_inserted',name:'最高速率窗口新增量',unit:'字符',reference:'与最高观测速率属于同一窗口，可能尚未达到完整样本要求',code:''},
    {key:'peak_qualified_rate_chars_per_second',name:'判定窗口最高写入速率',unit:'字符/秒',reference:`完整窗口速率 ≥ ${reference('rate_chars_per_second',' 字符/秒')}`,code:'sustained_fast_input'},
    {key:'peak_qualified_rate_window_ms',name:'判定窗口跨度',unit:'毫秒',reference:`${reference('rate_window_ms')} — ${reference('rate_max_window_ms',' 毫秒')}`,code:''},
    {key:'peak_qualified_rate_edits',name:'判定窗口修改次数',unit:'次',reference:`同一窗口 ≥ ${reference('rate_min_events',' 次')}`,code:''},
    {key:'peak_qualified_rate_inserted',name:'判定窗口新增量',unit:'字符',reference:`同一窗口 ≥ ${reference('rate_min_inserted',' 字符')}`,code:''},
    {key:'regular_events',name:'间隔评估修改次数',unit:'次',reference:`≥ ${reference('regular_min_events',' 次')}`,code:''},
    {key:'regular_duration_ms',name:'间隔评估跨度',unit:'毫秒',reference:`≥ ${reference('regular_min_duration_ms',' 毫秒')}`,code:''},
    {key:'regular_inserted',name:'间隔评估新增量',unit:'字符',reference:`≥ ${reference('regular_min_inserted',' 字符')}`,code:''},
    {key:'mean_interval_ms',name:'平均写入间隔',unit:'毫秒',reference:`各间隔需处于 ${reference('regular_min_interval_ms')} — ${reference('regular_max_interval_ms',' 毫秒')}`,code:''},
    {key:'interval_samples',name:'实际间隔样本',unit:'个',reference:'相邻文字修改的时间差样本',code:''},
    {key:'stddev_interval_ms',name:'间隔标准差',unit:'毫秒',reference:'间隔波动的实际大小，无独立提醒阈值',code:''},
    {key:'interval_cv_percent',name:'写入间隔相对波动',unit:'%',reference:`波动 ≤ ${reference('regular_max_cv_percent','%')} 且满足样本、时长和新增量要求`,code:'regular_timing',direction:'down'},
    {key:'min_interval_ms',name:'最短写入间隔',unit:'毫秒',reference:`≥ ${reference('regular_min_interval_ms',' 毫秒')}`,code:''},
    {key:'max_interval_ms',name:'最长写入间隔',unit:'毫秒',reference:`≤ ${reference('regular_max_interval_ms',' 毫秒')}`,code:''},
    {key:'peak_replacement_inserted',name:'同次替换新增量',unit:'字符',reference:`同一事件新增 ≥ ${reference('replacement_inserted',' 字符')}，且删除 ≥ ${reference('replacement_deleted',' 字符')}`,code:'mass_replacement'},
    {key:'peak_replacement_deleted',name:'同次替换删除量',unit:'字符',reference:'与上一项属于同一事件，两项同时达到条件才触发',code:'mass_replacement'},
    {key:'peak_replacement_min',name:'同次替换的较小一侧',unit:'字符',reference:'用于选择同一个新增、删除均较大的事件',code:''},
    {key:'mass_replacement_events',name:'达到成段替换条件的事件',unit:'次',reference:'同一事件的新增量、删除量同时达到参考条件',code:'mass_replacement'},
  ];
  rows.push(...extra.map(row=>({...row,value:full?measured[row.key]:null})));
  function result(row:Row){
    if(row.value===undefined||row.value===null)return {text:'— 信息不足',flag:false};
    if(!row.code)return {text:'记录值',flag:false};
    if(embedded&&!primaryMeasurements[row.code]?.includes(row.key||''))return {text:'记录值',flag:false};
    if(['bulk_insert_events','bulk_burst_windows','rate_windows_evaluated','rate_qualified_windows','mass_replacement_events'].includes(row.key||'')&&row.value===0)return {text:'记录值',flag:false};
    if(['peak_single_inserted','peak_burst_inserted'].includes(row.key||'')&&row.value<(thresholds.bulk_inserted??Infinity))return {text:'未达到该项阈值',flag:false};
    if(triggered.has(row.code))return {text:`${row.direction==='down'?'↓':'↑'} 需复核`,flag:true};
    const status=assessment?.rule_results?.find(rule=>rule.code===row.code)?.status;
    if(status==='not_applicable')return {text:'— 此项不适用',flag:false};
    if(status!=='within_reference')return {text:'— 条件不足',flag:false};
    return {text:'未触发该项提醒',flag:false};
  }
  const evaluated=rows.map(row=>({row,state:result(row)}));
  return {available,full,rows,evaluated,triggered};
}
