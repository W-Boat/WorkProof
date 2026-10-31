#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{menu::{Menu,MenuItem},tray::TrayIconBuilder,Manager};
fn main(){
    tauri::Builder::default().setup(|app|{
        let open=MenuItem::with_id(app,"open","WorkProof · 状态与帮助",true,None::<&str>)?;
        let quit=MenuItem::with_id(app,"quit","退出记录引擎",true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&open,&quit])?;
        let mut pixels=vec![0u8;32*32*4];
        for y in 5..27 {for x in 5..27 {let i=(y*32+x)*4;pixels[i]=90;pixels[i+1]=205;pixels[i+2]=160;pixels[i+3]=255;}}
        TrayIconBuilder::new().icon(tauri::image::Image::new_owned(pixels,32,32)).tooltip("WorkProof · 本地记录引擎")
            .menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){
                "quit"=>app.exit(0),
                "open"=>{if let Some(w)=app.get_webview_window("status"){let _=w.set_focus();}else{let _=tauri::WebviewWindowBuilder::new(app,"status",tauri::WebviewUrl::App("index.html".into())).title("WorkProof").inner_size(380.,460.).resizable(false).build();}},_=>{}
            }).build(app)?;
        let handle=app.handle().clone();
        std::thread::spawn(move||{
            let rt=tokio::runtime::Runtime::new().expect("runtime");
            if let Err(error)=rt.block_on(workproof_engine::run(43127)) {
                let dir=workproof_engine::data_dir();let _=std::fs::create_dir_all(&dir);let _=std::fs::write(dir.join("startup-error.txt"),error.to_string());handle.exit(1);
            }
        });Ok(())
    }).run(tauri::generate_context!()).expect("WorkProof desktop failed");
}
