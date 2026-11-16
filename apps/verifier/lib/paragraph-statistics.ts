import type {Proof} from './evidence';

type Interval = {first:number;last:number};
type ParagraphStats = {
  ordinal:number;
  inserted:number;
  deleted:number;
  observedMs:number;
  measuredInserted:number;
  bulk:Interval|null;
  replacement:Interval|null;
  firstSequence:number;
};

export function paragraphStatistics(proof:Proof){
  const result=new Map<number,ParagraphStats>();
  let previousOrdinal=0,previousSequence=0,previousTime=0;
  for(const location of proof.paragraphs??[]){
    let row=result.get(location.ordinal);
    if(!row){
      row={ordinal:location.ordinal,inserted:0,deleted:0,observedMs:0,measuredInserted:0,
        bulk:null,replacement:null,firstSequence:location.first_seq};
      result.set(location.ordinal,row);
    }
    for(let seq=location.first_seq;seq<=location.last_seq;seq++){
      const event=proof.records[seq]?.event;
      if(!event||event.seq!==seq||!['edit','interaction','undo','redo'].includes(event.kind)){
        previousOrdinal=0;
        continue;
      }
      if(!event.inserted&&!event.deleted)continue;
      row.inserted+=event.inserted;
      row.deleted+=event.deleted;
      const interval={first:seq,last:seq};
      if(event.inserted>=500&&!row.bulk)row.bulk=interval;
      if(event.inserted>=300&&event.deleted>=300&&!row.replacement)row.replacement=interval;

      // Use only successive edits with the same known location. Interleaved
      // non-edit checkpoints are harmless. Unassigned edits and gaps break it.
      if(previousOrdinal===location.ordinal){
        let continuous=true;
        for(let between=previousSequence+1;between<seq;between++){
          const middle=proof.records[between]?.event;
          if(!middle||middle.inserted||middle.deleted||['gap','pause','resume','stop'].includes(middle.kind)){
            continuous=false;
            break;
          }
        }
        const duration=event.elapsed_ms-previousTime;
        if(continuous&&duration>0&&duration<=2000){
          row.observedMs+=duration;
          row.measuredInserted+=event.inserted;
        }
      }
      previousOrdinal=location.ordinal;
      previousSequence=seq;
      previousTime=event.elapsed_ms;
    }
  }
  return [...result.values()].sort((a,b)=>a.ordinal-b.ordinal).map(row=>({
    ...row,rate:row.observedMs>0?row.measuredInserted*1000/row.observedMs:null,
  }));
}
