#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{menu::{Menu,MenuItem},tray::TrayIconBuilder,Manager,Emitter};
mod platform;
mod c2pa;
mod office_setup;
mod editor;
static ALLOW_CLOSE:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
#[tauri::command]
fn window_action(window:tauri::WebviewWindow,action:String)->Result<(),String>{
    workbench_only(&window)?;
    let result=match action.as_str(){
        "minimize"=>window.minimize(),
        "maximize"=>if window.is_maximized().map_err(|_|"无法读取窗口状态。")?{window.unmaximize()}else{window.maximize()},
        "close"=>{
            ALLOW_CLOSE.store(true,std::sync::atomic::Ordering::Release);
            let result=window.close();
            if result.is_err(){ALLOW_CLOSE.store(false,std::sync::atomic::Ordering::Release);}
            result
        },
        "quit"=>{window.app_handle().exit(0);Ok(())},
        "drag"=>window.start_dragging(),
        _=>return Err("不支持的窗口操作。".into())
    };
    result.map_err(|_|"窗口操作未完成，请重试。".into())
}
#[tauri::command]
async fn office_setup(window:tauri::WebviewWindow,host:String,install:bool)->Result<serde_json::Value,String>{
    workbench_only(&window)?;
    tauri::async_runtime::spawn_blocking(move||office_setup::office_setup(&host,install)).await.map_err(|_|"安装任务未能完成，请重新检查安装状态。".to_string())?
}
fn workbench_only(window:&tauri::WebviewWindow)->Result<(),String>{
    workbench_label(window.label())
}
fn workbench_label(label:&str)->Result<(),String>{
    if label=="status" {Ok(())} else {Err("请从 WorkProof 创作工作台执行此操作。".into())}
}
fn verifier_navigation(url:&tauri::Url,port:u16)->bool{
    url.scheme()=="http" && url.host_str()==Some("127.0.0.1") && url.port()==Some(port)
        && url.username().is_empty() && url.password().is_none()
}
#[tauri::command]
async fn embed_image(window:tauri::WebviewWindow,app:tauri::AppHandle,consent:bool)->Result<serde_json::Value,String>{
    workbench_only(&window)?;
    if !consent{return Err("请先同意公开所选证书中的过程信息。".into());}
    let resource=app.path().resource_dir().map_err(|_|"无法定位安装资源。".to_string())?;
    tauri::async_runtime::spawn_blocking(move||c2pa::embed(resource,consent)).await.map_err(|_|"图片封装未能完成，请检查输出位置后重试。".to_string())?
}
#[tauri::command]
async fn verify_image(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<serde_json::Value,String>{
    workbench_only(&window)?;
    let resource=app.path().resource_dir().map_err(|_|"无法定位安装资源。".to_string())?;
    tauri::async_runtime::spawn_blocking(move||c2pa::verify(resource)).await.map_err(|_|"图片核验未能完成，请重试。".to_string())?
}
#[tauri::command]
async fn open_powerpoint(window:tauri::WebviewWindow)->Result<String,String>{
    workbench_only(&window)?;
    tauri::async_runtime::spawn_blocking(platform::open_powerpoint).await.map_err(|e|e.to_string())??;
    Ok("已向 PowerPoint 发出开始请求。首次连接请在此允许 PowerPoint；请以其侧栏的记录状态为准。".into())
}
#[tauri::command]
async fn open_word(window:tauri::WebviewWindow)->Result<String,String>{
    workbench_only(&window)?;
    tauri::async_runtime::spawn_blocking(platform::open_word).await.map_err(|e|e.to_string())??;
    Ok("已向 Word 发出开始请求。首次连接请在此允许 Word；记录成功后，Word 会显示确认提示。".into())
}
#[tauri::command]
fn engine_status(window:tauri::WebviewWindow)->Result<workproof_engine::EngineSnapshot,String>{workbench_only(&window)?;workproof_engine::snapshot()}
#[tauri::command]
fn pending_adapters(window:tauri::WebviewWindow)->Result<Vec<workproof_engine::pairing::Pending>,String>{workbench_only(&window)?;Ok(workproof_engine::pairing::pending())}
#[tauri::command]
fn decide_adapter(window:tauri::WebviewWindow,ticket:String,approve:bool)->Result<(),String>{workbench_only(&window)?;workproof_engine::pairing::decide(&ticket,approve)}
#[tauri::command]
fn adapter_connections(window:tauri::WebviewWindow)->Result<Vec<workproof_engine::pairing::Connection>,String>{workbench_only(&window)?;Ok(workproof_engine::pairing::connections())}
#[tauri::command]
fn revoke_adapter(window:tauri::WebviewWindow,ticket:String)->Result<(),String>{workbench_only(&window)?;workproof_engine::pairing::revoke(&ticket)}
async fn verifier_port(app:&tauri::AppHandle)->Result<u16,String>{
    let dir=app.path().resource_dir().map_err(|e|e.to_string())?.join("verifier");
    if !dir.join("index.html").is_file(){return Err("检查页面的安装文件不完整，请重新安装 WorkProof。".into());}
    static SERVER:std::sync::OnceLock<tokio::sync::Mutex<Option<u16>>>=std::sync::OnceLock::new();
    let mut port=SERVER.get_or_init(||tokio::sync::Mutex::new(None)).lock().await;
    let p=if let Some(p)=*port{p}else{
        let listener=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).await.map_err(|e|e.to_string())?;
        let p=listener.local_addr().map_err(|e|e.to_string())?.port();
        tauri::async_runtime::spawn(async move{let router=axum::Router::new().fallback_service(tower_http::services::ServeDir::new(dir));let _=axum::serve(listener,router).await;});
        *port=Some(p);p
    };
    Ok(p)
}
#[tauri::command]
async fn open_verifier(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<String,String>{
    workbench_only(&window)?;
    let p=verifier_port(&app).await?;
    if let Some(existing)=app.get_webview_window("verifier"){
        existing.unminimize().map_err(|e|e.to_string())?;
        existing.show().map_err(|e|e.to_string())?;
        existing.set_focus().map_err(|e|e.to_string())?;
    }else{
        let url=format!("http://127.0.0.1:{p}/").parse().map_err(|_|"核验页面地址无效。".to_string())?;
        tauri::WebviewWindowBuilder::new(&app,"verifier",tauri::WebviewUrl::External(url))
            .title("WorkProof · 作品核验").inner_size(1120.,800.).min_inner_size(420.,480.)
            .on_navigation(move|url|verifier_navigation(url,p))
            .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
            .build().map_err(|e|e.to_string())?;
    }
    Ok("已在 WorkProof 内打开核验页。".into())
}
#[tauri::command]
async fn open_verifier_browser(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<String,String>{
    workbench_only(&window)?;
    let p=verifier_port(&app).await?;
    tauri::async_runtime::spawn_blocking(move||platform::open_verifier(p)).await.map_err(|e|e.to_string())??;
    Ok("已请求系统浏览器打开核验页。".into())
}
#[tauri::command]
async fn verifier_url(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<String,String>{workbench_only(&window)?;Ok(format!("http://127.0.0.1:{}/",verifier_port(&app).await?))}
#[tauri::command]
async fn install_vscode(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<String,String>{
    workbench_only(&window)?;
    let vsix=app.path().resource_dir().map_err(|e|e.to_string())?.join("workproof.vsix");
    if !vsix.is_file(){return Err("插件资源缺失，请重新安装完整安装包。".into());}
    tauri::async_runtime::spawn_blocking(move||platform::install_vscode(&vsix)).await.map_err(|e|e.to_string())??;
    Ok("插件安装完成。在 VS Code 状态栏点击 WorkProof 即可开始记录。".into())
}
fn main(){
    tauri::Builder::default().invoke_handler(tauri::generate_handler![window_action,office_setup,engine_status,pending_adapters,decide_adapter,adapter_connections,revoke_adapter,open_verifier,open_verifier_browser,verifier_url,install_vscode,open_word,open_powerpoint,verify_image,embed_image,editor::editor_list,editor::editor_create,editor::editor_load,editor::editor_save,editor::editor_version,editor::editor_export]).setup(|app|{
        let open=MenuItem::with_id(app,"open","WorkProof · 状态与帮助",true,None::<&str>)?;
        let quit=MenuItem::with_id(app,"quit","退出 WorkProof",true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&open,&quit])?;
        TrayIconBuilder::new().icon(app.default_window_icon().expect("bundled icon").clone()).tooltip("WorkProof · 创作过程记录")
            .menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){
                "quit"=>{
                    if let Some(w)=app.get_webview_window("status"){
                        let _=w.unminimize();let _=w.show();let _=w.set_focus();
                        let _=app.emit_to("status","workproof-quit-requested",());
                    }else{app.exit(0);}
                },
                "open"=>{if let Some(w)=app.get_webview_window("status"){let _=w.unminimize();let _=w.show();let _=w.set_focus();}else{let _=tauri::WebviewWindowBuilder::new(app,"status",tauri::WebviewUrl::App("index.html".into())).title("WorkProof · 创作工作台").decorations(!cfg!(windows)).inner_size(960.,780.).min_inner_size(360.,520.).resizable(true).build();}},_=>{}
            }).build(app)?;
        if std::env::var_os("WORKPROOF_HEADLESS").is_none(){tauri::WebviewWindowBuilder::new(app,"status",tauri::WebviewUrl::App("index.html".into())).title("WorkProof · 创作工作台").decorations(!cfg!(windows)).inner_size(960.,780.).min_inner_size(360.,520.).resizable(true).build()?;}
        let handle=app.handle().clone();
        std::thread::spawn(move||{
            let rt=tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("runtime");
            if let Err(error)=rt.block_on(workproof_engine::run(43127)) {
                if let Ok(dir)=workproof_engine::data_dir(){let _=std::fs::create_dir_all(&dir);let _=std::fs::write(dir.join("startup-error.txt"),error.to_string());}handle.exit(1);
            }
        });Ok(())
    }).build(tauri::generate_context!()).expect("WorkProof desktop failed")
        .run(|app,event|{
            if let tauri::RunEvent::WindowEvent{label,event:tauri::WindowEvent::CloseRequested{api,..},..}=&event{
                if label=="status"&&!ALLOW_CLOSE.swap(false,std::sync::atomic::Ordering::AcqRel){api.prevent_close();let _=app.emit_to("status","workproof-close-requested",());}
            }
            // Destroy the last webview on close while retaining the tray collector.
            // Explicit menu exit and startup errors carry an exit code and remain effective.
            if let tauri::RunEvent::ExitRequested{api,code:None,..}=event {api.prevent_exit();}
        });
}

#[cfg(test)]
mod embedded_tests{
    use super::*;
    #[test]
    fn verifier_has_no_workbench_commands(){
        assert!(workbench_label("status").is_ok());
        for label in ["verifier","opened-window",""]{assert!(workbench_label(label).is_err());}
    }
    #[test]
    fn navigation_stays_on_exact_loopback_origin(){
        for value in ["http://127.0.0.1:4173/","http://127.0.0.1:4173/#verify"]{
            assert!(verifier_navigation(&value.parse().unwrap(),4173));
        }
        for value in ["https://example.com/","http://localhost:4173/","http://127.0.0.1:43127/","http://user@127.0.0.1:4173/","tauri://localhost/","blob:http://127.0.0.1:4173/id"]{
            assert!(!verifier_navigation(&value.parse().unwrap(),4173));
        }
    }
}
