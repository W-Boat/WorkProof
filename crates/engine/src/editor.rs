//! Private, transactional Tiptap history. No HTTP endpoint or webview file paths.
use std::{collections::BTreeMap, path::Path, sync::Mutex};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use workproof_protocol::{digest, event_hash, genesis, sign, verify, Event, Manifest, Proof, Record, VERSION, MAX_EVENTS};

static WRITER: Mutex<()> = Mutex::new(());
const MAX_BODY: usize = 2 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
fn storage(_: impl std::fmt::Display) -> String { "文档未能读写，请检查磁盘空间后重试。".into() }
fn valid_id(id: &str) -> bool { id.len()==32 && id.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()) }
fn title_ok(s: &str) -> bool { !s.trim().is_empty() && s.chars().count()<=120 && !s.chars().any(char::is_control) }
fn db(root:&Path)->Result<Connection>{
    // The collector creates and restricts this directory before editor commands run.
    if !root.join("signing-key.bin").is_file(){return Err("记录服务正在准备，请稍后重试。".into());}
    let db=Connection::open(root.join("editor.sqlite")).map_err(storage)?;
    db.busy_timeout(std::time::Duration::from_secs(5)).map_err(storage)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,started TEXT NOT NULL,created INTEGER NOT NULL,modified INTEGER NOT NULL,revision INTEGER NOT NULL,content TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_types(document TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('word','markdown')),FOREIGN KEY(document) REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS revisions(document TEXT NOT NULL,revision INTEGER NOT NULL,content TEXT NOT NULL,actions TEXT NOT NULL,saved INTEGER NOT NULL,request TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(document,revision),UNIQUE(document,request),FOREIGN KEY(document) REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS editor_events(document TEXT NOT NULL,seq INTEGER NOT NULL,json TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(document,seq),FOREIGN KEY(document) REFERENCES documents(id));").map_err(storage)?;
    Ok(db)
}
fn encoded(v:&impl Serialize)->Result<String>{serde_json::to_string(v).map_err(storage)}
fn parse(s:String)->Result<Value>{serde_json::from_str(&s).map_err(storage)}
fn bounded_json(v:&Value)->Result<()> {if encoded(v)?.len()>MAX_BODY{return Err("文档或本次记录过大，请拆分文档后继续。".into());}Ok(())}
fn validate_node(v:&Value,depth:usize,nodes:&mut usize)->Result<()>{
    *nodes+=1;
    if depth>48||*nodes>50_000{return Err("文档结构过于复杂。".into());}
    let kind=v["type"].as_str().ok_or("文档结构不完整。")?;
    if !matches!(kind,"doc"|"paragraph"|"heading"|"text"|"bulletList"|"orderedList"|"listItem"|"taskList"|"taskItem"|"image"|"blockquote"|"codeBlock"|"hardBreak"|"horizontalRule"|"table"|"tableRow"|"tableHeader"|"tableCell"|"pageBreak"){return Err("文档包含暂不支持的内容。".into());}
    if kind=="image" && !safe_image(v["attrs"]["src"].as_str().unwrap_or("")){return Err("请使用小于 768 KB 的本地 PNG、JPEG、GIF 或 WebP 图片。".into());}
    if kind=="text" && v["text"].as_str().is_none(){return Err("文字内容无法读取。".into());}
    if let Some(marks)=v.get("marks"){
        for m in marks.as_array().ok_or("文字格式不完整。")?{
            if !matches!(m["type"].as_str(),Some("bold"|"italic"|"underline"|"strike"|"code"|"textStyle"|"highlight"|"subscript"|"superscript"|"link")){return Err("暂不支持这种文字格式。".into());}
            if m["type"]=="link" && !safe_link(m["attrs"]["href"].as_str().unwrap_or("")){return Err("链接需以 https://、http:// 或 mailto: 开头。".into());}
        }
    }
    if let Some(children)=v.get("content"){for child in children.as_array().ok_or("段落内容不完整。")?{validate_node(child,depth+1,nodes)?;}}
    Ok(())
}
fn content_ok(v:&Value)->Result<()> {bounded_json(v)?;if v["type"]!="doc"{return Err("请选择内置编辑器文档。".into());}validate_node(v,0,&mut 0)}
fn text_length(v:&Value)->u64{v["text"].as_str().map(|s|s.chars().count() as u64).unwrap_or(0)+v["content"].as_array().map(|c|c.iter().map(text_length).sum::<u64>()).unwrap_or(0)}

#[derive(Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Action {pub kind:String,pub elapsed_ms:u64,pub inserted:u64,pub deleted:u64,pub chars:u64,#[serde(default)]pub steps:Vec<Value>,#[serde(default)]pub selection:Value,#[serde(default)]pub detail:Value,#[serde(default)]pub metrics:BTreeMap<String,u64>}
#[derive(Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Save {pub id:String,pub expected_revision:u64,pub request_id:String,pub title:String,pub content:Value,pub actions:Vec<Action>}
fn event(action:&Action,seq:u64,last_elapsed:u64)->Result<Event>{
    let kind=match action.kind.as_str(){"edit"|"import"=>"edit","format"=>"format","undo"=>"undo","redo"=>"redo","layout"=>"layout","selection"|"transaction"|"keyboard"|"input"|"beforeinput"|"compositionstart"|"compositionupdate"|"compositionend"|"drop"|"dragstart"|"dragend"|"copy"|"paste"|"cut"|"backspace"|"delete_forward"|"space"|"enter"|"cursor"|"focus"|"blur"=>"interaction",_=>return Err("无法保存未知的编辑动作。".into())};
    if action.steps.len()>128||encoded(action)?.len()>MAX_BODY{return Err("单次编辑动作过大，请分段粘贴。".into());}
    let e=Event{seq,elapsed_ms:action.elapsed_ms.max(last_elapsed),kind:kind.into(),inserted:action.inserted,deleted:action.deleted,chars:action.chars,checkpoint:digest(encoded(action)?.as_bytes()),metrics:action.metrics.clone()};
    if !workproof_protocol::validate_event(&e){return Err("编辑记录超出保存范围，请新建文档继续。".into());}Ok(e)
}

pub fn list(root:&Path)->Result<Value>{
    let _lock=WRITER.lock().map_err(storage)?;let db=db(root)?;
    let mut stmt=db.prepare("SELECT d.id,d.title,d.modified,d.revision,t.kind FROM documents d LEFT JOIN document_types t ON t.document=d.id ORDER BY d.modified DESC LIMIT 2000").map_err(storage)?;
    let rows=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"modified":r.get::<_,u64>(2)?,"revision":r.get::<_,u64>(3)?,"kind":r.get::<_,Option<String>>(4)?}))).map_err(storage)?;
    let mut items=vec![];for row in rows{items.push(row.map_err(storage)?);}Ok(json!(items))
}
pub fn create(root:&Path,title:&str,started:&str,kind:&str)->Result<Value>{
    if !title_ok(title)||started.len()>64{return Err("请使用 1–120 字的文档名称。".into());}
    if !matches!(kind,"word"|"markdown"){return Err("请选择 Word 或 Markdown 文档。".into());}
    let _lock=WRITER.lock().map_err(storage)?;let mut db=db(root)?;let tx=db.transaction().map_err(storage)?;
    let id=super::random_hex(16);let now=super::now_ms();let body=json!({"type":"doc","content":[{"type":"paragraph"}]});
    let e=Event{seq:0,elapsed_ms:0,kind:"start".into(),inserted:0,deleted:0,chars:0,checkpoint:digest(encoded(&body)?.as_bytes()),metrics:BTreeMap::new()};
    tx.execute("INSERT INTO documents VALUES(?1,?2,?3,?4,?4,0,?5)",params![id,title,started,now,encoded(&body)?]).map_err(storage)?;
    tx.execute("INSERT INTO document_types(document,kind) VALUES(?1,?2)",params![id,kind]).map_err(storage)?;
    tx.execute("INSERT INTO revisions VALUES(?1,0,?2,'[]',?3,'initial','')",params![id,encoded(&body)?,now]).map_err(storage)?;
    tx.execute("INSERT INTO editor_events VALUES(?1,0,?2,?3)",params![id,encoded(&e)?,event_hash(&genesis(&id),&e)]).map_err(storage)?;
    tx.commit().map_err(storage)?;drop(_lock);load(root,&id)
}
fn legacy_kind(content:&Value)->&'static str {
    if content["attrs"]["markdownSource"].is_string() { "markdown" } else { "word" }
}
pub fn load(root:&Path,id:&str)->Result<Value>{
    if !valid_id(id){return Err("文档编号无效。".into());}
    let _lock=WRITER.lock().map_err(storage)?;let db=db(root)?;
    let (title,created,revision,content,kind):(String,u64,u64,String,Option<String>)=db.query_row("SELECT d.title,d.created,d.revision,d.content,t.kind FROM documents d LEFT JOIN document_types t ON t.document=d.id WHERE d.id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(storage)?;
    let content=parse(content)?;
    let kind=kind.as_deref().unwrap_or_else(||legacy_kind(&content));
    let mut stmt=db.prepare("SELECT revision,saved,actions FROM revisions WHERE document=?1 ORDER BY revision DESC LIMIT 120").map_err(storage)?;
    let rows=stmt.query_map([id],|r|Ok((r.get::<_,u64>(0)?,r.get::<_,u64>(1)?,r.get::<_,String>(2)?))).map_err(storage)?;
    let mut versions=vec![];let mut actions=vec![];
    for row in rows{let (rev,time,json)=row.map_err(storage)?;let batch:Vec<Action>=serde_json::from_str(&json).map_err(storage)?;versions.push(json!({"revision":rev,"saved":time,"count":batch.len()}));if actions.len()<300{for a in batch.into_iter().rev().take(300-actions.len()){actions.push(json!({"revision":rev,"action":a}));}}}
    let count:u64=db.query_row("SELECT COUNT(*) FROM editor_events WHERE document=?1",[id],|r|r.get(0)).map_err(storage)?;
    Ok(json!({"id":id,"title":title,"created":created,"revision":revision,"content":content,"kind":kind,"versions":versions,"actions":actions,"event_count":count}))
}
/// Bounded, content-free index for the local replay viewer. `through` pins the
/// view to the revision opened by the user while new saves may arrive.
pub fn history(root:&Path,id:&str,after:Option<u64>,through:u64)->Result<Value>{
    if !valid_id(id){return Err("文档编号无效。".into());}
    let _lock=WRITER.lock().map_err(storage)?;let db=db(root)?;
    let _:u64=db.query_row("SELECT revision FROM documents WHERE id=?1",[id],|row|row.get(0)).map_err(storage)?;
    let mut stmt=db.prepare("SELECT revision,saved,actions FROM revisions WHERE document=?1 AND revision>COALESCE(?2,-1) AND revision<=?3 ORDER BY revision LIMIT 129").map_err(storage)?;
    let rows=stmt.query_map(params![id,after,through],|row|Ok((row.get::<_,u64>(0)?,row.get::<_,u64>(1)?,row.get::<_,String>(2)?))).map_err(storage)?;
    let mut frames=vec![];
    for row in rows{
        let (revision,saved,actions)=row.map_err(storage)?;
        let actions:Vec<Action>=serde_json::from_str(&actions).map_err(storage)?;
        frames.push(json!({"revision":revision,"saved":saved,"count":actions.len(),"inserted":actions.iter().map(|a|a.inserted).sum::<u64>(),"deleted":actions.iter().map(|a|a.deleted).sum::<u64>(),"pastes":actions.iter().filter(|a|a.kind=="paste").count()}));
    }
    let has_more=frames.len()>128;frames.truncate(128);
    let next=if has_more{frames.last().map(|frame|frame["revision"].clone())}else{None};
    Ok(json!({"frames":frames,"has_more":has_more,"next_after":next}))
}
pub fn replay_frame(root:&Path,id:&str,revision:u64)->Result<Value>{
    if !valid_id(id){return Err("文档编号无效。".into());}
    let _lock=WRITER.lock().map_err(storage)?;let db=db(root)?;
    let (saved,content,actions):(u64,String,String)=db.query_row("SELECT saved,content,actions FROM revisions WHERE document=?1 AND revision=?2",params![id,revision],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(storage)?;
    let actions:Vec<Action>=serde_json::from_str(&actions).map_err(storage)?;
    Ok(json!({"revision":revision,"saved":saved,"content":parse(content)?,"actions":actions}))
}
pub fn version(root:&Path,id:&str,revision:u64)->Result<Value>{
    if !valid_id(id){return Err("文档编号无效。".into());}let _lock=WRITER.lock().map_err(storage)?;let db=db(root)?;
    let content:String=db.query_row("SELECT content FROM revisions WHERE document=?1 AND revision=?2",params![id,revision],|r|r.get(0)).map_err(storage)?;parse(content)
}
pub fn save(root:&Path,input:Save)->Result<Value>{
    if !valid_id(&input.id)||!valid_id(&input.request_id)||!title_ok(&input.title)||input.actions.len()>256{return Err("本次保存内容无法识别。".into());}
    content_ok(&input.content)?;let raw=encoded(&input)?;if raw.len()>8*MAX_BODY{return Err("本次记录过大，请分段导入或粘贴。".into());}let payload=digest(raw.as_bytes());
    let _lock=WRITER.lock().map_err(storage)?;let mut db=db(root)?;let tx=db.transaction().map_err(storage)?;
    let previous:Option<(u64,String)>=tx.query_row("SELECT revision,payload FROM revisions WHERE document=?1 AND request=?2",params![input.id,input.request_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(storage)?;
    if let Some((revision,hash))=previous {if hash!=payload{return Err("保存请求冲突，请重新打开文档。".into());}return Ok(json!({"revision":revision}));}
    let revision:u64=tx.query_row("SELECT revision FROM documents WHERE id=?1",[&input.id],|r|r.get(0)).map_err(storage)?;
    if revision!=input.expected_revision{return Err("这份文档已在其他窗口更新。请先保留当前内容，再重新打开文档。".into());}
    let kind_exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM document_types WHERE document=?1)",[&input.id],|r|r.get(0)).map_err(storage)?;
    if !kind_exists {
        let previous_content:String=tx.query_row("SELECT content FROM documents WHERE id=?1",[&input.id],|r|r.get(0)).map_err(storage)?;
        let kind=legacy_kind(&parse(previous_content)?);
        tx.execute("INSERT INTO document_types(document,kind) VALUES(?1,?2)",params![input.id,kind]).map_err(storage)?;
    }
    let (last_seq,mut head,json):(u64,String,String)=tx.query_row("SELECT seq,hash,json FROM editor_events WHERE document=?1 ORDER BY seq DESC LIMIT 1",[&input.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(storage)?;
    let mut elapsed=serde_json::from_str::<Event>(&json).map_err(storage)?.elapsed_ms;
    if last_seq+input.actions.len() as u64+2>=MAX_EVENTS as u64{return Err("这份记录已满，请新建文档继续。".into());}
    for (i,a) in input.actions.iter().enumerate(){let e=event(a,last_seq+i as u64+1,elapsed)?;elapsed=e.elapsed_ms;head=event_hash(&head,&e);tx.execute("INSERT INTO editor_events VALUES(?1,?2,?3,?4)",params![input.id,e.seq,encoded(&e)?,head]).map_err(storage)?;}
    let next=revision+1;let now=super::now_ms();let content=encoded(&input.content)?;
    let checkpoint=Event{seq:last_seq+input.actions.len() as u64+1,elapsed_ms:elapsed,kind:"save".into(),inserted:0,deleted:0,chars:text_length(&input.content),checkpoint:digest(content.as_bytes()),metrics:BTreeMap::new()};
    head=event_hash(&head,&checkpoint);tx.execute("INSERT INTO editor_events VALUES(?1,?2,?3,?4)",params![input.id,checkpoint.seq,encoded(&checkpoint)?,head]).map_err(storage)?;
    tx.execute("INSERT INTO revisions VALUES(?1,?2,?3,?4,?5,?6,?7)",params![input.id,next,content,encoded(&input.actions)?,now,input.request_id,payload]).map_err(storage)?;
    tx.execute("UPDATE documents SET title=?2,modified=?3,revision=?4,content=?5 WHERE id=?1",params![input.id,input.title,now,next,content]).map_err(storage)?;
    tx.commit().map_err(storage)?;Ok(json!({"revision":next}))
}

fn escape(s:&str)->String{s.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;").replace('\'',"&#39;")}
fn safe_link(s:&str)->bool{
    s.len()<=4096 && !s.chars().any(char::is_control) && ["https://","http://","mailto:"].iter().any(|p|s.to_ascii_lowercase().starts_with(p))
}
fn safe_image(s:&str)->bool{
    s.len()<=1024*1024 && ["data:image/png;base64,","data:image/jpeg;base64,","data:image/gif;base64,","data:image/webp;base64,"].iter().any(|p|s.strip_prefix(p).is_some_and(|b|!b.is_empty()&&b.bytes().all(|c|c.is_ascii_alphanumeric()||b"+/=".contains(&c))))
}
// Export only typed, bounded presentation values. Never interpolate document CSS.
fn presentation(attrs:&Value)->String{
    let mut styles=Vec::new();
    for (name,css) in [("color","color"),("backgroundColor","background-color")]{
        if let Some(s)=attrs[name].as_str(){if s.starts_with('#')&&matches!(s.len(),4|7|9)&&s[1..].bytes().all(|c|c.is_ascii_hexdigit()){styles.push(format!("{css}:{s}"));}}
    }
    if let Some(font)=attrs["fontFamily"].as_str(){if font.len()<=120&&font.chars().all(|c|c.is_alphanumeric()||" ,-'\"".contains(c)){styles.push(format!("font-family:{}",escape(font)));}}
    if let Some(size)=attrs["fontSize"].as_str(){if let Some(n)=size.strip_suffix("pt").or_else(||size.strip_suffix("px")).and_then(|s|s.parse::<f64>().ok()){if (6.0..=96.0).contains(&n){styles.push(format!("font-size:{size}"));}}}
    if let Some(n)=attrs["lineHeight"].as_str().and_then(|s|s.parse::<f64>().ok()){if (0.8..=4.0).contains(&n){styles.push(format!("line-height:{n}"));}}
    if let Some(n)=attrs["indent"].as_u64(){styles.push(format!("margin-left:{}em",n.min(8)*2));}
    if let Some(n)=attrs["spaceAfter"].as_u64(){styles.push(format!("margin-bottom:{}pt",n.min(36)));}
    styles.join(";")
}
fn render(v:&Value)->String{
    if v["type"]=="text"{
        let mut text=escape(v["text"].as_str().unwrap_or(""));
        if let Some(m)=v["marks"].as_array(){for mark in m{
            if mark["type"]=="link"{let href=mark["attrs"]["href"].as_str().unwrap_or("");if safe_link(href){text=format!("<a href=\"{}\" rel=\"noopener noreferrer\">{text}</a>",escape(href));}continue;}
            let tag=match mark["type"].as_str(){Some("bold")=>"strong",Some("italic")=>"em",Some("underline")=>"u",Some("strike")=>"s",Some("code")=>"code",Some("subscript")=>"sub",Some("superscript")=>"sup",Some("textStyle")=>"span",Some("highlight")=>"mark",_=>continue};
            let mut attrs=mark["attrs"].clone();if tag=="mark"{if let Some(color)=attrs.get("color").cloned(){attrs["backgroundColor"]=color;}}
            text=format!("<{tag} style=\"{}\">{text}</{tag}>",presentation(&attrs));
        }}return text;
    }
    if v["type"]=="image"{let src=v["attrs"]["src"].as_str().unwrap_or("");return if safe_image(src){format!("<img src=\"{}\" alt=\"{}\" style=\"max-width:100%\">",escape(src),escape(v["attrs"]["alt"].as_str().unwrap_or("")))}else{String::new()};}
    let children=v["content"].as_array().map(|c|c.iter().map(render).collect::<String>()).unwrap_or_default();
    let tag=match v["type"].as_str(){Some("doc")=>return children,Some("paragraph")=>"p",Some("heading")=>match v["attrs"]["level"].as_u64(){Some(1)=>"h1",Some(2)=>"h2",_=>"h3"},Some("bulletList")=>"ul",Some("orderedList")=>"ol",Some("listItem")=>"li",Some("blockquote")=>"blockquote",Some("codeBlock")=>"pre",Some("table")=>"table",Some("tableRow")=>"tr",Some("tableCell")=>"td",Some("tableHeader")=>"th",Some("pageBreak")=>return "<div style=\"break-after:page\"></div>".into(),Some("hardBreak")=>return "<br>".into(),Some("horizontalRule")=>return "<hr>".into(),_=>"p"};
    let tag=match v["type"].as_str(){Some("taskList")=>"ul",Some("taskItem")=>"li",_=>tag};
    let check=if v["type"]=="taskItem"{if v["attrs"]["checked"]==true{"☑ "}else{"☐ "}}else{""};
    let cells=if matches!(tag,"td"|"th"){format!(" colspan=\"{}\" rowspan=\"{}\"",v["attrs"]["colspan"].as_u64().unwrap_or(1).clamp(1,30),v["attrs"]["rowspan"].as_u64().unwrap_or(1).clamp(1,30))}else{String::new()};
    let align=match v["attrs"]["textAlign"].as_str(){Some("center")=>"center",Some("right")=>"right",Some("justify")=>"justify",_=>"left"};format!("<{tag}{cells} style=\"text-align:{align};{}\">{check}{children}</{tag}>",presentation(&v["attrs"]))
}
pub struct Export {pub html:String,pub proof:Proof,pub report:workproof_protocol::Report}
/// Desktop file choices follow the persisted document type, including legacy files.
pub fn desktop_export_extension(root:&Path,id:&str,docx:bool,markdown:bool)->Result<&'static str>{
    if !valid_id(id){return Err("文档标识无效。".into());}
    let connection=db(root)?;
    let (kind,legacy):(Option<String>,Option<String>)=connection.query_row(
        "SELECT t.kind,CASE WHEN t.kind IS NULL THEN d.content END FROM documents d LEFT JOIN document_types t ON t.document=d.id WHERE d.id=?1",
        [id],|row|Ok((row.get(0)?,row.get(1)?)),
    ).map_err(storage)?;
    let legacy_body=legacy.map(parse).transpose()?;
    let kind=kind.as_deref().unwrap_or_else(||legacy_kind(legacy_body.as_ref().unwrap_or(&Value::Null)));
    match (kind,docx,markdown){
        ("word",true,false)=>Ok("docx"),
        ("markdown",false,true)=>Ok("md"),
        ("word",_,_)=>Err("Word 文档请保存为 .docx。".into()),
        ("markdown",_,_)=>Err("Markdown 文档请保存为 .md。".into()),
        _=>Err("文档类型无法确认，请重新打开文档。".into()),
    }
}
pub fn export(root:&Path,id:&str,file_name:&str)->Result<Export>{
    export_artifact(root,id,file_name,None)
}
pub fn export_artifact(root:&Path,id:&str,file_name:&str,artifact:Option<&[u8]>)->Result<Export>{
    if artifact.is_some_and(|b|b.len()>8*1024*1024||!b.starts_with(b"PK\x03\x04")){return Err("Word 插件未能生成有效的 DOCX 文件。".into());}
    export_bytes(root,id,file_name,artifact)
}
pub fn export_markdown(root:&Path,id:&str,file_name:&str,markdown:&str)->Result<Export>{
    if markdown.len()>MAX_BODY{return Err("Markdown 文件过大，请拆分文档后继续。".into());}
    export_bytes(root,id,file_name,Some(markdown.as_bytes()))
}
fn export_bytes(root:&Path,id:&str,file_name:&str,artifact:Option<&[u8]>)->Result<Export>{
    if !valid_id(id)||file_name.len()>1024||file_name.contains(['/', '\\']){return Err("文件名称无效。".into());}
    let _lock=WRITER.lock().map_err(storage)?;let db=db(root)?;
    let (title,started,content):(String,String,String)=db.query_row("SELECT title,started,content FROM documents WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(storage)?;
    let body=parse(content)?;content_ok(&body)?;
    let html=format!("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\"><title>{}</title><style>body{{font:17px/1.9 'Segoe UI','Microsoft YaHei',sans-serif;max-width:780px;margin:48px auto;padding:0 28px;color:#242424;background:white}}h1,h2,h3{{line-height:1.4}}blockquote{{border-left:3px solid #0f6cbd;margin-left:0;padding-left:20px;color:#616161}}pre{{white-space:pre-wrap}}@media print{{body{{margin:0;max-width:none}}}}</style><body>{}</body></html>",escape(&title),render(&body));
    let mut stmt=db.prepare("SELECT json,hash FROM editor_events WHERE document=?1 ORDER BY seq").map_err(storage)?;
    let rows=stmt.query_map([id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(storage)?;
    let mut records=vec![];let mut head=genesis(id);let mut elapsed=0;
    for row in rows{let (s,hash)=row.map_err(storage)?;let e:Event=serde_json::from_str(&s).map_err(storage)?;if e.seq!=records.len() as u64||e.elapsed_ms<elapsed||!workproof_protocol::validate_event(&e)||event_hash(&head,&e)!=hash{return Err("本机记录完整性检查未通过，无法签发证书。".into());}head=hash.clone();elapsed=e.elapsed_ms;records.push(Record{event:e,hash});}
    if !records.last().is_some_and(|r|matches!(r.event.kind.as_str(),"save"|"start")&&r.event.checkpoint==digest(encoded(&body).unwrap_or_default().as_bytes())){return Err("正文与保存记录不一致，请恢复原始文档后再导出。".into());}
    let bytes=artifact.unwrap_or(html.as_bytes());let hash=digest(bytes);let e=Event{seq:records.len() as u64,elapsed_ms:elapsed,kind:"save".into(),inserted:0,deleted:0,chars:text_length(&body),checkpoint:hash.clone(),metrics:BTreeMap::new()};head=event_hash(&head,&e);records.push(Record{event:e,hash:head.clone()});
    let seed:[u8;32]=std::fs::read(root.join("signing-key.bin")).map_err(storage)?.try_into().map_err(|_|"本机签名密钥不完整。")?;let key=ed25519_dalek::SigningKey::from_bytes(&seed);
    let proof=sign(Manifest{protocol:VERSION.into(),session_id:id.into(),file_name:file_name.into(),started_at:started,source:"workproof-tiptap".into(),event_count:records.len() as u64,chain_head:head,artifact_hash:hash.clone(),artifact_bytes:bytes.len() as u64,public_key:hex::encode(key.verifying_key().to_bytes()),identity:"self-signed".into(),time_evidence:"none".into(),demo:false,merkle_root:String::new()},records,&key);
    let report=verify(&proof,&hash,bytes.len() as u64);if !report.valid{return Err("导出前核验未通过，没有生成证书。".into());}Ok(Export{html,proof,report})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rich_document_export_keeps_formatting_and_rejects_active_sources(){
        let rich=json!({"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","attrs":{"indent":2,"spaceAfter":12},"content":[{"type":"text","text":"完成","marks":[{"type":"textStyle","attrs":{"fontSize":"18pt","color":"#123abc","fontFamily":"Microsoft YaHei"}},{"type":"link","attrs":{"href":"https://example.com/?a=1&b=2"}},{"type":"superscript"}]}]}]}]}]});
        content_ok(&rich).unwrap();let html=render(&rich);assert!(html.contains("font-size:18pt"));assert!(html.contains("margin-left:4em"));assert!(html.contains("☑"));assert!(html.contains("&amp;b=2"));assert!(html.contains("<sup"));
        let bad=json!({"type":"doc","content":[{"type":"image","attrs":{"src":"data:image/svg+xml;base64,PHN2Zz4="}}]});assert!(content_ok(&bad).is_err());
        assert!(!safe_link("javascript:alert(1)"));assert!(!safe_link("https://example.com/\n"));
        assert!(!presentation(&json!({"color":"red;background:url(https://example.com)","fontSize":"12pt;position:fixed","fontFamily":"x;}body{display:none"})).contains("url("));
    }
    #[test]
    fn markdown_certificate_binds_the_exact_utf8_file(){
        let root=root();let d=create(&root.0,"Markdown","2026-11-06T00:00:00Z","word").unwrap();let id=d["id"].as_str().unwrap();save(&root.0,save_input(id)).unwrap();
        let source="# 标题\n\n保留 **原始语法** 与空白。\n";
        let out=export_markdown(&root.0,id,"写作.md",source).unwrap();assert!(out.report.valid);assert_eq!(out.proof.manifest.artifact_hash,digest(source.as_bytes()));assert_eq!(out.proof.manifest.artifact_bytes,source.len() as u64);
        assert!(!verify(&out.proof,&digest(source.trim().as_bytes()),source.trim().len() as u64).valid);
    }
    struct Temp(std::path::PathBuf);impl Drop for Temp{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
    fn root()->Temp{let p=std::env::temp_dir().join(format!("wp-editor-{}",super::super::random_hex(12)));std::fs::create_dir_all(&p).unwrap();std::fs::write(p.join("signing-key.bin"),[7u8;32]).unwrap();Temp(p)}
    fn save_input(id:&str)->Save{Save{id:id.into(),expected_revision:0,request_id:"a".repeat(32),title:"课程论文".into(),content:json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"你好 <script>"}]}]}),actions:vec![Action{kind:"edit".into(),elapsed_ms:30,inserted:11,deleted:0,chars:11,steps:vec![json!({"stepType":"replace"})],selection:json!({"from":1,"to":1}),detail:Value::Null,metrics:BTreeMap::new()}]}}
    #[test]
    fn replay_pages_cover_history_and_frames_stay_bound_to_the_document(){
        let root=root();let doc=create(&root.0,"回放","","word").unwrap();let id=doc["id"].as_str().unwrap();
        for revision in 0..130{
            let mut input=save_input(id);input.expected_revision=revision;input.request_id=format!("{:032x}",revision+1);
            input.actions[0].kind="copy".into();input.actions[0].elapsed_ms=(revision+1)*100;input.actions[0].inserted=0;
            save(&root.0,input).unwrap();
        }
        let first=history(&root.0,id,None,130).unwrap();assert_eq!(first["frames"].as_array().unwrap().len(),128);assert_eq!(first["has_more"],true);assert_eq!(first["next_after"],127);
        assert!(first["frames"][0].get("content").is_none());assert!(first["frames"][0].get("actions").is_none());
        let second=history(&root.0,id,Some(127),130).unwrap();assert_eq!(second["frames"].as_array().unwrap().len(),3);assert_eq!(second["frames"][0]["revision"],128);assert_eq!(second["has_more"],false);
        let pinned=history(&root.0,id,None,1).unwrap();assert_eq!(pinned["frames"].as_array().unwrap().len(),2);
        let frame=replay_frame(&root.0,id,130).unwrap();assert_eq!(frame["revision"],130);assert_eq!(frame["actions"][0]["kind"],"copy");assert_eq!(frame["content"]["content"][0]["content"][0]["text"],"你好 <script>");
        let other=create(&root.0,"另一份文档","","markdown").unwrap();assert!(replay_frame(&root.0,other["id"].as_str().unwrap(),130).is_err());
        assert!(history(&root.0,"../bad",None,130).is_err());assert!(replay_frame(&root.0,id,131).is_err());
    }
    #[test]
    fn desktop_export_uses_saved_type_and_rejects_cross_format_payloads(){
        let root=root();
        for (kind,docx,markdown,extension) in [("word",true,false,"docx"),("markdown",false,true,"md")]{
            let document=create(&root.0,"导出类型","",kind).unwrap();
            let id=document["id"].as_str().unwrap();
            save(&root.0,save_input(id)).unwrap();
            assert_eq!(desktop_export_extension(&root.0,id,docx,markdown).unwrap(),extension);
            for (word,md) in [(false,false),(true,true),(!docx,!markdown)]{
                assert!(desktop_export_extension(&root.0,id,word,md).is_err());
            }
        }
        let document=create(&root.0,"旧 Markdown","","word").unwrap();
        let id=document["id"].as_str().unwrap();
        let connection=db(&root.0).unwrap();
        connection.execute("DELETE FROM document_types WHERE document=?1",[id]).unwrap();
        let mut content=document["content"].clone();
        content["attrs"]=json!({"markdownSource":"# 保留类型"});
        connection.execute("UPDATE documents SET content=?2 WHERE id=?1",params![id,encoded(&content).unwrap()]).unwrap();
        drop(connection);
        assert_eq!(desktop_export_extension(&root.0,id,false,true).unwrap(),"md");
        assert!(desktop_export_extension(&root.0,id,true,false).is_err());
    }
    #[test]
    fn document_kind_survives_saves_and_legacy_markdown_is_preserved() {
        let root = root();
        let doc = create(&root.0, "Markdown", "", "markdown").unwrap();
        let id = doc["id"].as_str().unwrap();
        assert_eq!(doc["kind"], "markdown");
        save(&root.0, save_input(id)).unwrap();
        assert_eq!(load(&root.0, id).unwrap()["kind"], "markdown");
        assert!(create(&root.0, "无效类型", "", "html").is_err());

        let old = create(&root.0, "旧文档", "", "word").unwrap();
        let old_id = old["id"].as_str().unwrap();
        let connection = db(&root.0).unwrap();
        connection.execute("DELETE FROM document_types WHERE document=?1", [old_id]).unwrap();
        assert_eq!(load(&root.0, old_id).unwrap()["kind"], "word");
        let mut content = old["content"].clone();
        content["attrs"] = json!({"markdownSource":"# 原始 Markdown"});
        connection.execute("UPDATE documents SET content=?2 WHERE id=?1", params![old_id, encoded(&content).unwrap()]).unwrap();
        drop(connection);
        assert_eq!(load(&root.0, old_id).unwrap()["kind"], "markdown");
        save(&root.0, save_input(old_id)).unwrap();
        assert_eq!(load(&root.0, old_id).unwrap()["kind"], "markdown");
    }
    #[test]fn saves_reopen_and_retries_exact_request_without_duplicate_events(){let root=root();let d=create(&root.0,"课程论文","2026-11-06T00:00:00Z","word").unwrap();let id=d["id"].as_str().unwrap();save(&root.0,save_input(id)).unwrap();save(&root.0,save_input(id)).unwrap();let loaded=load(&root.0,id).unwrap();assert_eq!(loaded["revision"],1);assert_eq!(loaded["event_count"],3);assert_eq!(version(&root.0,id,0).unwrap()["content"][0]["type"],"paragraph");let mut stale=save_input(id);stale.request_id="b".repeat(32);assert!(save(&root.0,stale).is_err());}
    #[test]fn export_verifies_and_tampering_fails_without_executable_content(){let root=root();let d=create(&root.0,"论文","2026-11-06T00:00:00Z","word").unwrap();let id=d["id"].as_str().unwrap();save(&root.0,save_input(id)).unwrap();let out=export(&root.0,id,"workproof.html").unwrap();assert!(out.report.valid);assert!(!out.html.contains("<script>"));assert!(out.html.contains("&lt;script&gt;"));assert!(!verify(&out.proof,&digest(b"changed"),7).valid);let mut p=out.proof.clone();p.records[1].event.inserted+=1;assert!(!verify(&p,&p.manifest.artifact_hash,p.manifest.artifact_bytes).valid);}
    #[test]fn rejects_path_ids_unknown_nodes_and_invalid_action_metrics(){let root=root();assert!(load(&root.0,"../key").is_err());let d=create(&root.0,"论文","","word").unwrap();let mut s=save_input(d["id"].as_str().unwrap());s.content=json!({"type":"doc","content":[{"type":"iframe"}]});assert!(save(&root.0,s).is_err());let mut s=save_input(d["id"].as_str().unwrap());s.actions[0].metrics.insert("clipboard_text".into(),1);assert!(save(&root.0,s).is_err());assert_eq!(load(&root.0,d["id"].as_str().unwrap()).unwrap()["revision"],0);}
    #[test]fn refuses_changed_body_before_signing_a_new_export(){let root=root();let d=create(&root.0,"论文","","word").unwrap();let id=d["id"].as_str().unwrap();save(&root.0,save_input(id)).unwrap();let db=db(&root.0).unwrap();db.execute("UPDATE documents SET content=?2 WHERE id=?1",params![id,encoded(&json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"altered"}]}]})).unwrap()]).unwrap();drop(db);assert!(export(&root.0,id,"workproof.html").is_err());}
}
