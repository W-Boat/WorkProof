//! Browser and native plugin grants require explicit approval in the desktop window.
//! Neither exposes the master token or grants access to native local-file sealing.
use super::*;
use std::{collections::{HashMap,HashSet},sync::OnceLock,time::{Duration,Instant}};
use axum::{extract::Request,middleware::Next,response::Response,http::{header,Method,HeaderValue}};
#[derive(Serialize,Clone)]
pub struct Pending {pub ticket:String,pub origin:String,pub source:String,pub channel:String}
#[derive(Serialize,Clone)]
pub struct Connection {pub ticket:String,pub origin:String,pub source:String,pub channel:String,pub expires_in_seconds:u64,pub sessions:usize}
struct Grant {request:Pending,created:Instant,approved:bool,token:String,sessions:HashSet<String>}
static GRANTS:OnceLock<Mutex<HashMap<String,Grant>>>=OnceLock::new();
fn grants()->&'static Mutex<HashMap<String,Grant>>{GRANTS.get_or_init(||Mutex::new(HashMap::new()))}
fn valid_origin(s:&str)->bool{
    if s.len()>512{return false;}
    let Ok(uri)=s.parse::<axum::http::Uri>() else{return false;};
    let Some(authority)=uri.authority() else{return false;};
    !authority.as_str().contains('@') && uri.query().is_none() && uri.path()=="/"
        && (uri.scheme_str()==Some("https") || (uri.scheme_str()==Some("http")&&matches!(authority.host(),"localhost"|"127.0.0.1")))
}
fn origin(headers:&HeaderMap)->Result<String,ApiError>{
    let value=headers.get("origin").and_then(|v|v.to_str().ok()).ok_or_else(||bad("BROWSER_ORIGIN_REQUIRED"))?;
    if !valid_origin(value){return Err(bad("INVALID_BROWSER_ORIGIN"));}Ok(value.into())
}
fn token(headers:&HeaderMap)->&str{headers.get("authorization").and_then(|v|v.to_str().ok()).unwrap_or("").strip_prefix("Bearer ").unwrap_or("")}
pub fn allows(headers:&HeaderMap,session:Option<&str>,source:Option<&str>)->bool{
    let (channel,origin)=if headers.contains_key("origin"){
        let Ok(origin)=origin(headers) else{return false;};("browser",origin)
    }else{("native",String::new())};
    let Ok(map)=grants().lock() else{return false;};
    map.values().any(|g|g.approved&&g.created.elapsed()<Duration::from_secs(8*3600)&&g.request.channel==channel&&g.request.origin==origin&&g.token==token(headers)
        && session.is_none_or(|id|g.sessions.contains(id))&&source.is_none_or(|s|g.request.source==s))
}
pub fn bind(headers:&HeaderMap,id:&str){
    if let Ok(mut map)=grants().lock(){for grant in map.values_mut(){if grant.token==token(headers)&&grant.approved{grant.sessions.insert(id.into());break;}}}
}
pub fn pending()->Vec<Pending>{
    if let Ok(mut map)=grants().lock(){
        map.retain(|_,g|g.created.elapsed()<Duration::from_secs(if g.approved{8*3600}else{120}));
        map.values().filter(|g|!g.approved).map(|g|g.request.clone()).collect()
    }else{vec![]}
}
/// Desktop-only metadata. Never serialize grant tokens or recorded document names.
pub fn connections()->Vec<Connection>{
    let Ok(mut map)=grants().lock() else{return vec![];};
    map.retain(|_,g|g.created.elapsed()<Duration::from_secs(if g.approved{8*3600}else{120}));
    let mut result:Vec<_>=map.values().filter(|g|g.approved).map(|g|Connection{
        ticket:g.request.ticket.clone(),origin:g.request.origin.clone(),source:g.request.source.clone(),channel:g.request.channel.clone(),
        expires_in_seconds:Duration::from_secs(8*3600).saturating_sub(g.created.elapsed()).as_secs(),sessions:g.sessions.len(),
    }).collect();
    result.sort_by(|a,b|a.ticket.cmp(&b.ticket));result
}
/// Removing a grant denies subsequent requests. A request already authorized may finish.
/// Existing SQLite records and previously exported signatures remain intact.
pub fn revoke(ticket:&str)->Result<(),String>{
    let mut map=grants().lock().map_err(|_|"连接状态不可用")?;
    if map.get(ticket).is_some_and(|g|!g.approved){return Err("此连接尚未批准，请使用拒绝操作".into());}
    map.remove(ticket);Ok(())
}
pub fn decide(ticket:&str,approve:bool)->Result<(),String>{
    let mut map=grants().lock().map_err(|_|"配对状态不可用")?;
    if !approve{map.remove(ticket);return Ok(());}
    let g=map.get_mut(ticket).ok_or("连接请求已过期")?;
    if g.approved||g.created.elapsed()>Duration::from_secs(120){return Err("连接请求已过期".into());}
    g.approved=true;g.created=Instant::now();Ok(())
}
#[derive(Deserialize)] #[serde(deny_unknown_fields)]
pub struct PairRequest {source:String}
pub async fn request_pair(headers:HeaderMap,Json(input):Json<PairRequest>)->ApiResult<Pending>{
    let origin=origin(&headers)?;
    if !matches!(input.source.as_str(),"word"|"wps"|"photoshop"){return Err(bad("UNSUPPORTED_ADAPTER"));}
    insert_request(origin,input.source,"browser")
}
fn insert_request(origin:String,source:String,channel:&str)->ApiResult<Pending>{
    let _=pending();
    let mut map=grants().lock().map_err(|_|bad("PAIRING_UNAVAILABLE"))?;
    if map.len()>=16||map.values().filter(|g|!g.approved).count()>=4{return Err(ApiError(StatusCode::TOO_MANY_REQUESTS,"PAIRING_LIMIT".into()));}
    let request=Pending{ticket:random_hex(32),origin,source,channel:channel.into()};
    map.insert(request.ticket.clone(),Grant{request:request.clone(),created:Instant::now(),approved:false,token:random_hex(32),sessions:HashSet::new()});
    Ok(Json(request))
}
pub async fn poll_pair(headers:HeaderMap,Path(ticket):Path<String>)->ApiResult<serde_json::Value>{
    let origin=origin(&headers)?;
    poll(&ticket,&origin,"browser")
}
fn poll(ticket:&str,origin:&str,channel:&str)->ApiResult<serde_json::Value>{
    let map=grants().lock().map_err(|_|bad("PAIRING_UNAVAILABLE"))?;
    let grant=map.get(ticket).ok_or_else(||bad("PAIRING_EXPIRED"))?;
    if grant.request.origin!=origin||grant.request.channel!=channel{return Err(ApiError(StatusCode::FORBIDDEN,"PAIRING_CHANNEL_MISMATCH".into()));}
    if grant.created.elapsed()>Duration::from_secs(if grant.approved{8*3600}else{120}){return Err(bad("PAIRING_EXPIRED"));}
    Ok(Json(if grant.approved{serde_json::json!({"approved":true,"token":grant.token})}else{serde_json::json!({"approved":false})}))
}
fn require_native(headers:&HeaderMap)->Result<(),ApiError>{
    if headers.contains_key("origin"){return Err(ApiError(StatusCode::FORBIDDEN,"ORIGINLESS_NATIVE_CLIENT_REQUIRED".into()));}Ok(())
}
pub async fn request_native(headers:HeaderMap,Json(input):Json<PairRequest>)->ApiResult<Pending>{
    require_native(&headers)?;
    if !matches!(input.source.as_str(),"photoshop"|"word"|"powerpoint"|"krita"){return Err(bad("UNSUPPORTED_NATIVE_ADAPTER"));}
    insert_request(String::new(),input.source,"native")
}
pub async fn poll_native(headers:HeaderMap,Path(ticket):Path<String>)->ApiResult<serde_json::Value>{
    require_native(&headers)?;
    let Json(mut response)=poll(&ticket,"","native")?;
    if response["approved"]==true{response["local_path_binding"]=serde_json::json!(true);}
    Ok(Json(response))
}
pub async fn cors(request:Request,next:Next)->Response{
    let allowed=origin(request.headers()).ok();
    let preflight=request.method()==Method::OPTIONS;
    let mut response=if preflight{StatusCode::NO_CONTENT.into_response()}else{next.run(request).await};
    if let Some(origin)=allowed{
        let h=response.headers_mut();
        if let Ok(value)=HeaderValue::from_str(&origin){h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN,value);}
        h.insert(header::VARY,HeaderValue::from_static("Origin"));
        h.insert(header::ACCESS_CONTROL_ALLOW_METHODS,HeaderValue::from_static("GET, POST, OPTIONS"));
        h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS,HeaderValue::from_static("Authorization, Content-Type"));
        h.insert("access-control-allow-private-network",HeaderValue::from_static("true"));
    }
    response
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn strict_origins(){assert!(valid_origin("https://office.example"));assert!(valid_origin("http://127.0.0.1:4173"));assert!(!valid_origin("null"));assert!(!valid_origin("http://evil.example"));assert!(!valid_origin("https://office.example/path"));assert!(!valid_origin("https://user@office.example"));}
    #[tokio::test]async fn explicit_approval_and_origin_session_scope(){
        let mut headers=HeaderMap::new();headers.insert("origin",HeaderValue::from_static("https://word-test.example"));
        let Json(pending)=request_pair(headers.clone(),Json(PairRequest{source:"word".into()})).await.ok().unwrap();
        assert!(!allows(&headers,None,None));
        decide(&pending.ticket,true).unwrap();
        let Json(result)=poll_pair(headers.clone(),Path(pending.ticket.clone())).await.ok().unwrap();
        headers.insert("authorization",HeaderValue::from_str(&format!("Bearer {}",result["token"].as_str().unwrap())).unwrap());
        assert!(allows(&headers,None,Some("word")));assert!(!allows(&headers,None,Some("wps")));
        bind(&headers,"owned");assert!(allows(&headers,Some("owned"),None));assert!(!allows(&headers,Some("other"),None));
        headers.insert("origin",HeaderValue::from_static("https://other.example"));assert!(!allows(&headers,Some("owned"),None));
        decide(&pending.ticket,false).unwrap();
    }
    #[tokio::test]async fn native_grant_approval_and_channel_isolation(){
        let headers=HeaderMap::new();
        let Json(p)=request_native(headers.clone(),Json(PairRequest{source:"photoshop".into()})).await.ok().unwrap();
        assert_eq!(p.channel,"native");assert!(p.origin.is_empty());
        let Json(waiting)=poll_native(headers.clone(),Path(p.ticket.clone())).await.ok().unwrap();assert_eq!(waiting["approved"],false);
        decide(&p.ticket,true).unwrap();
        let Json(result)=poll_native(headers.clone(),Path(p.ticket.clone())).await.ok().unwrap();
        let mut authenticated=headers.clone();authenticated.insert("authorization",HeaderValue::from_str(&format!("Bearer {}",result["token"].as_str().unwrap())).unwrap());
        assert!(allows(&authenticated,None,Some("photoshop")));assert!(!allows(&authenticated,None,Some("word")));
        bind(&authenticated,"native-owned");assert!(allows(&authenticated,Some("native-owned"),None));assert!(!allows(&authenticated,Some("foreign"),None));
        authenticated.insert("origin",HeaderValue::from_static("https://photoshop.example"));
        assert!(!allows(&authenticated,Some("native-owned"),None));
        assert!(poll_native(authenticated.clone(),Path(p.ticket.clone())).await.is_err());
        assert!(poll_pair(authenticated,Path(p.ticket.clone())).await.is_err());
        decide(&p.ticket,false).unwrap();
        assert!(!allows(&headers,None,None));
    }
    #[tokio::test]async fn native_krita_is_approved_source_and_session_scoped(){
        let Json(p)=request_native(HeaderMap::new(),Json(PairRequest{source:"krita".into()})).await.ok().unwrap();
        let Json(waiting)=poll_native(HeaderMap::new(),Path(p.ticket.clone())).await.ok().unwrap();
        assert_eq!(waiting["approved"],false);
        decide(&p.ticket,true).unwrap();
        let Json(result)=poll_native(HeaderMap::new(),Path(p.ticket.clone())).await.ok().unwrap();
        let mut headers=HeaderMap::new();headers.insert("authorization",HeaderValue::from_str(&format!("Bearer {}",result["token"].as_str().unwrap())).unwrap());
        assert!(allows(&headers,None,Some("krita")));
        for other in ["word","wps","photoshop","powerpoint"]{assert!(!allows(&headers,None,Some(other)));}
        bind(&headers,"krita-owned");assert!(allows(&headers,Some("krita-owned"),Some("krita")));
        assert!(!allows(&headers,Some("foreign"),None));
        headers.insert("origin",HeaderValue::from_static("https://localhost:18443"));
        assert!(!allows(&headers,None,Some("krita")));
        assert!(poll_native(headers.clone(),Path(p.ticket.clone())).await.is_err());
        assert!(request_pair(headers,Json(PairRequest{source:"krita".into()})).await.is_err());
        decide(&p.ticket,false).unwrap();
    }
    #[tokio::test]async fn native_word_requires_approval_and_stays_scoped(){
        let Json(p)=request_native(HeaderMap::new(),Json(PairRequest{source:"word".into()})).await.ok().unwrap();
        assert_eq!(p.source,"word");assert_eq!(p.channel,"native");
        decide(&p.ticket,true).unwrap();
        let Json(result)=poll_native(HeaderMap::new(),Path(p.ticket.clone())).await.ok().unwrap();
        let mut headers=HeaderMap::new();headers.insert("authorization",HeaderValue::from_str(&format!("Bearer {}",result["token"].as_str().unwrap())).unwrap());
        assert!(allows(&headers,None,Some("word")));assert!(!allows(&headers,None,Some("photoshop")));
        bind(&headers,"word-native-owned");assert!(allows(&headers,Some("word-native-owned"),None));assert!(!allows(&headers,Some("foreign"),None));
        headers.insert("origin",HeaderValue::from_static("https://localhost:18443"));assert!(!allows(&headers,None,Some("word")));
        decide(&p.ticket,false).unwrap();
    }
    #[tokio::test]async fn native_powerpoint_is_approved_source_and_session_scoped(){
        let Json(p)=request_native(HeaderMap::new(),Json(PairRequest{source:"powerpoint".into()})).await.ok().unwrap();
        let Json(waiting)=poll_native(HeaderMap::new(),Path(p.ticket.clone())).await.ok().unwrap();
        assert_eq!(waiting["approved"],false);assert_eq!(p.source,"powerpoint");
        decide(&p.ticket,true).unwrap();
        let Json(result)=poll_native(HeaderMap::new(),Path(p.ticket.clone())).await.ok().unwrap();
        let mut headers=HeaderMap::new();headers.insert("authorization",HeaderValue::from_str(&format!("Bearer {}",result["token"].as_str().unwrap())).unwrap());
        assert!(allows(&headers,None,Some("powerpoint")));
        for other in ["word","wps","photoshop"]{assert!(!allows(&headers,None,Some(other)));}
        bind(&headers,"powerpoint-owned");assert!(allows(&headers,Some("powerpoint-owned"),Some("powerpoint")));
        assert!(!allows(&headers,Some("word-owned"),None));
        headers.insert("origin",HeaderValue::from_static("https://localhost:18443"));
        assert!(!allows(&headers,None,Some("powerpoint")));
        assert!(poll_native(headers.clone(),Path(p.ticket.clone())).await.is_err());
        assert!(request_pair(headers,Json(PairRequest{source:"powerpoint".into()})).await.is_err());
        decide(&p.ticket,false).unwrap();
    }
    #[tokio::test]async fn desktop_revocation_preserves_other_connections_and_hides_secrets(){
        let mut word=HeaderMap::new();word.insert("origin",HeaderValue::from_static("https://revoke-word.example"));
        let Json(w)=request_pair(word.clone(),Json(PairRequest{source:"word".into()})).await.ok().unwrap();
        assert!(!connections().iter().any(|c|c.ticket==w.ticket));
        assert!(revoke(&w.ticket).is_err());
        decide(&w.ticket,true).unwrap();
        let Json(auth)=poll_pair(word.clone(),Path(w.ticket.clone())).await.ok().unwrap();
        let secret=auth["token"].as_str().unwrap();
        word.insert("authorization",HeaderValue::from_str(&format!("Bearer {secret}")).unwrap());bind(&word,"word-owned");
        let Json(native)=request_native(HeaderMap::new(),Json(PairRequest{source:"photoshop".into()})).await.ok().unwrap();
        decide(&native.ticket,true).unwrap();
        let metadata=connections();let own=metadata.iter().find(|c|c.ticket==w.ticket).unwrap();
        assert_eq!(own.sessions,1);assert!(own.expires_in_seconds>0&&own.expires_in_seconds<=8*3600);
        assert_eq!(own.origin,"https://revoke-word.example");
        let serialized=serde_json::to_string(&metadata).unwrap();assert!(!serialized.contains(secret));assert!(!serialized.contains("word-owned"));
        assert!(allows(&word,Some("word-owned"),None));revoke(&w.ticket).unwrap();revoke(&w.ticket).unwrap();
        assert!(!allows(&word,None,None));assert!(!allows(&word,Some("word-owned"),None));
        assert!(poll_pair(word,Path(w.ticket.clone())).await.is_err());
        assert!(!connections().iter().any(|c|c.ticket==w.ticket));assert!(connections().iter().any(|c|c.ticket==native.ticket));
        {let mut map=grants().lock().unwrap();map.get_mut(&native.ticket).unwrap().created=Instant::now()-Duration::from_secs(8*3600+1);}
        assert!(!connections().iter().any(|c|c.ticket==native.ticket));
    }
}
