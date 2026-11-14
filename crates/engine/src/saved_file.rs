//! Saved-file observations for SAI2. Not a host plugin, stroke recorder or publisher identity.
//! A native caller must obtain explicit file selection before constructing this recorder.
use super::*;
use std::{collections::BTreeMap, io::Read, path::{Path as FilePath, PathBuf}, time::{Duration, Instant, SystemTime}};

pub const SOURCE:&str="sai2-file";
const MAX_BYTES:u64=8*1024*1024*1024;
const OBSERVATION_LIMIT:u64=MAX_EVENTS as u64-16;

#[derive(Clone,PartialEq,Eq)]
struct Stamp {bytes:u64,modified:SystemTime}
struct Fingerprint {hash:String,stamp:Stamp}
fn metadata(path:&FilePath)->Result<Stamp,String>{
    let value=std::fs::metadata(path).map_err(|_|"原文件暂时无法读取，请确认文件仍在原位置。")?;
    if !value.is_file()||value.len()==0||value.len()>MAX_BYTES{return Err("请使用不超过 8 GiB 的非空普通文件。".into());}
    Ok(Stamp{bytes:value.len(),modified:value.modified().map_err(|_|"无法确认文件的保存状态。")?})
}
fn hash_file(path:&FilePath)->Result<Fingerprint,String>{
    let before=metadata(path)?;
    let mut file=std::fs::File::open(path).map_err(|_|"作品正在保存或无法读取，请稍后重试。")?;
    let opened=file.metadata().map_err(|_|"无法确认文件状态。")?;
    if opened.len()!=before.bytes||opened.modified().ok()!=Some(before.modified){return Err("读取前文件已改变，请稍后重试。".into());}
    let mut hasher=blake3::Hasher::new();let mut bytes=0u64;let mut buffer=[0u8;65536];
    loop{
        let count=file.read(&mut buffer).map_err(|_|"读取作品失败，已有记录已保留。")?;
        if count==0{break;}
        bytes+=count as u64;
        if bytes>MAX_BYTES{return Err("作品超过 8 GiB，已停止读取。".into());}
        hasher.update(&buffer[..count]);
    }
    let after=metadata(path)?;
    let held=file.metadata().map_err(|_|"读取后无法确认文件状态。")?;
    if before!=after||bytes!=before.bytes||held.len()!=bytes||held.modified().ok()!=Some(before.modified){
        return Err("读取期间文件仍在变化，请保存完成后重试。".into());
    }
    Ok(Fingerprint{hash:hasher.finalize().to_hex().to_string(),stamp:after})
}
async fn fingerprint(path:PathBuf)->Result<Fingerprint,String>{
    tokio::task::spawn_blocking(move||hash_file(&path)).await.map_err(|_|"文件摘要任务未完成。".to_string())?
}
fn api(error:ApiError)->String{format!("记录未能保存（{}），已有记录仍保留。",error.1)}

#[derive(Serialize)]
pub struct RecordingStatus {
    pub session_id:String,pub file_name:String,pub source:&'static str,
    pub coverage:&'static str,pub events:u64,pub paused:bool,
}

pub struct SavedFileRecorder {
    store:Shared,headers:HeaderMap,path:PathBuf,root:PathBuf,id:String,name:String,
    sequence:u64,started:Instant,paused:bool,last:Fingerprint,
    candidate:Option<(Stamp,Instant)>,pending:Option<Event>,
}

impl SavedFileRecorder {
    /// No web request accepts a path. Only a trusted native file-selection flow may call this.
    pub async fn begin(root:PathBuf,path:PathBuf,started_at:String)->Result<Self,String>{
        if !root.join("signing-key.bin").is_file(){return Err("请先启动 WorkProof 记录服务。".into());}
        if !path.is_absolute()||!path.extension().and_then(|value|value.to_str()).is_some_and(|value|value.eq_ignore_ascii_case("sai2")){
            return Err("请选择已保存的 .sai2 作品。".into());
        }
        let path=std::fs::canonicalize(path).map_err(|_|"无法定位这份作品。")?;
        let name=path.file_name().and_then(|name|name.to_str()).ok_or("文件名无法读取。")?.to_string();
        let local_path=path.to_str().ok_or("文件路径无法读取。")?.to_string();
        let last=fingerprint(path.clone()).await?;
        let db_root=root.clone();
        let store=tokio::task::spawn_blocking(move||{
            let store=Store::open(&db_root,43127).map_err(|_|"无法打开本机记录库。".to_string())?;
            store.db.busy_timeout(Duration::from_secs(5)).map_err(|_|"无法配置记录库。".to_string())?;
            Ok::<_,String>(store)
        }).await.map_err(|_|"无法准备记录库。")??;
        // This capability stays inside Rust. It is not the running HTTP collector's token,
        // never reads connection.json, and never crosses into a webview or host application.
        let mut headers=HeaderMap::new();
        headers.insert("authorization",axum::http::HeaderValue::from_str(&format!("Bearer {}",store.info.token)).map_err(|_|"无法准备记录授权。")?);
        let shared=Arc::new(Mutex::new(store));
        let Json(created)=super::start(State(shared.clone()),headers.clone(),Json(Start{
            file_name:name.clone(),started_at,source:SOURCE.into(),demo:false,local_path:Some(local_path)
        })).await.map_err(api)?;
        let id=created["session_id"].as_str().ok_or("记录编号未返回。")?.to_string();
        let mut recorder=Self{store:shared,headers,path,root,id,name,sequence:0,started:Instant::now(),paused:false,last,
            candidate:None,pending:None};
        recorder.emit("start",recorder.last.hash.clone()).await?;
        Ok(recorder)
    }

