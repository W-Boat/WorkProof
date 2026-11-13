use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

pub const MIN_LIMIT: u64 = 100;
pub const MAX_LIMIT: u64 = workproof_protocol::MAX_EVENTS as u64 - 16;

pub(crate) fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS recording_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1), event_limit INTEGER NOT NULL
    );")
}

pub(crate) fn read(db: &Connection) -> rusqlite::Result<Option<u64>> {
    db.query_row("SELECT event_limit FROM recording_settings WHERE id=1", [], |row| row.get(0))
        .optional()
}

pub fn load(root: &Path) -> Result<Option<u64>, String> {
    // Direct editor clients can initialize their private store before a collector exists.
    let path = root.join("records.sqlite");
    if !path.exists() {
        return Ok(None);
    }
    let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "无法读取记录设置。")?;
    db.busy_timeout(std::time::Duration::from_secs(5)).map_err(|_| "无法读取记录设置。")?;
    let initialized: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='recording_settings')", [], |row| row.get(0))
        .map_err(|_| "无法读取记录设置。")?;
    if !initialized {
        return Ok(None);
    }
    read(&db).map_err(|_| "无法读取记录设置。".into())
}

pub fn save(root: &Path, limit: Option<u64>) -> Result<(), String> {
    if limit.is_some_and(|value| !(MIN_LIMIT..=MAX_LIMIT).contains(&value)) {
        return Err(format!("记录上限须在 {MIN_LIMIT} 至 {MAX_LIMIT} 之间。"));
    }
    let db = Connection::open_with_flags(root.join("records.sqlite"), rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|_| "无法保存记录设置。")?;
    db.busy_timeout(std::time::Duration::from_secs(5)).map_err(|_| "无法保存记录设置。")?;
    match limit {
        Some(value) => db.execute("INSERT INTO recording_settings VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET event_limit=excluded.event_limit", [value]),
        None => db.execute("DELETE FROM recording_settings WHERE id=1", []),
    }.map_err(|_| "无法保存记录设置。")?;
    Ok(())
}
