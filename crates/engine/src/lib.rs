use axum::{extract::{State,Path,DefaultBodyLimit}, http::{HeaderMap,StatusCode}, response::IntoResponse, routing::{get,post}, Json, Router};
use ed25519_dalek::SigningKey;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize,Serialize};
use std::{path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::{SystemTime,UNIX_EPOCH}};
use workproof_protocol::*;
pub mod pairing;
pub mod location;

type Shared = Arc<Mutex<Store>>;
static READY:AtomicBool=AtomicBool::new(false);
#[derive(Serialize)]
pub struct EngineSnapshot {pub ready:bool,pub sessions:u64,pub events:u64,pub last_kind:String}
pub fn snapshot()->Result<EngineSnapshot,String>{
    if !READY.load(Ordering::Acquire){return Ok(EngineSnapshot{ready:false,sessions:0,events:0,last_kind:String::new()});}
    let db=Connection::open_with_flags(data_dir()?.join("records.sqlite"),rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e|e.to_string())?;
    let sessions=db.query_row("SELECT COUNT(*) FROM sessions",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let events=db.query_row("SELECT COUNT(*) FROM events",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let last:Option<String>=db.query_row("SELECT json FROM events ORDER BY rowid DESC LIMIT 1",[],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let last_kind=last.and_then(|s|serde_json::from_str::<Event>(&s).ok()).map(|e|e.kind).unwrap_or_default();
    Ok(EngineSnapshot{ready:true,sessions,events,last_kind})
}
type ApiResult<T> = Result<Json<T>,ApiError>;
pub struct ApiError(StatusCode,String);
impl IntoResponse for ApiError { fn into_response(self)->axum::response::Response { (self.0,Json(serde_json::json!({"error":self.1}))).into_response() } }
impl From<rusqlite::Error> for ApiError { fn from(_:rusqlite::Error)->Self { Self(StatusCode::INTERNAL_SERVER_ERROR,"DATABASE_ERROR".into()) } }
fn bad(s:&str)->ApiError {ApiError(StatusCode::BAD_REQUEST,s.into())}
fn random_hex(n:usize)->String {let mut b=vec![0;n];rand::rngs::OsRng.fill_bytes(&mut b);hex::encode(b)}
pub fn data_dir()->Result<PathBuf,String>{location::resolve(std::env::consts::OS,|name|std::env::var_os(name))}
#[derive(Serialize,Deserialize,Clone)]
pub struct ConnectionInfo {pub port:u16,pub token:String}
pub struct Store { db:Connection, key:SigningKey, info:ConnectionInfo }
impl Store {
    pub fn open(dir:&std::path::Path,port:u16)->Result<Self,Box<dyn std::error::Error>> {
        std::fs::create_dir_all(dir)?;
        // Restrict app state to the current Windows user before writing secrets.
        #[cfg(windows)] {
            let who=std::process::Command::new("whoami").output()?;
            if !who.status.success(){return Err("Cannot identify state owner".into());}
            let user=String::from_utf8(who.stdout)?.trim().to_string();
            let status=std::process::Command::new("icacls").arg(dir).args(["/inheritance:r","/grant:r",&format!("{}:(OI)(CI)F",user)])
                .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status()?;
            if !status.success(){return Err("Cannot restrict state permissions".into());}
        }
        #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(dir,std::fs::Permissions::from_mode(0o700))?;}
        let key_path=dir.join("signing-key.bin");
        let seed:[u8;32]=if key_path.exists(){std::fs::read(key_path)?.try_into().map_err(|_|"Invalid key file")?}else{
            let mut seed=[0;32];rand::rngs::OsRng.fill_bytes(&mut seed);std::fs::write(key_path,seed)?;seed
        };
        let db=Connection::open(dir.join("records.sqlite"))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,started TEXT NOT NULL,source TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS events(session TEXT NOT NULL,seq INTEGER NOT NULL,json TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(session,seq),FOREIGN KEY(session) REFERENCES sessions(id));")?;
        Ok(Self{db,key:SigningKey::from_bytes(&seed),info:ConnectionInfo{port,token:random_hex(32)}})
    }
}
fn master_authorized(headers:&HeaderMap,store:&Store)->bool {
    if headers.contains_key("origin"){return false;}
    let supplied=headers.get("authorization").and_then(|h|h.to_str().ok()).unwrap_or("");
    let expected=format!("Bearer {}",store.info.token);
    let diff=supplied.bytes().zip(expected.bytes()).fold(0u8,|a,(b,c)|a|(b^c));
    supplied.len()==expected.len()&&diff==0
}
fn authorize(headers:&HeaderMap,store:&Store)->Result<(),ApiError> {
    if master_authorized(headers,store)||pairing::allows(headers,None,None){return Ok(());}
    Err(ApiError(if headers.contains_key("origin"){StatusCode::FORBIDDEN}else{StatusCode::UNAUTHORIZED},"PAIRING_REQUIRED".into()))
}
fn lock(s:&Shared)->Result<std::sync::MutexGuard<'_,Store>,ApiError>{s.lock().map_err(|_|ApiError(StatusCode::INTERNAL_SERVER_ERROR,"STORE_UNAVAILABLE".into()))}
#[derive(Deserialize)] #[serde(deny_unknown_fields)]
struct Start {file_name:String,started_at:String,source:String,#[serde(default)]demo:bool}
async fn start(State(shared):State<Shared>,headers:HeaderMap,Json(input):Json<Start>)->ApiResult<serde_json::Value>{
    let store=lock(&shared)?;authorize(&headers,&store)?;
    if !master_authorized(&headers,&store)&&!pairing::allows(&headers,None,Some(&input.source)){return Err(ApiError(StatusCode::FORBIDDEN,"ADAPTER_SOURCE_MISMATCH".into()));}
    if input.file_name.is_empty()||input.file_name.len()>255||input.file_name.contains(['/', '\\'])||input.started_at.len()>64||input.source.len()>128{return Err(bad("INVALID_SESSION"));}
    let id=random_hex(16);
    store.db.execute("INSERT INTO sessions(id,name,started,source,demo) VALUES(?1,?2,?3,?4,?5)",params![id,input.file_name,input.started_at,input.source,input.demo])?;
    if !master_authorized(&headers,&store){pairing::bind(&headers,&id);}
    Ok(Json(serde_json::json!({"session_id":id,"next_seq":0})))
}
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct Batch {events:Vec<Event>}
#[derive(Deserialize)] #[serde(deny_unknown_fields)]
struct EvolutionInput {seq:u64,event_kind:String,nodes:Vec<evolution::Node>}
async fn evolution_checkpoint(State(shared):State<Shared>,headers:HeaderMap,Path(id):Path<String>,Json(input):Json<EvolutionInput>)->ApiResult<serde_json::Value>{
    let store=lock(&shared)?;authorize(&headers,&store)?;
    if !master_authorized(&headers,&store)&&!pairing::allows(&headers,Some(&id),None){return Err(ApiError(StatusCode::FORBIDDEN,"ADAPTER_SESSION_DENIED".into()));}
    let source:Option<String>=store.db.query_row("SELECT source FROM sessions WHERE id=?1",[&id],|r|r.get(0)).optional()?;
    let source=source.ok_or_else(||bad("UNKNOWN_SESSION"))?;
    let next:u64=store.db.query_row("SELECT COALESCE(MAX(seq)+1,0) FROM events WHERE session=?1",[&id],|r|r.get(0))?;
    if input.seq!=next{return Err(bad("SEQUENCE_CONFLICT"));}
    let snapshot=evolution::Snapshot{format:evolution::FORMAT.into(),session_id:id,source,seq:input.seq,event_kind:input.event_kind,nodes:input.nodes};
    let checkpoint=evolution::checkpoint(&snapshot).map_err(bad)?;
    // Preparation only. Existing event append supplies the atomic sequence/chain transaction.
    // Raw node data is neither persisted nor logged by this endpoint.
    Ok(Json(serde_json::json!({"snapshot":snapshot,"checkpoint":checkpoint})))
}
async fn append(State(shared):State<Shared>,headers:HeaderMap,Path(id):Path<String>,Json(batch):Json<Batch>)->ApiResult<serde_json::Value>{
    let mut store=lock(&shared)?;authorize(&headers,&store)?;
    if !master_authorized(&headers,&store)&&!pairing::allows(&headers,Some(&id),None){return Err(ApiError(StatusCode::FORBIDDEN,"ADAPTER_SESSION_DENIED".into()));}
    if batch.events.is_empty()||batch.events.len()>256{return Err(bad("INVALID_BATCH"));}
    let exists:bool=store.db.query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",[&id],|r|r.get(0))?;
    if !exists{return Err(bad("UNKNOWN_SESSION"));}
    let tx=store.db.transaction()?;
    let last:Option<(u64,String,String)>=tx.query_row("SELECT seq,hash,json FROM events WHERE session=?1 ORDER BY seq DESC LIMIT 1",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let (mut next,mut head,mut elapsed)=if let Some((seq,hash,json))=last{let e:Event=serde_json::from_str(&json).map_err(|_|bad("CORRUPT_RECORD"))?;(seq+1,hash,e.elapsed_ms)}else{(0,genesis(&id),0)};
    for e in batch.events {
        if !validate_event(&e){return Err(bad("INVALID_EVENT"));}
        let json=serde_json::to_string(&e).map_err(|_|bad("INVALID_EVENT"))?;
        if e.seq<next {
            let existing:String=tx.query_row("SELECT json FROM events WHERE session=?1 AND seq=?2",params![id,e.seq],|r|r.get(0))?;
            if existing!=json{return Err(bad("SEQUENCE_CONFLICT"));}continue;
        }
        if e.seq!=next||e.elapsed_ms<elapsed||(next==0&&e.kind!="start"){return Err(bad("SEQUENCE_GAP"));}
        head=event_hash(&head,&e);
        tx.execute("INSERT INTO events(session,seq,json,hash) VALUES(?1,?2,?3,?4)",params![id,e.seq,json,head])?;
        next+=1;elapsed=e.elapsed_ms;
    }
    tx.commit()?;
    Ok(Json(serde_json::json!({"next_seq":next,"chain_head":head})))
}
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct Export {artifact_hash:String,artifact_bytes:u64}
async fn export(State(shared):State<Shared>,headers:HeaderMap,Path(id):Path<String>,Json(input):Json<Export>)->ApiResult<Proof>{
    let store=lock(&shared)?;authorize(&headers,&store)?;
    if !master_authorized(&headers,&store)&&!pairing::allows(&headers,Some(&id),None){return Err(ApiError(StatusCode::FORBIDDEN,"ADAPTER_SESSION_DENIED".into()));}
    if !valid_hash(&input.artifact_hash){return Err(bad("INVALID_ARTIFACT_HASH"));}
    let (name,started,source,demo):(String,String,String,bool)=store.db.query_row("SELECT name,started,source,demo FROM sessions WHERE id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    let mut stmt=store.db.prepare("SELECT json,hash FROM events WHERE session=?1 ORDER BY seq")?;
    let rows=stmt.query_map([&id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?;
    let mut records=vec![];
    for row in rows {let (json,hash)=row?;records.push(Record{event:serde_json::from_str(&json).map_err(|_|bad("CORRUPT_RECORD"))?,hash});}
    let last=records.last().ok_or_else(||bad("EMPTY_RECORD"))?;
    if last.event.kind!="save"||last.event.checkpoint!=input.artifact_hash{return Err(bad("SAVE_CHECKPOINT_REQUIRED"));}
    let manifest=Manifest{protocol:VERSION.into(),session_id:id,file_name:name,started_at:started,source,event_count:records.len() as u64,chain_head:last.hash.clone(),artifact_hash:input.artifact_hash.clone(),artifact_bytes:input.artifact_bytes,public_key:hex::encode(store.key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),merkle_root:String::new(),demo};
    let proof=sign(manifest,records,&store.key);
    if !verify(&proof,&input.artifact_hash,input.artifact_bytes).valid{return Err(bad("STORED_RECORD_INVALID"));}
    Ok(Json(proof))
}
#[derive(Deserialize)] #[serde(deny_unknown_fields)]
struct Seal {path:String,event:Event}
async fn seal(State(shared):State<Shared>,headers:HeaderMap,Path(id):Path<String>,Json(mut input):Json<Seal>)->ApiResult<Proof>{
    if headers.contains_key("origin"){return Err(ApiError(StatusCode::FORBIDDEN,"NATIVE_ADAPTER_REQUIRED".into()));}
    let name:String={
        let store=lock(&shared)?;authorize(&headers,&store)?;
        if !master_authorized(&headers,&store){return Err(ApiError(StatusCode::FORBIDDEN,"MASTER_TOKEN_REQUIRED".into()));}
        store.db.query_row("SELECT name FROM sessions WHERE id=?1",[&id],|r|r.get(0))?
    };
    if input.event.kind!="save"||!input.event.checkpoint.is_empty()||input.path.len()>4096{return Err(bad("INVALID_SEAL"));}
    let path=PathBuf::from(&input.path);
    if !path.is_absolute()||path.file_name().and_then(|s|s.to_str())!=Some(name.as_str()){return Err(bad("ARTIFACT_NAME_MISMATCH"));}
    // Native host adapters only. Never persist the path or content. Hash off the async runtime.
    let (hash,length)=tokio::task::spawn_blocking(move||->Result<(String,u64),String>{
        use std::io::Read;
        let mut file=std::fs::File::open(&path).map_err(|_|"ARTIFACT_NOT_READABLE")?;
        let before=file.metadata().map_err(|_|"ARTIFACT_NOT_READABLE")?;
        if !before.is_file(){return Err("ARTIFACT_NOT_FILE".into());}
        let mut hasher=blake3::Hasher::new();let mut buffer=[0u8;65536];let mut length=0u64;
        loop{let n=file.read(&mut buffer).map_err(|_|"ARTIFACT_READ_FAILED")?;if n==0{break;}hasher.update(&buffer[..n]);length+=n as u64;}
        let after=std::fs::metadata(&path).map_err(|_|"ARTIFACT_CHANGED")?;
        if before.len()!=length||after.len()!=length||before.modified().ok()!=after.modified().ok(){return Err("ARTIFACT_CHANGED".into());}
        Ok((hasher.finalize().to_hex().to_string(),length))
    }).await.map_err(|_|bad("ARTIFACT_HASH_FAILED"))?.map_err(|e|bad(&e))?;
    input.event.checkpoint=hash.clone();
    append(State(shared.clone()),headers.clone(),Path(id.clone()),Json(Batch{events:vec![input.event]})).await?;
    export(State(shared),headers,Path(id),Json(Export{artifact_hash:hash,artifact_bytes:length})).await
}
async fn status(State(shared):State<Shared>,headers:HeaderMap)->ApiResult<serde_json::Value>{
    let store=lock(&shared)?;authorize(&headers,&store)?;
    if !master_authorized(&headers,&store){return Err(ApiError(StatusCode::FORBIDDEN,"MASTER_TOKEN_REQUIRED".into()));}
    let sessions:u64=store.db.query_row("SELECT COUNT(*) FROM sessions",[],|r|r.get(0))?;
    let events:u64=store.db.query_row("SELECT COUNT(*) FROM events",[],|r|r.get(0))?;
    Ok(Json(serde_json::json!({"protocol":VERSION,"sessions":sessions,"events":events})))
}
pub async fn run(port:u16)->Result<(),Box<dyn std::error::Error>> {
    let dir=data_dir()?;
    // Acquire the port before touching keys, so a second instance cannot race setup.
    let listener=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,port)).await?;
    let store=Store::open(&dir,port)?;
    std::fs::write(dir.join("connection.json"),serde_json::to_vec(&store.info)?)?;
    let shared=Arc::new(Mutex::new(store));
    let api=Router::new().route("/v1/status",get(status)).route("/v1/sessions",post(start))
        .route("/v1/pairing",post(pairing::request_pair)).route("/v1/pairing/{ticket}",get(pairing::poll_pair))
        .route("/v1/native-pairing",post(pairing::request_native)).route("/v1/native-pairing/{ticket}",get(pairing::poll_native))
        .route("/v1/sessions/{id}/events",post(append)).route("/v1/sessions/{id}/export",post(export))
        .route("/v1/sessions/{id}/evolution-checkpoint",post(evolution_checkpoint).layer(DefaultBodyLimit::max(2*1024*1024)))
        .route("/v1/sessions/{id}/seal",post(seal))
        .layer(DefaultBodyLimit::max(256*1024)).layer(axum::middleware::from_fn(pairing::cors)).with_state(shared);
    println!("WorkProof collector listening on 127.0.0.1:{port}; pairing file: {}",dir.join("connection.json").display());
    READY.store(true,Ordering::Release);
    axum::serve(listener,api).await?;Ok(())
}
pub fn now_ms()->u64 {SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}
