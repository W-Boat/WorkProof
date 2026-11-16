import {Panel} from './institution-ui';
import {Button} from './button';
import {type Proof,time} from '../lib/evidence';

export function ParagraphReport({proof,onLocate}:{proof:Proof;onLocate?:(seq:number)=>void}){
  if(!['workproof-tiptap','word','wps'].includes(proof.manifest.source))return null;
  const locations=proof.paragraphs||[];
  return <Panel title="段落与记录位置">
    {locations.length===0?<p>这份证书没有可核验的段落位置，可在时间轴查看操作记录。</p>:
      <div className="behavior-table-scroll"><table>
        <thead><tr><th>最终段落</th><th>新增</th><th>删除</th><th>时间</th><th>写入速度</th><th>操作</th></tr></thead>
        <tbody>{locations.map(location=>{
          const event=proof.records[location.first_seq]?.event;
          if(!event)return null;
          return <tr key={location.first_seq}>
            <td>第 {location.ordinal} 段</td><td>{event.inserted}</td><td>{event.deleted}</td>
            <td>{time(event.elapsed_ms)}</td><td>单次采样</td>
            <td>{onLocate&&<Button variant="secondary" onClick={()=>onLocate(location.first_seq)}>查看记录</Button>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
  </Panel>;
}
