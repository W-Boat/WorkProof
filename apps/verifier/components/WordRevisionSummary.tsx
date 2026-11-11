import {useMemo} from 'react';
import {Details} from './institution-ui';
import {type RecordEntry,time} from '../lib/evidence';

export function WordRevisionSummary({records,partial}:{records:RecordEntry[];partial:boolean}){
  const {first,last,observations}=useMemo(()=>{
    const observed=records.filter(({event})=>event.metrics?.word_revision_total!==undefined||event.metrics?.word_revision_tracking!==undefined);
    return {first:observed[0],last:observed.at(-1),observations:observed.length};
  },[records]);
  if(!last)return null;
  const metrics=last.event.metrics!;
  const initial=first?.event.kind==='start'?first.event.metrics?.word_revision_total:undefined;
  const state=metrics.word_revision_tracking===1?'已开启':metrics.word_revision_tracking===0?'已关闭':'未读取';
  return <Details label="查看 Word 修订采样">
    <p>可见 {observations.toLocaleString('zh-CN')} 次修订采样{partial?'，仅含已披露记录':''}。最后一次在 {time(last.event.elapsed_ms)}，修订开关{state}。</p>
    <dl className="word-revision-summary">
      {initial!==undefined&&<div><dt>开始记录时已有标记</dt><dd>{initial}</dd></div>}
      {metrics.word_revision_total!==undefined&&<div><dt>最后一次采样保留的正文修订标记</dt><dd>{metrics.word_revision_total}</dd></div>}
      {metrics.word_revision_insert!==undefined&&<div><dt>按类型</dt><dd>插入 {metrics.word_revision_insert} · 删除 {metrics.word_revision_delete} · 格式 {metrics.word_revision_format} · 其他 {metrics.word_revision_other}</dd></div>}
    </dl>
    <p>接受、拒绝或合并修订会改变标记数量。这里展示各次采样保留的标记，可在过程轨迹查看相应事件。</p>
  </Details>;
}
