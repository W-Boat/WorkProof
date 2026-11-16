'use client';
import {useMemo,useState} from 'react';
import {Panel} from './institution-ui';
import {Button} from './button';
import type {Proof} from '../lib/evidence';
import {paragraphStatistics} from '../lib/paragraph-statistics';

const PAGE_SIZE=50;

export function ParagraphReport({proof,onLocate}:{proof:Proof;onLocate?:(seq:number)=>void}){
  const rows=useMemo(()=>paragraphStatistics(proof),[proof]);
  const [page,setPage]=useState(0);
  if(!['workproof-tiptap','word','wps'].includes(proof.manifest.source))return null;
  const current=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1));
  return <Panel title="段落与记录位置">
    {rows.length===0?<p>这份证书没有可核验的段落位置，可在时间轴查看操作记录。</p>:<>
      <div className="behavior-table-scroll"><table>
        <thead><tr><th>最终段落</th><th>新增</th><th>删除</th><th>观察时长</th><th>写入速度</th><th>复核结果</th><th>操作</th></tr></thead>
        <tbody>{rows.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE).map(row=><tr key={row.ordinal}>
          <td>第 {row.ordinal} 段</td><td>{row.inserted.toLocaleString()}</td><td>{row.deleted.toLocaleString()}</td>
          <td>{row.observedMs?row.observedMs/1000+' 秒':'条件不足'}</td>
          <td>{row.rate===null?'条件不足':row.rate.toFixed(1)+' 字符/秒'}</td>
          <td>{[row.bulk&&'单次新增至少 500 字符',row.replacement&&'单次增删各至少 300 字符'].filter(Boolean).join('、')||'已归属事件未触发'}</td>
          <td>{onLocate&&<Button variant="secondary" onClick={()=>onLocate(row.bulk?.first??row.replacement?.first??row.firstSequence)}>查看记录</Button>}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="nv-actions">
        <Button disabled={current===0} onClick={()=>setPage(current-1)}>上一页</Button>
        <span>{current+1} / {Math.ceil(rows.length/PAGE_SIZE)}</span>
        <Button disabled={(current+1)*PAGE_SIZE>=rows.length} onClick={()=>setPage(current+1)}>下一页</Button>
      </div>
    </>}
  </Panel>;
}
