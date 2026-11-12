'use client';
import {useState,type ReactNode} from 'react';
import {BehaviorOverview} from './BehaviorOverview';
import {Details,Notice,Panel,Tag} from './institution-ui';
import {Button} from './button';
import {useEmbeddedFluent} from './fluent-embedded';
import {type BehaviorAssessment} from '../lib/evidence';
import {buildBehaviorReport,names} from '../lib/behavior-report-data';

export function BehaviorReport({assessment,valid,checks,reminders}:{assessment?:BehaviorAssessment|null;valid:boolean;checks?:ReactNode;reminders?:ReactNode}){
  const embedded=useEmbeddedFluent();
  const [filter,setFilter]=useState<'all'|'review'>('all');
  const {full,evaluated,triggered}=buildBehaviorReport(assessment,valid,embedded);
  if(embedded){
    const review=evaluated.filter(({state})=>state.flag);
    const remaining=evaluated.filter(({state})=>!state.flag);
    const ruleCount=full?Object.keys(names).filter(code=>triggered.has(code)).length:0;
    const assessed=full&&assessment?.rule_results?.some(rule=>rule.status==='within_reference');
    const ruleText=ruleCount?`${ruleCount} 类规则提示复核`:assessed?'已评估的规则未触发提醒':'可评估的文字编辑记录不足';
    const visibleRows=filter==='review'?review:[...review,...remaining];
    return <Panel id="verification-diagnosis" title="编辑过程检验单" className="behavior-report fluent-diagnosis">
      {checks}
      <Notice intent={ruleCount?'warning':'info'}><strong>{ruleText}</strong>
        <p>{ruleCount?'优先核对下方标红的项目，再查看对应时段。规则提示仅供人工复核。':assessment?.scope==='selective'?'这份证书仅披露部分记录，无法评估整段编辑过程。':'有足够数据的规则会给出结果，其余会标明条件不足。'}</p>
        <p aria-label="检验计数">规则库 {Object.keys(names).length} 类 · 全部指标 {evaluated.length} 项{full&&<> · 本次触发 {ruleCount} 类 · 关键指标需复核 {review.length} 项 · 已显示提醒 {assessment?.signals.length||0} 处</>}</p>
        <p>同一类规则可对应多个指标和提醒时段。这里只标红关键判定指标，关联的次数和窗口数保留在“全部指标”中。</p>
      </Notice>
      <div className="diagnosis-rule-list" aria-label="规则结果">
        {Object.entries(names).map(([code,name])=>{
          const status=full?assessment?.rule_results?.find(rule=>rule.code===code)?.status:undefined;
          const flagged=full&&triggered.has(code);
          return <div key={code}><span>{name}</span><Tag tone={flagged?'danger':status==='within_reference'?'ok':'neutral'}>{flagged?'需复核':status==='within_reference'?'未触发':status==='not_applicable'?'不适用':'条件不足'}</Tag></div>;
        })}
      </div>
      {reminders}
      <div className="diagnosis-summary">
        <div role="group" aria-label="筛选检验项"><Button variant={filter==='all'?'primary':'ghost'} aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>全部指标 ({evaluated.length})</Button><Button variant={filter==='review'?'primary':'ghost'} aria-pressed={filter==='review'} onClick={()=>setFilter('review')}>需复核指标 ({review.length})</Button></div>
        <span role="status">显示 {visibleRows.length} 项</span>
      </div>
      <div className="behavior-table-scroll verification-table-scroll" role="region" aria-label="完整编辑过程检验单，可横向滚动" tabIndex={0}>
        <table>
          <caption>编辑过程统计 · {assessment?.rule_version||'规则版本不可用'}</caption>
          <thead><tr><th scope="col">项目</th><th scope="col">实测</th><th scope="col">结果</th><th scope="col">触发条件或说明</th></tr></thead>
          <tbody>{visibleRows.map(({row,state})=><tr key={row.name} data-review={state.flag}>
            <th scope="row">{row.name}</th>
            <td>{row.value==null?'—':<>{row.value.toLocaleString('zh-CN',{maximumFractionDigits:2})} <span>{row.unit}</span></>}</td>
            <td className="measurement-result">{state.text}</td><td>{row.reference}</td>
          </tr>)}{!visibleRows.length&&<tr><td colSpan={4}>当前没有需要复核的指标。</td></tr>}</tbody>
        </table>
      </div>
      {full&&<Details label="查看指标雷达图与参考区间"><BehaviorOverview assessment={assessment} full/></Details>}
    </Panel>;
  }
  return <Panel title="编辑过程检验单" className="behavior-report">
    {checks}{reminders}
    <p>逐项列出实际测量值与参考条件。红色箭头表示对应的联合规则需要复核；信息不足显示“—”。这些参考条件是统计规则，不能据此认定创作者或 AI 使用情况。</p>
    <BehaviorOverview assessment={assessment} full={!!full}/>
    <div className="behavior-table-scroll" role="region" aria-label="完整编辑过程检验单，可横向滚动" tabIndex={0}><table><caption>编辑过程统计与参考条件 · {assessment?.rule_version||'评估不可用'}</caption><thead><tr><th scope="col">项目</th><th scope="col">测量值</th><th scope="col">单位</th><th scope="col">参考条件</th><th scope="col">结果</th></tr></thead><tbody>{evaluated.map(({row,state})=><tr key={row.name} data-review={state.flag}><th scope="row">{row.name}</th><td>{row.value===null||row.value===undefined?'—':row.value.toLocaleString('zh-CN',{maximumFractionDigits:2})}</td><td>{row.unit}</td><td>{row.reference}</td><td className="measurement-result">{state.text}</td></tr>)}</tbody></table></div>
    <div className="behavior-rule-results">{Object.entries(names).map(([code,name])=><p key={code}><strong>{name}</strong><span>{!full?'— 范围不足':triggered.has(code)?'↑ 规则已触发，需复核':assessment?.rule_results?.find(rule=>rule.code===code)?.status==='within_reference'?'未触发该项提醒':'— 样本或条件不足'}</span></p>)}</div>
  </Panel>;
}
