#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{menu::{Menu,MenuItem},tray::TrayIconBuilder,Manager};
mod platform;
mod c2pa;
#[tauri::command]
async fn embed_image(app:tauri::AppHandle,consent:bool)->Result<serde_json::Value,String>{
    if !consent{return Err("请先同意公开所选证书中的过程信息。".into());}
    let resource=app.path().resource_dir().map_err(|_|"无法定位安装资源。".to_string())?;
    tauri::async_runtime::spawn_blocking(move||c2pa::embed(resource,consent)).await.map_err(|_|"图片封装未能完成，请检查输出位置后重试。".to_string())?
}
#[tauri::command]
async fn verify_image(app:tauri::AppHandle)->Result<serde_json::Value,String>{
    let resource=app.path().resource_dir().map_err(|_|"无法定位安装资源。".to_string())?;
    tauri::async_runtime::spawn_blocking(move||c2pa::verify(resource)).await.map_err(|_|"图片核验未能完成，请重试。".to_string())?
}
#[tauri::command]
async fn open_powerpoint()->Result<String,String>{
    tauri::async_runtime::spawn_blocking(platform::open_powerpoint).await.map_err(|e|e.to_string())??;
    Ok("已向 PowerPoint 发出开始请求。首次连接请在此允许 PowerPoint；请以其侧栏的记录状态为准。".into())
}
#[tauri::command]
async fn open_word()->Result<String,String>{
    tauri::async_runtime::spawn_blocking(platform::open_word).await.map_err(|e|e.to_string())??;
    Ok("已向 Word 发出开始请求。首次连接请在此允许 Word；记录成功后，Word 会显示确认提示。".into())
}
#[tauri::command]
fn engine_status()->Result<workproof_engine::EngineSnapshot,String>{workproof_engine::snapshot()}
#[tauri::command]
fn pending_adapters()->Vec<workproof_engine::pairing::Pending>{workproof_engine::pairing::pending()}
#[tauri::command]
fn decide_adapter(ticket:String,approve:bool)->Result<(),String>{workproof_engine::pairing::decide(&ticket,approve)}
#[tauri::command]
fn adapter_connections()->Vec<workproof_engine::pairing::Connection>{workproof_engine::pairing::connections()}
#[tauri::command]
fn revoke_adapter(ticket:String)->Result<(),String>{workproof_engine::pairing::revoke(&ticket)}
#[tauri::command]
async fn open_verifier(app:tauri::AppHandle)->Result<(),String>{
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
    tauri::async_runtime::spawn_blocking(move||platform::open_verifier(p)).await.map_err(|e|e.to_string())??;
    Ok(())
}
#[tauri::command]
async fn install_vscode(app:tauri::AppHandle)->Result<String,String>{
    let vsix=app.path().resource_dir().map_err(|e|e.to_string())?.join("workproof.vsix");
    if !vsix.is_file(){return Err("插件资源缺失，请重新安装完整安装包。".into());}
    tauri::async_runtime::spawn_blocking(move||platform::install_vscode(&vsix)).await.map_err(|e|e.to_string())??;
    Ok("插件安装完成。在 VS Code 状态栏点击 WorkProof 即可开始记录。".into())
}
fn main(){
    tauri::Builder::default().invoke_handler(tauri::generate_handler![engine_status,pending_adapters,decide_adapter,adapter_connections,revoke_adapter,open_verifier,install_vscode,open_word,open_powerpoint,verify_image,embed_image]).setup(|app|{
        let open=MenuItem::with_id(app,"open","WorkProof · 状态与帮助",true,None::<&str>)?;
        let quit=MenuItem::with_id(app,"quit","退出 WorkProof",true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&open,&quit])?;
        TrayIconBuilder::new().icon(app.default_window_icon().expect("bundled icon").clone()).tooltip("WorkProof · 创作过程记录")
            .menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){
                "quit"=>app.exit(0),
                "open"=>{if let Some(w)=app.get_webview_window("status"){let _=w.set_focus();}else{let _=tauri::WebviewWindowBuilder::new(app,"status",tauri::WebviewUrl::App("index.html".into())).title("WorkProof · 创作工作台").inner_size(420.,600.).resizable(false).build();}},_=>{}
            }).build(app)?;
        if std::env::var_os("WORKPROOF_HEADLESS").is_none(){tauri::WebviewWindowBuilder::new(app,"status",tauri::WebviewUrl::App("index.html".into())).title("WorkProof · 创作工作台").inner_size(420.,600.).resizable(false).build()?;}
        let handle=app.handle().clone();
        std::thread::spawn(move||{
            let rt=tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("runtime");
            if let Err(error)=rt.block_on(workproof_engine::run(43127)) {
                if let Ok(dir)=workproof_engine::data_dir(){let _=std::fs::create_dir_all(&dir);let _=std::fs::write(dir.join("startup-error.txt"),error.to_string());}handle.exit(1);
            }
        });Ok(())
    }).build(tauri::generate_context!()).expect("WorkProof desktop failed")
        .run(|_app,event|{
            // Destroy the last webview on close while retaining the tray collector.
            // Explicit menu exit and startup errors carry an exit code and remain effective.
            if let tauri::RunEvent::ExitRequested{api,code:None,..}=event {api.prevent_exit();}
        });
}