    pub fn status(&self)->RecordingStatus{
        RecordingStatus{session_id:self.id.clone(),file_name:self.name.clone(),source:SOURCE,
            coverage:"saved-file-only",events:self.sequence,paused:self.paused}
    }

    async fn flush(&mut self)->Result<(),String>{
        let Some(event)=self.pending.clone()else{return Ok(());};
        let Json(result)=super::append(State(self.store.clone()),self.headers.clone(),Path(self.id.clone()),Json(Batch{events:vec![event]})).await.map_err(api)?;
        if result["next_seq"].as_u64()!=Some(self.sequence+1){return Err("记录序号未被确认，待保存内容已保留。".into());}
        self.sequence+=1;self.pending=None;Ok(())
    }

    async fn emit(&mut self,kind:&str,checkpoint:String)->Result<(),String>{
        self.flush().await?;
        self.pending=Some(Event{seq:self.sequence,elapsed_ms:self.started.elapsed().as_millis().min(31_536_000_000) as u64,
            kind:kind.into(),inserted:0,deleted:0,chars:0,checkpoint,metrics:BTreeMap::new()});
        self.flush().await
    }

    /// Called on an interval by a native controller. Two stable observations precede hashing.
    /// This detects saved bytes, not all edits or proof that SAI2 itself wrote the file.
    pub async fn observe(&mut self)->Result<bool,String>{
        if self.paused{return Ok(false);}
        self.flush().await?;
        let path=self.path.clone();
        let observed=tokio::task::spawn_blocking(move||metadata(&path)).await.map_err(|_|"无法检查保存状态。".to_string())?;
        let stamp=match observed{Ok(stamp)=>stamp,Err(error)=>{self.paused=true;return Err(error);}};
        if stamp==self.last.stamp{self.candidate=None;return Ok(false);}
        match &self.candidate{
            Some((previous,since))if previous==&stamp&&since.elapsed()>=Duration::from_millis(1500)=>self.checkpoint().await,
            Some((previous,_))if previous==&stamp=>Ok(false),
            _=>{self.candidate=Some((stamp,Instant::now()));Ok(false)}
        }
    }

    /// Explicit native checkpoint, also used after the user confirms a completed save.
    pub async fn checkpoint(&mut self)->Result<bool,String>{
        if self.paused{return Err("记录已暂停，请先继续。".into());}
        self.flush().await?;
        let limit=recording_settings::load(&self.root)?.unwrap_or(OBSERVATION_LIMIT).min(OBSERVATION_LIMIT);
        if self.sequence>=limit{self.paused=true;return Err("记录已达到设置上限，可以提高上限或导出已有记录。".into());}
        let current=match fingerprint(self.path.clone()).await{Ok(value)=>value,Err(error)=>{self.paused=true;return Err(error);}};
        if current.hash==self.last.hash{self.last=current;self.candidate=None;return Ok(false);}
        self.emit("save",current.hash.clone()).await?;
        self.last=current;self.candidate=None;Ok(true)
    }

    pub async fn pause(&mut self)->Result<(),String>{
        if self.paused{return Ok(());}
        self.paused=true;self.candidate=None;
        self.emit("pause",String::new()).await
    }

    pub async fn resume(&mut self)->Result<(),String>{
        if !self.paused{return Ok(());}
        self.emit("gap",String::new()).await?;
        self.emit("resume",String::new()).await?;
        self.paused=false;self.candidate=None;Ok(())
    }

