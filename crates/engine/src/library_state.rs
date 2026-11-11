//! Private desktop library organization, separate from signed records.
use std::{path::Path,time::Duration};
use rusqlite::{Connection,params};
use serde_json::{Value,json};

fn database(root:&Path)->Result<Connection,String>{
    let db=Connection::open(root.join("library.sqlite")).map_err(|_|"无法打开文档管理数据。")?;
    db.busy_timeout(Duration::from_secs(3)).map_err(|_|"文档管理数据暂不可用。")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS entries(kind TEXT NOT NULL,id TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(kind,id));").map_err(|_|"无法准备文档管理数据。")?;
    Ok(db)
}
pub fn list(root:&Path)->Result<Value,String>{
    let db=database(root)?;
    let mut statement=db.prepare("SELECT kind,id,state FROM entries").map_err(|_|"无法读取文档状态。")?;
    let rows=statement.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(|_|"无法读取文档状态。")?;
    let mut values=serde_json::Map::new();
    for row in rows{
        let (kind,id,state)=row.map_err(|_|"无法读取文档状态。")?;
        values.insert(format!("{kind}:{id}"),state.into());
    }
    Ok(Value::Object(values))
}
pub fn set(root:&Path,kind:&str,ids:&[String],state:&str)->Result<Value,String>{
    if !matches!(kind,"editor"|"external")||!matches!(state,"active"|"archived"|"trash")||ids.is_empty()||ids.len()>2000{
        return Err("文档管理请求无效。".into());
    }
    for id in ids{
        if kind=="editor"{super::editor::load(root,id)?;}else{super::catalog::load(root,id,None,1)?;}
    }
    let mut db=database(root)?;
    let tx=db.transaction().map_err(|_|"无法更新文档状态。")?;
    for id in ids{
        tx.execute("INSERT INTO entries(kind,id,state) VALUES(?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET state=excluded.state",params![kind,id,state]).map_err(|_|"无法更新文档状态。")?;
    }
    tx.commit().map_err(|_|"无法保存文档状态。")?;
    Ok(json!({"state":state}))
}

/// Explicit permanent deletion of private WorkProof content, never source files.
pub fn delete(root:&Path,kind:&str,ids:&[String])->Result<Value,String>{
    if !matches!(kind,"editor"|"external")||ids.is_empty()||ids.len()>2000{return Err("删除请求无效。".into());}
    let filename=if kind=="editor"{"editor.sqlite"}else{"records.sqlite"};
    let mut db=Connection::open(root.join(filename)).map_err(|_|"无法打开文档数据。")?;
    db.busy_timeout(Duration::from_secs(3)).map_err(|_|"文档数据暂不可用。")?;
    db.execute_batch("PRAGMA foreign_keys=ON").map_err(|_|"无法准备删除文档。")?;
    let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|"文档正在使用，请稍后重试。")?;
    // Validate the complete batch before modifying any rows.
    for id in ids{
        let found:bool=tx.query_row(if kind=="editor"{"SELECT EXISTS(SELECT 1 FROM documents WHERE id=?1)"}else{"SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)"},[id],|row|row.get(0)).map_err(|_|"无法读取待删除的文档。")?;
        if !found{return Err("待删除的文档已不存在，请刷新列表。".into());}
    }
    for id in ids{
        if kind=="editor"{
            for sql in ["DELETE FROM editor_events WHERE document=?1","DELETE FROM revisions WHERE document=?1","DELETE FROM document_types WHERE document=?1","DELETE FROM documents WHERE id=?1"]{
                tx.execute(sql,[id]).map_err(|_|"文档未删除，请重试。")?;
            }
        }else{
            for sql in ["DELETE FROM events WHERE session=?1","DELETE FROM session_files WHERE session=?1","DELETE FROM session_activity WHERE session=?1","DELETE FROM sessions WHERE id=?1"]{
                tx.execute(sql,[id]).map_err(|_|"创作记录未删除，请重试。")?;
            }
        }
    }
    tx.commit().map_err(|_|"删除未能保存，请重试。")?;
    // Orphaned organization flags never recreate deleted content. Cleanup is
    // best effort after the authoritative content transaction commits.
    if let Ok(flags)=database(root){for id in ids{let _=flags.execute("DELETE FROM entries WHERE kind=?1 AND id=?2",params![kind,id]);}}
    Ok(json!({"deleted":ids.len()}))
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn archive_trash_and_restore_preserve_document_content(){
        let root=std::env::temp_dir().join(format!("workproof-library-{}",crate::random_hex(16)));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("signing-key.bin"),[7u8;32]).unwrap();
        let document=crate::editor::create(&root,"保留原文","2026-11-12T00:00:00Z","word").unwrap();
        let id=document["id"].as_str().unwrap().to_string();
        let before=crate::editor::load(&root,&id).unwrap();
        for state in ["archived","trash","active"]{
            set(&root,"editor",&[id.clone()],state).unwrap();
            assert_eq!(list(&root).unwrap()[format!("editor:{id}")],state);
            assert_eq!(crate::editor::load(&root,&id).unwrap(),before);
        }
        assert!(set(&root,"editor",&[id.clone()],"invalid").is_err());
        assert!(set(&root,"external",&["missing".into()],"trash").is_err());
        assert_eq!(list(&root).unwrap()[format!("editor:{id}")],"active");
        assert!(delete(&root,"editor",&[id.clone(),"missing".into()]).is_err());
        assert_eq!(crate::editor::load(&root,&id).unwrap(),before);
        delete(&root,"editor",&[id.clone()]).unwrap();
        assert!(crate::editor::load(&root,&id).is_err());
        let db=Connection::open(root.join("editor.sqlite")).unwrap();
        for table in ["revisions","editor_events","document_types"]{
            let count:u64=db.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE document=?1"),[&id],|row|row.get(0)).unwrap();assert_eq!(count,0);
        }
        drop(db);
        std::fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn external_deletion_preserves_the_original_file(){
        let root=std::env::temp_dir().join(format!("workproof-delete-{}",crate::random_hex(16)));
        let store=crate::Store::open(&root,0).unwrap();
        let original=root.join("original.docx");std::fs::write(&original,b"original bytes").unwrap();
        store.db.execute("INSERT INTO sessions(id,name,started,source) VALUES('remove-me','original.docx','2026-11-12T00:00:00Z','word')",[]).unwrap();
        store.db.execute("INSERT INTO session_files(session,local_path) VALUES('remove-me',?1)",[original.to_str().unwrap()]).unwrap();
        store.db.execute("INSERT INTO events(session,seq,json,hash) VALUES('remove-me',0,'{}','hash')",[]).unwrap();
        store.db.execute("INSERT INTO session_activity(session,received_ms) VALUES('remove-me',1)",[]).unwrap();
        delete(&root,"external",&["remove-me".into()]).unwrap();
        for table in ["sessions","events","session_files","session_activity"]{
            let count:u64=store.db.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|row|row.get(0)).unwrap();assert_eq!(count,0);
        }
        assert_eq!(std::fs::read(original).unwrap(),b"original bytes");drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
