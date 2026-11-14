//! Native saved-file controller. Paths come only from native selection, never webview arguments.
use std::{io::Write,path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}}};
use serde_json::{json,Value};
use tauri::WebviewWindow;
use tokio::sync::{mpsc,oneshot};
use workproof_engine::saved_file::SavedFileRecorder;

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
        let mut interval=tokio::time::interval(std::time::Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut error=String::new();
        loop{
            tokio::select!{
                _=interval.tick()=>{
                    match recorder.observe().await{Ok(true)=>error.clear(),Ok(false)=>{},Err(message)=>error=message}
                    publish(&recorder,&view,&error,true);
                },
                command=receive.recv()=>{
                    let Some(command)=command else{break;};
                    let (result,response,finished)=match command{
                        Command::Pause(reply)=>(recorder.pause().await,reply,false),
                        Command::Resume(reply)=>(recorder.resume().await,reply,false),
                        Command::Finish(path,reply)=>{
                            let result=async{
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
pub async fn saved_recording_start(window:WebviewWindow,started_at:String)->Result<Value,String>{
    super::workbench_only(&window)?;
    if !cfg!(windows){return Err("SAI2 保存版本记录目前在 Windows 客户端提供。".into());}
    if !workproof_engine::snapshot()?.ready{return Err("记录服务正在准备，请稍候。".into());}
    if STARTING.swap(true,Ordering::AcqRel){return Err("正在选择或准备作品，请稍候。".into());}
    let _starting=Starting;
    if let Ok(handle)=active(){if state(&handle)?["active"]==true{return Err("请先导出并结束当前记录，再选择另一份作品。".into());}}
    let selected=tauri::async_runtime::spawn_blocking(||super::c2pa::pick("选择已保存的 SAI2 作品，仅记录这个文件的保存版本","SAI2 作品|*.sai2",false,""))
        .await.map_err(|_|"文件选择未完成。".to_string())??;
    let Some(path)=selected else{return Ok(json!({"cancelled":true}));};
    let recorder=SavedFileRecorder::begin(workproof_engine::data_dir()?,path,started_at).await?;
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
    let selected=tauri::async_runtime::spawn_blocking(move||super::c2pa::pick("先在 SAI2 保存作品，再选择证书保存位置","WorkProof 证书|*.wproof",true,&suggested))
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
