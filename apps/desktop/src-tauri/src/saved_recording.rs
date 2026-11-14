//! Native saved-file controller. Paths come only from native selection, never webview arguments.
use std::{io::Write,path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}}};
use serde_json::{json,Value};
use tauri::WebviewWindow;
use tokio::sync::{mpsc,oneshot};
use workproof_engine::saved_file::{SavedFileRecorder, ILLUSTRATOR_SOURCE, INDESIGN_SOURCE};

struct DocumentObservation {
    path: PathBuf,
    digest: String,
    saved: bool,
}

#[cfg(windows)]
fn document_snapshot(source: &str) -> Result<DocumentObservation,String> {
    let (label, script, variable, host)=if source==INDESIGN_SOURCE{
        ("InDesign",include_str!("../../../indesign/read-snapshot.ps1"),"WORKPROOF_INDESIGN_SOURCE",include_str!("../../../indesign/host.jsx"))
    }else{
        ("Illustrator",include_str!("../../../illustrator/read-snapshot.ps1"),"WORKPROOF_ILLUSTRATOR_SOURCE",include_str!("../../../illustrator/host.jsx"))
    };
    let root=std::env::var_os("SystemRoot").ok_or("无法定位 Windows PowerShell。")?;
    let mut command=std::process::Command::new(PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command.args(["-NoLogo","-NoProfile","-NonInteractive","-STA","-Command"])
        .arg(format!("& {{
{}
}}",script))
        .env(variable,host);
    let (status, output, _)=super::c2pa::capture(command, 6, 32768)?;
    if !status.success(){return Err(format!("无法读取当前 {label} 文档。请打开已保存的本地作品，关闭宿主中的对话框后重试。"));}
    let observation:Value=serde_json::from_slice(&output).map_err(|_|"宿主返回了无法识别的文档状态。")?;
    if observation["format"]!=format!("workproof-{source}-observation/1"){return Err("宿主采样格式不受支持。".into());}
    let path=observation["path"].as_str().ok_or("宿主未返回文件路径。")?;
    let path=PathBuf::from(path).canonicalize().map_err(|_|"无法定位宿主中的当前作品。")?;
    let digest=observation["geometry_sha256"].as_str().ok_or("宿主未返回几何摘要。")?.to_owned();
    let saved=observation["saved"].as_bool().ok_or("宿主未返回保存状态。")?;
    Ok(DocumentObservation{path,digest,saved})
}

#[cfg(not(windows))]
fn document_snapshot(_source: &str)->Result<DocumentObservation,String>{
    Err("Adobe 桌面记录目前支持 Windows。".into())
}

async fn observe_document(recorder:&SavedFileRecorder)->Result<DocumentObservation,String>{
    let source=recorder.status().source;
    let sample=tauri::async_runtime::spawn_blocking(move||document_snapshot(source)).await.map_err(|_|"宿主采样未完成。")??;
    if !recorder.matches_path(&sample.path){return Err("宿主已切换作品，请切回所选文件后继续。".into());}
    Ok(sample)
}

static STARTING:AtomicBool=AtomicBool::new(false);
static ACTIVE:Mutex<Option<Arc<Controller>>>=Mutex::new(None);
struct Starting;
impl Drop for Starting{fn drop(&mut self){STARTING.store(false,Ordering::Release);}}
struct Controller{send:mpsc::Sender<Command>,view:Arc<Mutex<Value>>}
enum Command{
    Pause(oneshot::Sender<Result<(),String>>),Resume(oneshot::Sender<Result<(),String>>),
    Finish(PathBuf,oneshot::Sender<Result<(),String>>),
}
fn state(handle:&Controller)->Result<Value,String>{handle.view.lock().map(|value|value.clone()).map_err(|_|"无法读取记录状态。".into())}
fn active()->Result<Arc<Controller>,String>{ACTIVE.lock().map_err(|_|"无法读取记录状态。")?.clone().ok_or_else(||"请先选择一份作品并开始记录。".into())}
fn publish(recorder:&SavedFileRecorder,view:&Mutex<Value>,error:&str,active:bool){
    let mut value=serde_json::to_value(recorder.status()).unwrap_or_else(|_|json!({}));
    value["active"]=active.into();value["error"]=error.into();
    if let Ok(mut current)=view.lock(){*current=value;}
}
fn controller(mut recorder:SavedFileRecorder)->Arc<Controller>{
    let (send,mut receive)=mpsc::channel(8);
    let view=Arc::new(Mutex::new(json!({})));publish(&recorder,&view,"",true);
    let handle=Arc::new(Controller{send,view:view.clone()});
    tauri::async_runtime::spawn(async move{
        let has_host=matches!(recorder.status().source, ILLUSTRATOR_SOURCE|INDESIGN_SOURCE);
        let mut interval=tokio::time::interval(std::time::Duration::from_secs(if has_host{4}else{2}));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut error=String::new();
        loop{
            tokio::select!{
                _=interval.tick()=>{
                    if has_host&&!recorder.status().paused{
                        let sample=observe_document(&recorder).await;
                        let result=match sample{
                            Ok(sample)=>recorder.observe_geometry(sample.digest).await,
                            Err(error)=>Err(error),
                        };
                        if let Err(message)=result{
                            error=message;
                            if let Err(failure)=recorder.pause().await{error.push_str(&format!(" {failure}"));}
                            publish(&recorder,&view,&error,true);
                            continue;
                        }
                    }
                    match recorder.observe().await{Ok(true)=>error.clear(),Ok(false)=>{},Err(message)=>error=message}
                    publish(&recorder,&view,&error,true);
                },
                command=receive.recv()=>{
                    let Some(command)=command else{break;};
                    let (result,response,finished)=match command{
                        Command::Pause(reply)=>(recorder.pause().await,reply,false),
                        Command::Resume(reply)=>{
                            let result=async{
                                if has_host{observe_document(&recorder).await?;}
                                recorder.resume().await
                            }.await;
                            (result,reply,false)
                        },
                        Command::Finish(path,reply)=>{
                            let result=async{
                                if has_host&&!observe_document(&recorder).await?.saved{
                                    return Err("请先在创作软件中保存当前作品，再导出证书。".into());
                                }
                                let proof=recorder.export().await?;
                                let bytes=serde_json::to_vec(&proof).map_err(|_|"无法整理证书。".to_string())?;
                                if bytes.len()>32*1024*1024{return Err("证书超过当前核验器的容量，记录已保留。".into());}
                                tauri::async_runtime::spawn_blocking(move||->Result<(),String>{
                                    let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path)
                                        .map_err(|_|"证书位置不可写或文件已存在，请另选文件名。".to_string())?;
                                    file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|"证书未能完整保存，记录仍保留，请另选位置。".to_string())
                                }).await.map_err(|_|"证书保存任务未完成。".to_string())?
                            }.await;
                            let finished=result.is_ok();(result,reply,finished)
                        }
                    };
                    error=result.as_ref().err().cloned().unwrap_or_default();
                    publish(&recorder,&view,&error,!finished);
                    let _=response.send(result);
                    if finished{break;}
                }
            }
        }
    });handle
}
async fn pause(handle:&Controller)->Result<(),String>{
    let (reply,response)=oneshot::channel();
    handle.send.send(Command::Pause(reply)).await.map_err(|_|"本次记录已结束。")?;
    response.await.map_err(|_|"暂停任务未完成。")?
}

