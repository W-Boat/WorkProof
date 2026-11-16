import type {Proof} from './evidence';

type Interval = {first:number;last:number};
type ParagraphStats = {
  ordinal:number;
  key:string;
  historical:boolean;
  inserted:number;
  deleted:number;
  observedMs:number;
  measuredInserted:number;
  bulk:Interval|null;
  replacement:Interval|null;
  firstSequence:number;
};

export function paragraphStatistics(proof:Proof){
  const result=new Map<string,ParagraphStats>();
  let previousKey='',previousSequence=0,previousTime=0;
  for(const location of proof.paragraphs??[]){
    const historical=location.historical_id!==undefined;
    const key=historical?'history-'+location.historical_id:'final-'+location.ordinal;
    let row=result.get(key);
    if(!row){
      row={ordinal:location.ordinal,key,historical,inserted:0,deleted:0,observedMs:0,measuredInserted:0,
        bulk:null,replacement:null,firstSequence:location.first_seq};
      result.set(key,row);
    }
    for(let seq=location.first_seq;seq<=location.last_seq;seq++){
      const event=proof.records[seq]?.event;
      if(!event||event.seq!==seq||!['edit','interaction','undo','redo'].includes(event.kind)){
        previousKey='';
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
      if(previousKey===key){
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
      previousKey=key;
      previousSequence=seq;
      previousTime=event.elapsed_ms;
    }
  }
  return [...result.values()].sort((a,b)=>a.ordinal-b.ordinal).map(row=>({
    ...row,rate:row.observedMs>0?row.measuredInserted*1000/row.observedMs:null,
  }));
}

export function wordParagraphSamples(proof:Proof){
  if(proof.manifest.source!=='word')return [];
  return proof.records.flatMap(({event},index)=>{
    const ordinal=event.metrics?.word_sample_paragraph??0;
    if(!Number.isSafeInteger(ordinal)||ordinal<1||event.kind!=='edit')return [];
    const previous=proof.records[index-1]?.event;
    const duration=previous?event.elapsed_ms-previous.elapsed_ms:0;
    const continuous=previous?.seq===event.seq-1&&previous.kind==='edit'&&
      previous.metrics?.word_sample_paragraph===ordinal&&duration>0&&duration<=5000;
    return [{event,rate:continuous?event.inserted*1000/duration:null}];
  });
}
