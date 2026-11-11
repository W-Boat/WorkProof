'use client';
import {AlertTriangle,Info,LocateFixed} from 'lucide-react';
import {Panel,Details} from './institution-ui';
import {Button} from './button';
import {type BehaviorAssessment,type BehaviorSignal,time} from '../lib/evidence';

const titles:Record<string,string>={bulk_insertion:'短时间写入了大段文字',bulk_dominated:'大部分新增文字集中在少数几次写入',sustained_fast_input:'一段时间内连续快速写入',regular_timing:'多次写入的时间间隔很接近',mass_replacement:'成段文字被同时删除并替换'};
const rules:Record<string,string>={rate_max_gap_ms:'持续速率中的最大相邻间隔（毫秒）',rate_excludes_single_insert_at_least:'持续速率排除的单次大段写入下限',bulk_inserted:'大段写入的字符数下限',burst_window_ms:'短时间写入的窗口（毫秒）',bulk_dominated_inserted:'集中写入评估的新增量下限',bulk_dominated_percent:'集中写入占比下限（%）',replacement_inserted:'成段替换的新增量下限',replacement_deleted:'成段替换的删除量下限',rate_window_ms:'速率评估窗口（毫秒）',rate_min_events:'速率评估最少修改次数',rate_min_inserted:'速率评估最少新增字符',rate_chars_per_second:'持续写入速率下限（字符/秒）',regular_min_events:'间隔评估最少修改次数',regular_min_duration_ms:'间隔评估最短跨度（毫秒）',regular_min_inserted:'间隔评估最少新增字符',regular_max_cv_percent:'时间间隔相对波动上限（%）',regular_min_interval_ms:'有效间隔下限（毫秒）',regular_max_interval_ms:'有效间隔上限（毫秒）',max_signals:'最多展示的提醒段数'};
export function BehaviorPanel({assessment,valid,onLocate}:{assessment?:BehaviorAssessment|null;valid:boolean;onLocate:(seq:number)=>void}){
  const usable=valid&&assessment!==null&&assessment!==undefined&&assessment.status!=='unavailable';
  const signals=usable?assessment.signals:[];
  const description=!usable?(valid?'编辑过程评估暂不可用，请更新完整核验工具后重试。':'当前无法评估编辑过程，请先确认作品与证书核验通过。'):assessment.status==='not_applicable'?'这份作品记录的是图层或三维结构，文字写入规则不适用。':assessment.scope==='selective'?'只看到了部分记录，无法评估整段创作过程。':assessment.status==='insufficient'?'可用的文字修改记录较少，暂时无法给出完整提醒。':signals.length?'这些时间段值得进一步了解，可以点击定位查看前后的编辑记录。':'按当前规则暂未发现需要提醒的文字变化。';
  function detail(signal:BehaviorSignal){
    return `${signal.event_count.toLocaleString()} 条记录 · 新增 ${signal.inserted.toLocaleString()} 字符 · 删除 ${signal.deleted.toLocaleString()} 字符${signal.details.characters_per_second!==undefined?` · 每秒约 ${signal.details.characters_per_second.toFixed(1)} 字符`:''}`;
  }
  return <Panel title="编辑过程提醒" className="behavior-panel">
    <div className={`behavior-intro ${signals.length?'has-notices':''}`}>{signals.length?<AlertTriangle size={20}/>:<Info size={20}/>}<p>{description}</p></div>
    <p className="behavior-explanation">提醒根据本机记录的字数、操作和时间间隔生成，用于辅助复核。粘贴、导入已有文稿、语音输入和辅助工具都可能产生这些变化，请结合创作者说明了解来源。这些统计无法判定内容由人或 AI 创作。</p>
    {signals.length>0&&<ol className="behavior-signals">{signals.map((signal,index)=><li key={`${signal.code}-${signal.first_seq}-${index}`}><div><strong>{titles[signal.code]||'这段编辑记录值得了解'}</strong><span>{time(signal.start_ms)}{signal.end_ms!==signal.start_ms?` — ${time(signal.end_ms)}`:''}</span><p>{detail(signal)}</p>{signal.code==='bulk_insertion'&&<p>可能包含粘贴或导入，请查看这段文字是怎样进入文档的。</p>}</div><Button variant="ghost" onClick={()=>onLocate(signal.first_seq)} aria-label={`定位提醒 ${index+1}`}><LocateFixed size={16}/>定位</Button></li>)}</ol>}
    {usable&&assessment.signals_truncated&&<p className="caption">本页展示部分提醒，请结合完整记录继续查看。</p>}
    {usable&&<Details label="查看统计范围与提醒规则" className="behavior-rules">{assessment.scope==='selective'?<p>当前仅查看已披露的 {assessment.summary.events.toLocaleString()} 条记录，完整修改量与粘贴次数暂不可评估。</p>:<p>当前查看 {assessment.summary.events.toLocaleString()} 条记录，其中包含 {assessment.summary.edits.toLocaleString()} 次文字修改。已记录 {assessment.summary.paste_commands.toLocaleString()} 次粘贴指令。</p>}<p>粘贴指令表示操作被触发，实际写入量以文字修改记录为准。记录时间来自本机，不是外部可信时间。</p>{assessment.limitations.map((line,index)=><p key={index}>{line}</p>)}<p>规则版本 {assessment.rule_version}</p><dl>{Object.entries(assessment.thresholds).map(([key,value])=><div key={key}><dt>{rules[key]||'其他规则参数'}</dt><dd>{value}</dd></div>)}</dl></Details>}
  </Panel>;
}