#[tauri::command]
pub async fn saved_recording_status(window:WebviewWindow)->Result<Value,String>{
    super::workbench_only(&window)?;
    let handle=ACTIVE.lock().map_err(|_|"无法读取记录状态。")?.clone();
    handle.as_ref().map(|handle|state(handle)).unwrap_or_else(||Ok(json!({"active":false})))
}
#[tauri::command]
pub async fn saved_recording_start(window:WebviewWindow,started_at:String,source:Option<String>)->Result<Value,String>{
    super::workbench_only(&window)?;
    if !cfg!(windows){return Err("SAI2、Illustrator 和 InDesign 记录目前在 Windows 客户端提供。".into());}
    if !workproof_engine::snapshot()?.ready{return Err("记录服务正在准备，请稍候。".into());}
    if STARTING.swap(true,Ordering::AcqRel){return Err("正在选择或准备作品，请稍候。".into());}
    let _starting=Starting;
    if let Ok(handle)=active(){if state(&handle)?["active"]==true{return Err("请先导出并结束当前记录，再选择另一份作品。".into());}}
    let source=match source.as_deref(){
        None|Some("sai2-file")=>"sai2-file",
        Some(ILLUSTRATOR_SOURCE)=>ILLUSTRATOR_SOURCE,
        Some(INDESIGN_SOURCE)=>INDESIGN_SOURCE,
        _=>return Err("不支持这个作品来源。".into()),
    };
    let selected=tauri::async_runtime::spawn_blocking(move||{
        let (title,filter)=match source{
            ILLUSTRATOR_SOURCE=>("选择 Illustrator 已打开的本地作品","Illustrator 作品|*.ai"),
            INDESIGN_SOURCE=>("选择 InDesign 已打开的本地作品","InDesign 作品|*.indd"),
            _=>("选择已保存的 SAI2 作品","SAI2 作品|*.sai2"),
        };
        super::c2pa::pick(title,filter,false,"")
    }).await.map_err(|_|"文件选择未完成。".to_string())??;
    let Some(path)=selected else{return Ok(json!({"cancelled":true}));};
    let root=workproof_engine::data_dir()?;
    let recorder=if source!="sai2-file"{
        let sample=tauri::async_runtime::spawn_blocking(move||document_snapshot(source)).await.map_err(|_|"宿主采样未完成。")??;
        let selected=path.canonicalize().map_err(|_|"无法定位所选作品。")?;
        if selected!=sample.path{return Err("请选择宿主中当前打开的作品。".into());}
        if source==INDESIGN_SOURCE{
            SavedFileRecorder::begin_indesign(root,selected,started_at,sample.digest).await?
        }else{
            SavedFileRecorder::begin_illustrator(root,selected,started_at,sample.digest).await?
        }
    }else{SavedFileRecorder::begin(root,path,started_at).await?};
    let handle=controller(recorder);let result=state(&handle)?;
    *ACTIVE.lock().map_err(|_|"记录已开始，但状态暂时无法显示。")?=Some(handle);
    Ok(result)
}
#[tauri::command]
pub async fn saved_recording_pause(window:WebviewWindow,resume:bool)->Result<Value,String>{
    super::workbench_only(&window)?;let handle=active()?;
    if resume{
        let (reply,response)=oneshot::channel();handle.send.send(Command::Resume(reply)).await.map_err(|_|"本次记录已结束。")?;
        response.await.map_err(|_|"继续任务未完成。")??;
    }else{pause(&handle).await?;}
    state(&handle)
}
#[tauri::command]
pub async fn saved_recording_finish(window:WebviewWindow)->Result<Value,String>{
    super::workbench_only(&window)?;let handle=active()?;pause(&handle).await?;
    let view=state(&handle)?;
    let suggested=format!("{}.wproof",view["file_name"].as_str().unwrap_or("SAI2作品.sai2"));
    let selected=tauri::async_runtime::spawn_blocking(move||super::c2pa::pick("先在创作软件中保存作品，再选择证书保存位置","WorkProof 证书|*.wproof",true,&suggested))
        .await.map_err(|_|"证书位置选择未完成。".to_string())??;
    let Some(path)=selected else{return Ok(json!({"cancelled":true,"paused":true}));};
    if !path.is_absolute()||!path.extension().and_then(|extension|extension.to_str()).is_some_and(|extension|extension.eq_ignore_ascii_case("wproof")){
        return Err("请使用 .wproof 证书文件名。".into());
    }
    let (reply,response)=oneshot::channel();
    handle.send.send(Command::Finish(path,reply)).await.map_err(|_|"本次记录已结束。")?;
    response.await.map_err(|_|"证书保存未完成。")??;
    state(&handle)
}


