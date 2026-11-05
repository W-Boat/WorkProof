'use client';
import {useMemo} from 'react';
import {commandLabels,summarizeActions} from '../lib/actions';
import {type RecordEntry,labels} from '../lib/evidence';
import styles from './ActionBreakdown.module.css';

export function ActionBreakdown({records}:{records:RecordEntry[]}){
  const {commands,observations}=useMemo(()=>summarizeActions(records),[records]);
  const maximum=Math.max(1,...commands.map(([,count])=>count));
  return <section className={styles.panel} aria-label="操作统计">
    <h3>具体做了哪些操作</h3>
    <p>操作指令和文档变化分别统计，方便查看修改过程。</p>
    {commands.length?<><h4>捕获到的键盘操作</h4><dl className={styles.rows}>{commands.map(([key,count])=><div key={key}><dt>{commandLabels[key]}</dt><dd><span className={styles.track} aria-hidden="true"><i style={{width:`${count/maximum*100}%`}}/></span><strong>{count.toLocaleString()} 次</strong></dd></div>)}</dl></>:<p className={styles.empty}>这份记录没有提供键盘操作次数。未采集的动作不会显示为零。</p>}
    {observations.length>0&&<><h4>观察到的文档变化</h4><dl className={styles.observations}>{observations.map(([kind,count])=><div key={kind}><dt>{labels[kind]}</dt><dd>{count.toLocaleString()} 次</dd></div>)}</dl></>}
    <p className="caption">键盘操作表示收到指令，不代表执行成功。鼠标菜单、输入法和触屏操作可能未计入；格式与版式按采样比较，短时间内的多次修改可能合并。这里只统计已披露的记录，不读取文字或剪贴板内容。</p>
  </section>;
}
