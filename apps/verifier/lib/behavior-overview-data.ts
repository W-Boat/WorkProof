import {type BehaviorAssessment} from './evidence';
export function behaviorAxes(assessment:BehaviorAssessment|null|undefined,full:boolean){
  const m=assessment?.measurements||{},t=assessment?.thresholds||{};
  const ratio=(value:number|undefined,limit:number|undefined)=>{if(!Number.isFinite(value)||!Number.isFinite(limit)||limit!<=0)return null;const result=value!/limit!;return Number.isFinite(result)?result:null;};
  const replacement=[ratio(m.peak_replacement_inserted,t.replacement_inserted),ratio(m.peak_replacement_deleted,t.replacement_deleted)];
  const axes=[
    {code:'bulk_insertion',label:'集中写入',value:ratio(Math.max(m.peak_single_inserted??NaN,m.peak_burst_inserted??NaN),t.bulk_inserted)},
    {code:'bulk_dominated',label:'集中写入占比',value:ratio((assessment?.summary?.bulk_share??NaN)*100,t.bulk_dominated_percent)},
    {code:'sustained_fast_input',label:'持续写入速率',value:ratio(m.peak_qualified_rate_chars_per_second,t.rate_chars_per_second)},
    {code:'regular_timing',label:'间隔规律程度',value:m.interval_cv_percent===0?Infinity:ratio(t.regular_max_cv_percent,m.interval_cv_percent)},
    {code:'mass_replacement',label:'成段替换',value:replacement.every(v=>v!==null)?Math.min(...replacement as number[]):null},
  ].map(axis=>{const status=assessment?.rule_results?.find(rule=>rule.code===axis.code)?.status;return {...axis,status,value:full&&['triggered','within_reference'].includes(status||'')?axis.value:null};});
  return axes;
}