#[cfg(test)]mod tests{
    use super::*;
    struct Fixture(PathBuf);
    impl Drop for Fixture{fn drop(&mut self){
        let temporary=std::fs::canonicalize(std::env::temp_dir()).unwrap();
        if let Ok(actual)=self.0.canonicalize(){
            assert_eq!(actual.parent(),Some(temporary.as_path()));
            assert!(actual.file_name().unwrap().to_string_lossy().starts_with("workproof-saved-controller-"));
            let _=std::fs::remove_dir_all(actual);
        }
    }}
    #[tokio::test]async fn failed_certificate_write_keeps_controller_and_existing_file(){
        let nonce=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let fixture=Fixture(std::env::temp_dir().join(format!("workproof-saved-controller-{}-{nonce}",std::process::id())));
        let profile=fixture.0.join("profile");workproof_engine::Store::open(&profile,43127).unwrap();
        let artifact=fixture.0.join("fixture.sai2");std::fs::write(&artifact,b"synthetic SAI2 saved bytes").unwrap();
        let recorder=SavedFileRecorder::begin(profile,artifact,"2026-11-14T00:00:00Z".into()).await.unwrap();
        let handle=controller(recorder);pause(&handle).await.unwrap();
        let existing=fixture.0.join("existing.wproof");std::fs::write(&existing,b"keep original").unwrap();
        let (reply,response)=oneshot::channel();handle.send.send(Command::Finish(existing.clone(),reply)).await.unwrap();
        assert!(response.await.unwrap().is_err());
        assert_eq!(std::fs::read(&existing).unwrap(),b"keep original");
        assert_eq!(state(&handle).unwrap()["active"],true);assert_eq!(state(&handle).unwrap()["paused"],true);
        let output=fixture.0.join("fresh.wproof");
        let (reply,response)=oneshot::channel();handle.send.send(Command::Finish(output.clone(),reply)).await.unwrap();
        response.await.unwrap().unwrap();handle.send.closed().await;
        assert_eq!(state(&handle).unwrap()["active"],false);
        let certificate:Value=serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
        assert_eq!(certificate["manifest"]["source"],"sai2-file");
        assert_eq!(certificate["records"].as_array().unwrap().last().unwrap()["event"]["kind"],"save");
    }
}
