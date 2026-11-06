//! Versioned heuristics over authenticated statistics, independent of proof validity.
//! Local timing, large insertions and paste commands cannot establish authorship.
use std::collections::BTreeMap;
use serde::{Deserialize,Serialize};
use crate::{Evidence,Event,verify_evidence};

pub const VERSION:&str="workproof-behavior/1";
pub const RULE_VERSION:&str="heuristic-2026-11-06.1";
const MAX_SIGNALS:usize=8;
const BULK:u64=500;
const BURST_MS:u64=1000;
const RATE_WINDOW_MS:u64=5000;
const RATE_MAX_WINDOW_MS:u64=10000;

#[derive(Debug,Serialize,Deserialize)]
pub struct BehaviorSignal{
    pub code:String,
    pub severity:String,
    pub start_ms:u64,
    pub end_ms:u64,
    pub first_seq:u64,
    pub last_seq:u64,
    pub event_count:u64,
    pub inserted:u64,
    pub deleted:u64,
    pub details:BTreeMap<String,f64>,
}
#[derive(Debug,Default,Serialize,Deserialize)]
pub struct BehaviorSummary{
    pub events:u64,
    pub edits:u64,
    pub inserted:u64,
    pub deleted:u64,
    pub paste_commands:u64,
    pub bulk_inserted:u64,
    pub bulk_share:f64,
    pub duration_ms:u64,
}
#[derive(Debug,Serialize,Deserialize)]
pub struct BehaviorAssessment{
    pub version:String,
    pub rule_version:String,
    pub status:String,
    pub scope:String,
    pub signals:Vec<BehaviorSignal>,
    pub summary:BehaviorSummary,
    pub thresholds:BTreeMap<String,u64>,
    pub limitations:Vec<String>,
    pub signals_truncated:bool,
}
impl BehaviorAssessment{
    pub fn unavailable()->Self{Self::empty("unavailable","full")}
    fn empty(status:&str,scope:&str)->Self{
        let thresholds=BTreeMap::from([
            ("bulk_inserted".into(),BULK),("burst_window_ms".into(),BURST_MS),
            ("bulk_dominated_inserted".into(),2000),("bulk_dominated_percent".into(),75),
            ("replacement_inserted".into(),300),("replacement_deleted".into(),300),
            ("rate_window_ms".into(),RATE_WINDOW_MS),("rate_min_events".into(),5),
            ("rate_max_window_ms".into(),RATE_MAX_WINDOW_MS),
            ("rate_min_inserted".into(),300),("rate_chars_per_second".into(),30),
            ("rate_max_gap_ms".into(),2000),("rate_excludes_single_insert_at_least".into(),BULK),
            ("regular_min_events".into(),21),("regular_min_duration_ms".into(),5000),
            ("regular_min_inserted".into(),200),("regular_max_cv_percent".into(),5),
            ("regular_min_interval_ms".into(),50),("regular_max_interval_ms".into(),2000),
            ("max_signals".into(),MAX_SIGNALS as u64),
        ]);
        Self{version:VERSION.into(),rule_version:RULE_VERSION.into(),status:status.into(),scope:scope.into(),signals:vec![],summary:BehaviorSummary::default(),thresholds,
            limitations:vec![
                "规则尚未经真实中英文作业校准，提醒仅用于人工复核。".into(),
                "签名可核验记录的一致性，行为统计不能证明作者身份、人类创作或是否使用 AI。".into(),
                "大段插入可能来自粘贴、正常导入、输入法、语音输入、辅助工具或宿主批量采样；无法据此区分来源。".into(),
                "速率按客户端上报的本地经过时间计算，受时间精度、采样和记录遗漏影响。".into(),
                "只分析已签名的增删统计和命令计数，不读取正文；未发现提醒也不代表创作来源已获证明。".into(),
            ],signals_truncated:false}
    }
}

struct Hit{code:&'static str,severity:&'static str,left:usize,right:usize,details:BTreeMap<String,f64>}
fn add_hit(hits:&mut Vec<Hit>,hit:Hit,truncated:&mut bool){
    if let Some(existing)=hits.iter_mut().rev().find(|existing|existing.code==hit.code&&hit.left<=existing.right){
        existing.right=existing.right.max(hit.right);
        for(key,value)in hit.details{existing.details.entry(key).and_modify(|old|*old=old.max(value)).or_insert(value);}
    }else if hits.len()<MAX_SIGNALS{hits.push(hit);}else{*truncated=true;}
}
fn details(values:&[(&str,f64)])->BTreeMap<String,f64>{values.iter().map(|(key,value)|((*key).into(),*value)).collect()}

