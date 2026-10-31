#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{menu::{Menu,MenuItem},tray::TrayIconBuilder,Manager};
#[tauri::command]
fn engine_status()->Result<workproof_engine::EngineSnapshot,String>{workproof_engine::snapshot()}
#[tauri::command]
async fn open_verifier(app:tauri::AppHandle)->Result<(),String>{
    let dir=app.path().resource_dir().map_err(|e|e.to_string())?.join("verifier");
    if !dir.join("index.html").is_file(){return Err("核验资源不完整，请使用完整安装包重新安装。".into());}
    static SERVER:std::sync::OnceLock<tokio::sync::Mutex<Option<u16>>>=std::sync::OnceLock::new();
    let mut port=SERVER.get_or_init(||tokio::sync::Mutex::new(None)).lock().await;
    let p=if let Some(p)=*port{p}else{
        let listener=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).await.map_err(|e|e.to_string())?;
        let p=listener.local_addr().map_err(|e|e.to_string())?.port();
        tauri::async_runtime::spawn(async move{let router=axum::Router::new().fallback_service(tower_http::services::ServeDir::new(dir));let _=axum::serve(listener,router).await;});
        *port=Some(p);p
    };
    #[cfg(windows)]
    std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler",&format!("http://127.0.0.1:{p}")]).spawn().map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn install_vscode(app:tauri::AppHandle)->Result<String,String>{
    let vsix=app.path().resource_dir().map_err(|e|e.to_string())?.join("workproof.vsix");
    if !vsix.is_file(){return Err("插件资源缺失，请重新安装完整安装包。".into());}
    let output=tauri::async_runtime::spawn_blocking(move||std::process::Command::new("code.cmd").arg("--install-extension").arg(vsix).arg("--force").output()).await.map_err(|e|e.to_string())?.map_err(|_|"没有找到 VS Code。请安装 VS Code 后重新打开 WorkProof。".to_string())?;
    if !output.status.success(){return Err("VS Code 插件安装失败。请关闭其他安装任务后重试。".into());}
    Ok("插件安装完成。在 VS Code 状态栏点击 WorkProof 即可开始记录。".into())
}
fn main(){
    tauri::Builder::default().invoke_handler(tauri::generate_handler![engine_status,open_verifier,install_vscode]).setup(|app|{
        let open=MenuItem::with_id(app,"open","WorkProof · 状态与帮助",true,None::<&str>)?;
        let quit=MenuItem::with_id(app,"quit","退出记录引擎",true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&open,&quit])?;
        TrayIconBuilder::new().icon(app.default_window_icon().expect("bundled icon").clone()).tooltip("WorkProof · 本地记录引擎")
            .menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){
                "quit"=>app.exit(0),
                "open"=>{if let Some(w)=app.get_webview_window("status"){let _=w.set_focus();}else{let _=tauri::WebviewWindowBuilder::new(app,"status",tauri::WebviewUrl::App("index.html".into())).title("WorkProof").inner_size(380.,460.).resizable(false).build();}},_=>{}
            }).build(app)?;
        if std::env::var_os("WORKPROOF_HEADLESS").is_none(){tauri::WebviewWindowBuilder::new(app,"status",tauri::WebviewUrl::App("index.html".into())).title("WorkProof · 创作工作台").inner_size(420.,600.).resizable(false).build()?;}
        let handle=app.handle().clone();
        std::thread::spawn(move||{
            let rt=tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("runtime");
            if let Err(error)=rt.block_on(workproof_engine::run(43127)) {
                let dir=workproof_engine::data_dir();let _=std::fs::create_dir_all(&dir);let _=std::fs::write(dir.join("startup-error.txt"),error.to_string());handle.exit(1);
            }
        });Ok(())
    }).build(tauri::generate_context!()).expect("WorkProof desktop failed")
        .run(|_app,event|{
            // Destroy the last webview on close while retaining the tray collector.
            // Explicit menu exit and startup errors carry an exit code and remain effective.
            if let tauri::RunEvent::ExitRequested{api,code:None,..}=event {api.prevent_exit();}
        });
}