    /// Caller must keep the recording paused while presenting a native save dialog.
    pub async fn export(&mut self)->Result<Proof,String>{
        self.pause().await?;self.flush().await?;
        let value=fingerprint(self.path.clone()).await?;
        if value.hash!=self.last.hash{self.emit("gap",String::new()).await?;}
        self.emit("save",value.hash.clone()).await?;
        let Json(proof)=super::export(State(self.store.clone()),self.headers.clone(),Path(self.id.clone()),Json(Export{
            artifact_hash:value.hash.clone(),artifact_bytes:value.stamp.bytes
        })).await.map_err(api)?;
        // Final metadata check does not prove application save completion or prevent a later edit.
        // The recipient must always hash the separately delivered artifact during verification.
        let path=self.path.clone();let after=tokio::task::spawn_blocking(move||metadata(&path)).await.map_err(|_|"无法确认最终文件状态。".to_string())??;
        if value.stamp!=after{return Err("导出期间作品发生变化，请重新保存并导出。".into());}
        self.last=value;Ok(proof)
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    struct Fixture{root:PathBuf,profile:PathBuf,file:PathBuf}
    impl Fixture{
        fn new()->Self{
            let root=std::env::temp_dir().join(format!("workproof-sai2-{}",random_hex(12)));
            let profile=root.join("profile");Store::open(&profile,43127).unwrap();
            let file=root.join("fixture.sai2");std::fs::write(&file,b"synthetic saved file, not a real SAI2 document").unwrap();
            Self{root,profile,file}
        }
        async fn recorder(&self)->SavedFileRecorder{SavedFileRecorder::begin(self.profile.clone(),self.file.clone(),"2026-11-14T00:00:00Z".into()).await.unwrap()}
    }
    impl Drop for Fixture{
        fn drop(&mut self){
            let temporary=std::fs::canonicalize(std::env::temp_dir()).unwrap();
            if let Ok(actual)=self.root.canonicalize(){
                assert_eq!(actual.parent(),Some(temporary.as_path()));
                assert!(actual.file_name().unwrap().to_string_lossy().starts_with("workproof-sai2-"));
                let _=std::fs::remove_dir_all(actual);
            }
        }
    }
    #[tokio::test]async fn saved_versions_export_and_catalog_stay_bound_to_actual_bytes(){
        let fixture=Fixture::new();let mut recorder=fixture.recorder().await;
        assert!(!recorder.checkpoint().await.unwrap());
        std::fs::write(&fixture.file,b"second saved version").unwrap();
        assert!(recorder.checkpoint().await.unwrap());
        recorder.pause().await.unwrap();std::fs::write(&fixture.file,b"changed during pause").unwrap();
        assert!(recorder.checkpoint().await.is_err());recorder.resume().await.unwrap();
        let proof=recorder.export().await.unwrap();
        let bytes=std::fs::read(&fixture.file).unwrap();
        assert!(verify(&proof,&digest(&bytes),bytes.len() as u64).valid);
        assert_eq!(proof.manifest.source,SOURCE);assert!(recorder.status().paused);
        let assessment=assess_behavior(&Evidence::Full(proof.clone()));assert_eq!(assessment.status,"not_applicable");
        assert!(assessment.limitations.iter().any(|line|line.contains("未采集图层")));
        assert!(proof.records.iter().any(|record|record.event.kind=="gap"));
        assert!(proof.records.iter().all(|record|record.event.inserted==0&&record.event.deleted==0&&record.event.metrics.is_empty()));
        assert!(!verify(&proof,&digest(b"tampered"),8).valid);
        let encoded=serde_json::to_string(&proof).unwrap();assert!(!encoded.contains(&fixture.root.to_string_lossy().to_string()));
        let list=catalog::list(&fixture.profile).unwrap();assert_eq!(list.len(),1);assert_eq!(list[0].source,SOURCE);
        assert_eq!(PathBuf::from(list[0].local_path.as_ref().unwrap()),fixture.file.canonicalize().unwrap());
    }
    #[tokio::test]async fn caller_cannot_start_other_formats_or_export_missing_files(){
        let fixture=Fixture::new();
        assert!(SavedFileRecorder::begin(fixture.profile.clone(),fixture.root.join("other.exe"),"2026-11-14".into()).await.is_err());
        let mut recorder=fixture.recorder().await;std::fs::rename(&fixture.file,fixture.root.join("moved.sai2")).unwrap();
        assert!(recorder.observe().await.is_err());assert!(recorder.status().paused);
        assert!(recorder.export().await.is_err());assert_eq!(recorder.status().events,1);
    }
    #[tokio::test]async fn configured_record_limit_preserves_final_export(){
        let fixture=Fixture::new();recording_settings::save(&fixture.profile,Some(100)).unwrap();
        let mut recorder=fixture.recorder().await;
        for index in 1..100{std::fs::write(&fixture.file,format!("saved version {index}")).unwrap();assert!(recorder.checkpoint().await.unwrap());}
        std::fs::write(&fixture.file,b"new bytes after limit").unwrap();
        assert!(recorder.checkpoint().await.is_err());assert_eq!(recorder.status().events,100);
        let proof=recorder.export().await.unwrap();
        assert!(verify(&proof,&digest(b"new bytes after limit"),21).valid);
        assert!(proof.records.iter().any(|record|record.event.kind=="gap"));
    }
    #[tokio::test]async fn polling_waits_for_a_quiet_file_before_hashing(){
        let fixture=Fixture::new();let mut recorder=fixture.recorder().await;
        std::fs::write(&fixture.file,b"pending save").unwrap();
        assert!(!recorder.observe().await.unwrap());assert!(!recorder.observe().await.unwrap());
        assert_eq!(recorder.status().events,1);
        // Deterministic elapsed fixture; no wall-clock sleep or race with a live writer.
        recorder.candidate.as_mut().unwrap().1=Instant::now()-Duration::from_secs(2);
        assert!(recorder.observe().await.unwrap());assert_eq!(recorder.status().events,2);
    }
}