pub fn assess_behavior(evidence:&Evidence)->BehaviorAssessment{
    let(manifest,scope)=match evidence{Evidence::Full(proof)=>(&proof.manifest,"full"),Evidence::Selective(proof)=>(&proof.manifest,"selective")};
    let mut assessment=BehaviorAssessment::empty("unavailable",scope);
    // The claimed artifact digest establishes only certificate consistency here.
    // Caller verification against the actual file remains a separate operation.
    if !verify_evidence(evidence,&manifest.artifact_hash,manifest.artifact_bytes).valid{return assessment;}
    if let Evidence::Selective(proof)=evidence{
        assessment.status="insufficient".into();assessment.summary.events=proof.disclosed.len() as u64;
        assessment.limitations.insert(0,"仅提供部分记录，无法评估整个创作过程或比较总量占比。".into());return assessment;
    }
    let Evidence::Full(proof)=evidence else{unreachable!()};
    assessment.summary.events=proof.records.len() as u64;
    if matches!(manifest.source.as_str(),"photoshop"|"blender"){
        assessment.status="not_applicable".into();assessment.limitations.insert(0,"这份记录来自图像或三维软件，文字输入规则不适用。".into());return assessment;
    }
    if !matches!(manifest.source.as_str(),"workproof-tiptap"|"word"|"wps"|"vscode"|"powerpoint"|"synthetic-demo"){
        assessment.status="insufficient".into();assessment.limitations.insert(0,"尚未定义这个记录来源的文字统计语义，无法按当前输入规则评估。".into());return assessment;
    }
    assessment.summary.duration_ms=proof.records.last().map(|record|record.event.elapsed_ms).unwrap_or(0);
    for record in &proof.records{assessment.summary.paste_commands+=record.event.metrics.get("paste").copied().unwrap_or(0);}
    // Ignore save/start checkpoints, keyboard noise and undo/redo replay deltas.
    let edits:Vec<&Event>=proof.records.iter().map(|record|&record.event).filter(|event|event.kind=="edit"&&(event.inserted>0||event.deleted>0)).collect();
    assessment.summary.edits=edits.len() as u64;
    if edits.is_empty(){assessment.status="insufficient".into();return assessment;}
    let mut inserted=vec![0u64;edits.len()+1];let mut deleted=vec![0u64;edits.len()+1];
    let mut rate_inserted=vec![0u64;edits.len()+1];let mut rate_events=vec![0u64;edits.len()+1];
    for(index,event)in edits.iter().enumerate(){
        inserted[index+1]=inserted[index]+event.inserted;deleted[index+1]=deleted[index]+event.deleted;
        let eligible=event.inserted>0&&event.inserted<BULK;
        rate_inserted[index+1]=rate_inserted[index]+if eligible{event.inserted}else{0};
        rate_events[index+1]=rate_events[index]+u64::from(eligible);
    }
    assessment.summary.inserted=inserted[edits.len()];assessment.summary.deleted=deleted[edits.len()];
    // Difference markers count bulk-window membership once, even for overlapping
    // windows or 100,000 events sharing a timestamp. No nested rescanning.
    let mut bulk_coverage=vec![0i64;edits.len()+1];
    let mut hits=vec![];let mut replacement_hits=vec![];
    let mut bulk_left=0;let mut rate_left=0;
    let mut bulk_hits=vec![];let mut rate_hits=vec![];let mut truncated=false;
    for(right,event)in edits.iter().enumerate(){
        if right>0&&event.elapsed_ms-edits[right-1].elapsed_ms>2000{rate_left=right;}
        if event.inserted>=BULK{
            bulk_coverage[right]+=1;bulk_coverage[right+1]-=1;
            add_hit(&mut bulk_hits,Hit{code:"bulk_insertion",severity:"notice",left:right,right,details:details(&[("single_event_threshold",BULK as f64)])},&mut truncated);
        }
        while bulk_left<right&&event.elapsed_ms-edits[bulk_left].elapsed_ms>BURST_MS{bulk_left+=1;}
        let burst_inserted=inserted[right+1]-inserted[bulk_left];
        if right>bulk_left&&burst_inserted>=BULK{
            bulk_coverage[bulk_left]+=1;bulk_coverage[right+1]-=1;
            add_hit(&mut bulk_hits,Hit{code:"bulk_insertion",severity:"notice",left:bulk_left,right,details:details(&[("burst_window_ms",BURST_MS as f64)])},&mut truncated);
        }
        if event.inserted>=300&&event.deleted>=300{
            add_hit(&mut replacement_hits,Hit{code:"mass_replacement",severity:"notice",left:right,right,details:details(&[("inserted_threshold",300.0),("deleted_threshold",300.0)])},&mut truncated);
        }
        // Retain up to ten seconds of uninterrupted input. Keeping only the
        // nearest five-second predecessor would prevent modest sustained rates
        // from ever accumulating the independent 300-character minimum.
        while rate_left<right&&event.elapsed_ms-edits[rate_left].elapsed_ms>RATE_MAX_WINDOW_MS{rate_left+=1;}
        let duration=event.elapsed_ms-edits[rate_left].elapsed_ms;
        let count=rate_events[right+1]-rate_events[rate_left];let amount=rate_inserted[right+1]-rate_inserted[rate_left];
        if duration>=RATE_WINDOW_MS&&count>=5&&amount>=300&&amount*1000>=30*duration{
            add_hit(&mut rate_hits,Hit{code:"sustained_fast_input",severity:"warning",left:rate_left,right,details:details(&[("window_ms",duration as f64),("characters_per_second",amount as f64*1000.0/duration as f64)])},&mut truncated);
        }
    }
    let mut membership=0i64;
    for(index,event)in edits.iter().enumerate(){membership+=bulk_coverage[index];if membership>0{assessment.summary.bulk_inserted+=event.inserted;}}
    assessment.summary.bulk_share=if assessment.summary.inserted>0{assessment.summary.bulk_inserted as f64/assessment.summary.inserted as f64}else{0.0};
    if assessment.summary.inserted>=2000&&assessment.summary.bulk_inserted*100>=assessment.summary.inserted*75{
        hits.push(Hit{code:"bulk_dominated",severity:"warning",left:0,right:edits.len()-1,details:details(&[("bulk_share",assessment.summary.bulk_share),("minimum_total_inserted",2000.0)])});
    }
    // Reserve priority for whole-process share, sustained windows and replacement.
    for hit in rate_hits.into_iter().chain(replacement_hits).chain(bulk_hits){add_hit(&mut hits,hit,&mut truncated);}
    if manifest.source=="workproof-tiptap"{
        let positive:Vec<usize>=edits.iter().enumerate().filter(|(_,event)|event.inserted>0).map(|(index,_)|index).collect();
        if positive.len()>=21{
            let first=positive[0];let last=*positive.last().unwrap();let span=edits[last].elapsed_ms-edits[first].elapsed_ms;
            let mut count=0u64;let mut mean=0.0;let mut squares=0.0;let mut bounded=true;
            for pair in positive.windows(2){
                let interval=edits[pair[1]].elapsed_ms-edits[pair[0]].elapsed_ms;
                bounded&=(50..=2000).contains(&interval);count+=1;
                let delta=interval as f64-mean;mean+=delta/count as f64;squares+=delta*(interval as f64-mean);
            }
            let cv=if mean>0.0{(squares/count as f64).sqrt()/mean}else{f64::INFINITY};
            if bounded&&span>=5000&&assessment.summary.inserted>=200&&cv<=0.05{
                add_hit(&mut hits,Hit{code:"regular_timing",severity:"notice",left:first,right:last,details:details(&[("interval_cv",cv),("interval_mean_ms",mean),("interval_samples",count as f64)])},&mut truncated);
            }
        }
    }
    assessment.signals=hits.into_iter().map(|hit|BehaviorSignal{code:hit.code.into(),severity:hit.severity.into(),start_ms:edits[hit.left].elapsed_ms,end_ms:edits[hit.right].elapsed_ms,first_seq:edits[hit.left].seq,last_seq:edits[hit.right].seq,event_count:(hit.right-hit.left+1)as u64,inserted:inserted[hit.right+1]-inserted[hit.left],deleted:deleted[hit.right+1]-deleted[hit.left],details:hit.details}).collect();
    assessment.signals_truncated=truncated;
    let edit_span=edits.last().unwrap().elapsed_ms-edits[0].elapsed_ms;
    assessment.status=(if !assessment.signals.is_empty(){"review"}else if edits.len()<5||edit_span<5000{"insufficient"}else{"no_flags"}).into();
    assessment
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::{tests::sample,genesis,event_hash,digest,sign,Record,create_disclosure};
    use ed25519_dalek::SigningKey;
    fn proof(source:&str,changes:&[(u64,u64,u64)])->crate::Proof{
        let mut base=sample();let mut records=vec![];let mut head=genesis(&base.manifest.session_id);
        let mut events=vec![Event{seq:0,elapsed_ms:0,kind:"start".into(),inserted:0,deleted:0,chars:0,checkpoint:String::new(),metrics:Default::default()}];
        for &(time,inserted,deleted)in changes{events.push(Event{seq:events.len()as u64,elapsed_ms:time,kind:"edit".into(),inserted,deleted,chars:0,checkpoint:String::new(),metrics:Default::default()});}
        events.push(Event{seq:events.len()as u64,elapsed_ms:changes.last().map(|c|c.0).unwrap_or(0),kind:"save".into(),inserted:0,deleted:0,chars:0,checkpoint:digest(b"hello"),metrics:Default::default()});
        for event in events{head=event_hash(&head,&event);records.push(Record{event,hash:head.clone()});}
        base.manifest.source=source.into();base.manifest.event_count=records.len()as u64;base.manifest.chain_head=head;
        sign(base.manifest,records,&SigningKey::from_bytes(&[7;32]))
    }
    fn has(assessment:&BehaviorAssessment,code:&str)->bool{assessment.signals.iter().any(|signal|signal.code==code)}
    #[test]fn authentic_large_import_is_a_review_notice_and_never_authorship(){
        let assessment=assess_behavior(&Evidence::Full(proof("workproof-tiptap",&[(10,2500,0)])));
        assert_eq!(assessment.status,"review");assert!(has(&assessment,"bulk_insertion"));assert!(has(&assessment,"bulk_dominated"));
        assert!(!has(&assessment,"sustained_fast_input"));assert_eq!(assessment.summary.bulk_share,1.0);
        assert!(assessment.limitations.iter().any(|text|text.contains("正常导入")));
    }
    #[test]fn normal_ime_batches_and_office_polling_do_not_claim_mechanical_input(){
        let ime=assess_behavior(&Evidence::Full(proof("workproof-tiptap",&[(700,8,0),(1900,5,0),(2800,10,0),(5200,4,0),(8700,11,0)])));
        assert_eq!(ime.status,"no_flags");
        let polling:Vec<_>=(1..=30).map(|i|(i*1500,10,0)).collect();
        assert!(!has(&assess_behavior(&Evidence::Full(proof("word",&polling))),"regular_timing"));
        assert!(!has(&assess_behavior(&Evidence::Full(proof("wps",&polling))),"regular_timing"));
    }
    #[test]fn burst_of_small_same_timestamp_events_is_counted_once(){
        let events:Vec<_>=(0..40).map(|_|(500,100,0)).collect();let result=assess_behavior(&Evidence::Full(proof("vscode",&events)));
        assert!(has(&result,"bulk_insertion")&&has(&result,"bulk_dominated"));assert_eq!(result.summary.bulk_inserted,4000);assert_eq!(result.summary.inserted,4000);assert!(!has(&result,"sustained_fast_input"));assert!(result.signals.len()<=MAX_SIGNALS);
    }
    #[test]fn sustained_rate_replacement_and_tiptap_regular_intervals_have_minimum_samples(){
        let rate:Vec<_>=(0..12).map(|i|(i*1000,40,0)).collect();assert!(has(&assess_behavior(&Evidence::Full(proof("vscode",&rate))),"sustained_fast_input"));
        assert!(has(&assess_behavior(&Evidence::Full(proof("word",&[(1500,300,300)]))),"mass_replacement"));
        let regular:Vec<_>=(0..21).map(|i|(i*500,10,0)).collect();assert!(has(&assess_behavior(&Evidence::Full(proof("workproof-tiptap",&regular))),"regular_timing"));
        let short=assess_behavior(&Evidence::Full(proof("workproof-tiptap",&[(0,10,0),(500,10,0)])));assert_eq!(short.status,"insufficient");
        let import=proof("workproof-tiptap",&[(0,10000,0),(1000,1,0),(2000,1,0),(3000,1,0),(4000,1,0),(5000,1,0)]);
        assert!(!has(&assess_behavior(&Evidence::Full(import)),"sustained_fast_input"));
    }
    #[test]fn invalid_selective_and_graphic_evidence_do_not_produce_whole_process_conclusions(){
        let original=proof("word",&[(1000,5000,0)]);let mut changed=original.clone();changed.records[1].event.inserted=9000;
        let invalid=assess_behavior(&Evidence::Full(changed));assert_eq!(invalid.status,"unavailable");assert!(invalid.signals.is_empty());assert_eq!(invalid.summary.inserted,0);
        let selective=create_disclosure(&original,&[1]).unwrap();let partial=assess_behavior(&Evidence::Selective(selective));assert_eq!(partial.status,"insufficient");assert_eq!(partial.scope,"selective");assert!(partial.signals.is_empty());
        assert_eq!(assess_behavior(&Evidence::Full(proof("blender",&[(1000,5000,0)]))).status,"not_applicable");
        assert_eq!(assess_behavior(&Evidence::Full(proof("unknown-adapter",&[(1000,5000,0)]))).status,"insufficient");
        let clustered:Vec<_>=(0..5).map(|_|(1000,1,0)).collect();assert_eq!(assess_behavior(&Evidence::Full(proof("word",&clustered))).status,"insufficient");
    }
    #[test]fn many_separate_bursts_remain_bounded_and_preserve_full_summary(){
        let events:Vec<_>=(0..1000).map(|i|(i*2000,600,0)).collect();let result=assess_behavior(&Evidence::Full(proof("word",&events)));
        assert!(result.signals.len()<=MAX_SIGNALS);assert_eq!(result.summary.inserted,600000);assert_eq!(result.summary.bulk_inserted,600000);
        assert!(result.signals_truncated);
    }
    #[test]fn rate_window_accumulates_three_hundred_characters_without_weakening_other_gates(){
        let sustained:Vec<_>=(0..12).map(|i|(i*1000,40,0)).collect();
        let result=assess_behavior(&Evidence::Full(proof("workproof-tiptap",&sustained)));
        let signal=result.signals.iter().find(|signal|signal.code=="sustained_fast_input").expect("40 characters/second accumulates at least 300 over the longer bounded window");
        assert!(signal.inserted>=300);assert!(signal.details["window_ms"]>=5000.0);assert!(signal.details["window_ms"]<=10000.0);
        assert_eq!(result.thresholds["rate_max_window_ms"],10000);
        let polling:Vec<_>=(0..30).map(|i|(i*1500,10,0)).collect();
        for source in ["word","wps"]{assert!(!has(&assess_behavior(&Evidence::Full(proof(source,&polling))),"sustained_fast_input"));}
        let simultaneous:Vec<_>=(0..10).map(|_|(1000,400,0)).collect();
        let burst=assess_behavior(&Evidence::Full(proof("workproof-tiptap",&simultaneous)));
        assert!(has(&burst,"bulk_insertion"));assert!(!has(&burst,"sustained_fast_input"));
        let too_short:Vec<_>=(0..5).map(|i|(i*1000,80,0)).collect();
        assert!(!has(&assess_behavior(&Evidence::Full(proof("vscode",&too_short))),"sustained_fast_input"));
        let too_slow:Vec<_>=(0..30).map(|i|(i*1000,20,0)).collect();
        assert!(!has(&assess_behavior(&Evidence::Full(proof("vscode",&too_slow))),"sustained_fast_input"));
        let separated=[(0,80,0),(1000,80,0),(2000,80,0),(6000,80,0),(7000,80,0),(8000,80,0)];
        assert!(!has(&assess_behavior(&Evidence::Full(proof("vscode",&separated))),"sustained_fast_input"));
    }
}
