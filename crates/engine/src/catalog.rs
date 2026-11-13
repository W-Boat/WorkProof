//! Desktop-only catalog of external-app sessions. Listing/history use read-only
//! SQLite connections; explicit location updates write only a private hint.
//! No HTTP listing, proof mutation or file-content reading occurs.
use std::{path::Path,time::Duration};
use rusqlite::{Connection,OpenFlags};
use serde::Serialize;
use workproof_protocol::{Event,Record};

type Result<T>=std::result::Result<T,String>;
fn storage(_:impl std::fmt::Display)->String{"无法读取创作记录，请稍后重试。".into()}

#[derive(Clone,Serialize)]
pub struct ExternalDocument{
    pub id:String,pub title:String,pub source:String,pub started_at:String,
    pub event_count:u64,pub last_elapsed_ms:Option<u64>,pub last_kind:Option<String>,pub demo:bool,
    /// Native adapter hint only. Never included in a proof or public endpoint.
    pub local_path:Option<String>,
    /// Wall-clock receipt time exists only for events accepted after migration.
    pub modified_ms:Option<u64>,
    /// SQLite insertion order, not a timestamp, for ordering legacy sessions.
    pub recent_order:i64,
}
#[derive(Serialize)]
pub struct ExternalHistory{
    pub document:ExternalDocument,
    /// Newest-first existing protocol records. This view is not a certificate.
    pub records:Vec<Record>,pub has_more:bool,pub next_before:Option<u64>,
}
fn open(root:&Path)->Result<Option<Connection>>{
    let path=root.join("records.sqlite");
    if !path.is_file(){return Ok(None);}
    let db=Connection::open_with_flags(path,OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(storage)?;
    db.busy_timeout(Duration::from_secs(3)).map_err(storage)?;
    Ok(Some(db))
}
fn exists(db:&Connection,table:&str)->Result<bool>{
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",[table],|row|row.get(0)).map_err(storage)
}
fn documents(db:&Connection,id:Option<&str>)->Result<Vec<ExternalDocument>>{
    if !exists(db,"sessions")?||!exists(db,"events")?{return Ok(vec![]);}
    // Legacy files lack the private side tables. Read them without migrating.
    let path=if exists(db,"session_files")?{"(SELECT local_path FROM session_files WHERE session=s.id)"}else{"NULL"};
    let modified=if exists(db,"session_activity")?{"(SELECT received_ms FROM session_activity WHERE session=s.id)"}else{"NULL"};
    let sql=format!("SELECT s.id,s.name,s.source,s.started,s.demo,{path},{modified},
      (SELECT COUNT(*) FROM events e WHERE e.session=s.id),
      COALESCE((SELECT MAX(rowid) FROM events e WHERE e.session=s.id),0),
      (SELECT json FROM events e WHERE e.session=s.id ORDER BY seq DESC LIMIT 1)
      FROM sessions s WHERE (?1 IS NULL OR s.id=?1) ORDER BY 9 DESC,s.rowid DESC LIMIT 2000");
    let mut query=db.prepare(&sql).map_err(storage)?;
    let rows=query.query_map([id],|row|{
        let last:Option<String>=row.get(9)?;
        let event=last.and_then(|json|serde_json::from_str::<Event>(&json).ok());
        Ok(ExternalDocument{id:row.get(0)?,title:row.get(1)?,source:row.get(2)?,started_at:row.get(3)?,demo:row.get(4)?,local_path:row.get(5)?,modified_ms:row.get(6)?,event_count:row.get(7)?,recent_order:row.get(8)?,last_elapsed_ms:event.as_ref().map(|e|e.elapsed_ms),last_kind:event.map(|e|e.kind)})
    }).map_err(storage)?;
    rows.collect::<std::result::Result<Vec<_>,_>>().map_err(storage)
}
/// Read up to 2000 external-app sessions, including legacy sessions and ones
/// with no accepted events. Missing storage returns an empty catalog.
pub fn list(root:&Path)->Result<Vec<ExternalDocument>>{
    let Some(db)=open(root)? else{return Ok(vec![]);};
    documents(&db,None)
}
/// Associate a user-selected file with an existing record. This private hint
/// does not change event bytes, receipt times, or signed proof fields.
pub fn locate(root:&Path,id:&str,path:&Path)->Result<ExternalDocument>{
    let previous=load(root,id,None,1)?.document;
    let text=path.to_str().ok_or("文件位置无法保存，请使用有效的文件名。")?;
    if !path.is_absolute()||!path.is_file()||text.len()>32768||text.chars().any(char::is_control){return Err("请选择当前可以访问的原文件。".into());}
    let name=path.file_name().and_then(|name|name.to_str()).ok_or("文件名无法读取。")?;
    let matches=if cfg!(windows){name.to_lowercase()==previous.title.to_lowercase()}else{name==previous.title};
    if !matches{return Err(format!("请选择文件名为“{}”的作品。",previous.title));}
    let mut db=Connection::open_with_flags(root.join("records.sqlite"),OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(storage)?;
    db.busy_timeout(Duration::from_secs(3)).map_err(storage)?;
    db.execute_batch("PRAGMA foreign_keys=ON;").map_err(storage)?;
    let tx=db.transaction().map_err(storage)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS session_files(session TEXT PRIMARY KEY,local_path TEXT NOT NULL,FOREIGN KEY(session) REFERENCES sessions(id));").map_err(storage)?;
    let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1 AND name=?2)",rusqlite::params![id,previous.title],|row|row.get(0)).map_err(storage)?;
    if !exists{return Err("记录已变化，请重新打开文档列表。".into());}
    tx.execute("INSERT INTO session_files(session,local_path) VALUES(?1,?2) ON CONFLICT(session) DO UPDATE SET local_path=excluded.local_path",rusqlite::params![id,text]).map_err(storage)?;
    let document=documents(&tx,Some(id))?.pop().ok_or("创作记录未找到。")?;
    tx.commit().map_err(storage)?;
    Ok(document)
}
/// Read at most 500 recent records and 2MiB per page. `before_seq` is exclusive.
/// The local path is a hint; callers must check file existence themselves and
/// obtain an explicit user action before opening it in its host application.
pub fn load(root:&Path,id:&str,before_seq:Option<u64>,limit:usize)->Result<ExternalHistory>{
    if id.len()!=32||!id.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())||before_seq.is_some_and(|seq|seq>i64::MAX as u64){return Err("请选择有效的创作记录。".into());}
    let db=open(root)?.ok_or("尚未找到这份创作记录。")?;
    let tx=db.unchecked_transaction().map_err(storage)?;
    let document=documents(&tx,Some(id))?.pop().ok_or("尚未找到这份创作记录。")?;
    let limit=limit.clamp(1,500);
    let mut statement=tx.prepare("SELECT seq,json,hash FROM events WHERE session=?1 AND (?2 IS NULL OR seq<?2) ORDER BY seq DESC LIMIT ?3").map_err(storage)?;
    let mut rows=statement.query(rusqlite::params![id,before_seq,limit+1]).map_err(storage)?;
    let mut records=Vec::new();let mut bytes=0;let mut has_more=false;
    while let Some(row)=rows.next().map_err(storage)?{
        if records.len()==limit{has_more=true;break;}
        let seq:u64=row.get(0).map_err(storage)?;
        let json:String=row.get(1).map_err(storage)?;
        let hash:String=row.get(2).map_err(storage)?;
        bytes+=json.len();
        if bytes>2*1024*1024{
            if records.is_empty(){return Err("这条记录过大，暂时无法显示。".into());}
            has_more=true;break;
        }
        let event:Event=serde_json::from_str(&json).map_err(|_|"记录内容已损坏，无法显示过程。")?;
        if event.seq!=seq||!workproof_protocol::validate_event(&event)||!workproof_protocol::valid_hash(&hash){return Err("记录内容已损坏，无法显示过程。".into());}
        records.push(Record{event,hash});
    }
    let next_before=if has_more{records.last().map(|record|record.event.seq)}else{None};
    Ok(ExternalHistory{document,records,has_more,next_before})
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::{Store,ConnectionInfo,Start,Batch,Export};
    use axum::{extract::{State,Path as RoutePath},http::{HeaderMap,HeaderValue,StatusCode},Json};
    use std::{path::PathBuf,sync::{Arc,Mutex},collections::BTreeMap};
    const BASE:&str="CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,started TEXT NOT NULL,source TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);CREATE TABLE events(session TEXT NOT NULL,seq INTEGER NOT NULL,json TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(session,seq),FOREIGN KEY(session) REFERENCES sessions(id));";
    const PRIVATE:&str="CREATE TABLE session_files(session TEXT PRIMARY KEY,local_path TEXT NOT NULL,FOREIGN KEY(session) REFERENCES sessions(id));CREATE TABLE session_activity(session TEXT PRIMARY KEY,received_ms INTEGER NOT NULL,FOREIGN KEY(session) REFERENCES sessions(id));";
    struct Temp(PathBuf);
    impl Temp{fn new()->Self{let root=std::env::temp_dir().join(format!("workproof-catalog-{}",crate::random_hex(12)));std::fs::create_dir_all(&root).unwrap();Self(root)}}
    impl Drop for Temp{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
    fn event(seq:u64,kind:&str)->Event{Event{seq,elapsed_ms:seq*100,kind:kind.into(),inserted:0,deleted:0,chars:0,checkpoint:if kind=="save"{"a".repeat(64)}else{String::new()},metrics:BTreeMap::new()}}
    fn state()->(crate::Shared,HeaderMap){
        let db=Connection::open_in_memory().unwrap();db.execute_batch(BASE).unwrap();db.execute_batch(PRIVATE).unwrap();crate::recording_settings::initialize(&db).unwrap();
        let store=Store{db,key:ed25519_dalek::SigningKey::from_bytes(&[4;32]),info:ConnectionInfo{port:43127,token:"catalog-test-token".into()}};
        let mut headers=HeaderMap::new();headers.insert("authorization",HeaderValue::from_static("Bearer catalog-test-token"));
        (Arc::new(Mutex::new(store)),headers)
    }
    fn input(path:Option<String>)->Start{serde_json::from_value(serde_json::json!({"file_name":"draft.docx","started_at":"2026-11-06T00:00:00Z","source":"word","local_path":path})).unwrap()}
    #[test]
    fn locating_a_legacy_file_keeps_record_bytes_and_accepts_only_the_original_name(){
        let temp=Temp::new();let db=Connection::open(temp.0.join("records.sqlite")).unwrap();db.execute_batch(BASE).unwrap();
        let id="c".repeat(32);db.execute("INSERT INTO sessions VALUES(?1,'draft.docx','2020-01-01','word',0)",[&id]).unwrap();
        let json=serde_json::to_string(&event(0,"start")).unwrap();let hash="a".repeat(64);
        db.execute("INSERT INTO events VALUES(?1,0,?2,?3)",rusqlite::params![id,json,hash]).unwrap();
        let right=temp.0.join("draft.docx");let wrong=temp.0.join("other.docx");std::fs::write(&right,b"fixture").unwrap();std::fs::write(&wrong,b"fixture").unwrap();
        assert!(locate(&temp.0,&id,&wrong).is_err());assert!(locate(&temp.0,&id,Path::new("draft.docx")).is_err());
        let located=locate(&temp.0,&id,&right).unwrap();assert_eq!(located.local_path.as_deref(),right.to_str());assert_eq!(located.event_count,1);assert!(located.modified_ms.is_none());
        let stored:(String,String)=db.query_row("SELECT json,hash FROM events WHERE session=?1",[&id],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();assert_eq!(stored,(json,hash));
        assert!(!exists(&db,"session_activity").unwrap());
        std::fs::remove_file(&right).unwrap();assert!(locate(&temp.0,&id,&right).is_err());
        assert_eq!(list(&temp.0).unwrap()[0].local_path,located.local_path);
    }
    #[test]
    fn legacy_reads_never_migrate_and_history_pages_are_stable(){
        let temp=Temp::new();assert!(list(&temp.0).unwrap().is_empty());assert!(!temp.0.join("records.sqlite").exists());
        let db=Connection::open(temp.0.join("records.sqlite")).unwrap();db.execute_batch(BASE).unwrap();
        let id="a".repeat(32);
        db.execute("INSERT INTO sessions VALUES(?1,'legacy.docx','2020-01-01','word',0)",[&id]).unwrap();
        for seq in 0..3{let event=event(seq,if seq==0{"start"}else{"edit"});db.execute("INSERT INTO events VALUES(?1,?2,?3,?4)",rusqlite::params![id,seq,serde_json::to_string(&event).unwrap(),"b".repeat(64)]).unwrap();}
        let docs=list(&temp.0).unwrap();assert_eq!(docs.len(),1);assert_eq!(docs[0].event_count,3);assert!(docs[0].local_path.is_none());assert!(docs[0].modified_ms.is_none());
        let first=load(&temp.0,&id,None,2).unwrap();assert_eq!(first.records.iter().map(|r|r.event.seq).collect::<Vec<_>>(),vec![2,1]);assert!(first.has_more);assert_eq!(first.next_before,Some(1));
        let last=load(&temp.0,&id,first.next_before,2).unwrap();assert_eq!(last.records[0].event.seq,0);assert!(!last.has_more);
        assert!(!exists(&db,"session_files").unwrap());assert!(!exists(&db,"session_activity").unwrap());
    }
    #[tokio::test]
    async fn path_is_private_and_duplicate_events_do_not_change_receipt_time(){
        let (shared,headers)=state();let path=std::env::temp_dir().join("private-catalog.docx").to_string_lossy().into_owned();
        let Json(created)=crate::start(State(shared.clone()),headers.clone(),Json(input(Some(path.clone())))).await.ok().unwrap();
        let id=created["session_id"].as_str().unwrap().to_string();
        let events=vec![event(0,"start"),event(1,"save")];
        crate::append(State(shared.clone()),headers.clone(),RoutePath(id.clone()),Json(Batch{events:events.clone()})).await.ok().unwrap();
        {let store=shared.lock().unwrap();let stored:String=store.db.query_row("SELECT local_path FROM session_files WHERE session=?1",[&id],|r|r.get(0)).unwrap();assert_eq!(stored,path);store.db.execute("UPDATE session_activity SET received_ms=123 WHERE session=?1",[&id]).unwrap();}
        crate::append(State(shared.clone()),headers.clone(),RoutePath(id.clone()),Json(Batch{events})).await.ok().unwrap();
        let Json(proof)=crate::export(State(shared.clone()),headers,RoutePath(id.clone()),Json(Export{artifact_hash:"a".repeat(64),artifact_bytes:1})).await.ok().unwrap();
        let serialized=serde_json::to_string(&proof).unwrap();assert!(!serialized.contains("private-catalog"));assert!(!serialized.contains("local_path"));assert!(workproof_protocol::verify(&proof,&"a".repeat(64),1).valid);
        let store=shared.lock().unwrap();let received:i64=store.db.query_row("SELECT received_ms FROM session_activity WHERE session=?1",[&id],|r|r.get(0)).unwrap();assert_eq!(received,123);
    }
    #[tokio::test]
    async fn recording_limit_allows_exact_retries_and_final_export() {
        let (shared, headers) = state();
        shared.lock().unwrap().db.execute("INSERT INTO recording_settings VALUES(1,100)", []).unwrap();
        let Json(session) = crate::start(State(shared.clone()), headers.clone(), Json(input(None))).await.ok().unwrap();
        let id = session["session_id"].as_str().unwrap().to_owned();
        let mut events = vec![event(0, "start")];
        events.extend((1..100).map(|seq| event(seq, "edit")));
        for batch in [events.clone(), events] {
            assert!(crate::append(State(shared.clone()), headers.clone(), RoutePath(id.clone()), Json(Batch{events:batch})).await.is_ok());
        }
        let error = crate::append(State(shared.clone()), headers.clone(), RoutePath(id.clone()), Json(Batch{events:vec![event(100,"edit")]})).await.err().unwrap();
        assert_eq!(error.1, "RECORD_LIMIT_REACHED");
        assert!(crate::append(State(shared.clone()), headers.clone(), RoutePath(id.clone()), Json(Batch{events:vec![event(100,"save")]})).await.is_ok());
        let Json(proof) = crate::export(State(shared), headers, RoutePath(id), Json(Export{artifact_hash:"a".repeat(64),artifact_bytes:1})).await.ok().unwrap();
        assert_eq!(proof.records.len(), 101);
        assert!(workproof_protocol::verify(&proof, &"a".repeat(64), 1).valid);
    }
    #[tokio::test]
    async fn failed_private_binding_rolls_back_the_session(){
        let (shared,headers)=state();shared.lock().unwrap().db.execute_batch("CREATE TRIGGER fail_path BEFORE INSERT ON session_files BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        let path=std::env::temp_dir().join("private.docx").to_string_lossy().into_owned();
        assert!(crate::start(State(shared.clone()),headers,Json(input(Some(path)))).await.is_err());
        let count:u64=shared.lock().unwrap().db.query_row("SELECT COUNT(*) FROM sessions",[],|r|r.get(0)).unwrap();assert_eq!(count,0);
    }
    #[tokio::test]
    async fn approved_browser_can_start_but_cannot_bind_a_local_path(){
        let (shared,_)=state();let mut headers=HeaderMap::new();headers.insert("origin",HeaderValue::from_static("https://catalog-fixture.example"));
        let Json(request)=crate::pairing::request_pair(headers.clone(),Json(serde_json::from_value(serde_json::json!({"source":"word"})).unwrap())).await.ok().unwrap();
        crate::pairing::decide(&request.ticket,true).unwrap();
        let Json(grant)=crate::pairing::poll_pair(headers.clone(),RoutePath(request.ticket.clone())).await.ok().unwrap();
        headers.insert("authorization",HeaderValue::from_str(&format!("Bearer {}",grant["token"].as_str().unwrap())).unwrap());
        let path=std::env::temp_dir().join("private.docx").to_string_lossy().into_owned();
        let error=crate::start(State(shared.clone()),headers.clone(),Json(input(Some(path)))).await.err().unwrap();assert_eq!(error.0,StatusCode::FORBIDDEN);
        assert!(crate::start(State(shared.clone()),headers,Json(input(None))).await.is_ok());
        crate::pairing::revoke(&request.ticket).unwrap();
    }
}
