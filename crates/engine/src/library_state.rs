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

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn archive_trash_and_restore_preserve_document_content(){
        let root=std::env::temp_dir().join(format!("workproof-library-{}",crate::random_hex(16)));
        std::fs::create_dir(&root).unwrap();
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
        std::fs::remove_dir_all(&root).unwrap();
    }
}
