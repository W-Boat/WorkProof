use std::sync::Mutex;
use tauri::WebviewWindow;
#[cfg(windows)]
use tauri::Emitter;

static CLICKED_REQUEST:Mutex<Option<String>>=Mutex::new(None);

#[tauri::command]
pub fn take_pairing_notice(window:WebviewWindow)->Result<Option<String>,String>{
    super::workbench_only(&window)?;
    CLICKED_REQUEST.lock().map(|mut ticket|ticket.take()).map_err(|_|"连接申请暂不可用，请在应用连接中查看。".into())
}

#[cfg(windows)]
fn open_request(app:&tauri::AppHandle,ticket:&str){
    if let Ok(mut pending)=CLICKED_REQUEST.lock(){*pending=Some(ticket.to_owned());}
    // Preserve the current document/view; authorization is a modal overlay.
    super::restore_workbench(app,None,false);
    let _=app.emit_to("status","workproof-pairing-requested",());
}

pub fn start(app:tauri::AppHandle){
    #[cfg(windows)]
    windows_toasts::start(app);
    #[cfg(not(windows))]
    let _=app;
}

#[cfg(windows)]
mod windows_toasts{
    use std::{collections::{HashMap,HashSet},time::Duration};
    use windows::{core::HSTRING,Data::Xml::Dom::XmlDocument,Foundation::TypedEventHandler,UI::Notifications::{NotificationSetting,ToastNotification,ToastNotificationManager,ToastNotifier},Win32::System::WinRT::{RoInitialize,RO_INIT_MULTITHREADED}};

    fn label(source:&str)->&'static str{match source{"word"=>"Word","powerpoint"=>"PowerPoint","wps"=>"WPS","excel"=>"Excel","wps-presentation"=>"WPS 演示","wps-spreadsheets"=>"WPS 表格","vscode"=>"VS Code","photoshop"=>"Photoshop","blender"=>"Blender","krita"=>"Krita",_=>"应用"}}

    fn notify(notifier:&ToastNotifier,app:&tauri::AppHandle,ticket:&str,source:&str)->windows::core::Result<ToastNotification>{
        if notifier.Setting()?!=NotificationSetting::Enabled{return Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x80070005u32 as i32)));}
        let xml=XmlDocument::new()?;
        xml.LoadXml(&HSTRING::from(format!("<toast><visual><binding template='ToastGeneric'><text>{} 请求连接 WorkProof</text><text>点击查看来源并决定是否允许。未获允许前不会开始记录。</text></binding></visual><audio silent='true'/></toast>",label(source))))?;
        let toast=ToastNotification::CreateToastNotification(&xml)?;
        toast.SetGroup(&HSTRING::from("workproof-connections"))?;
        toast.SetTag(&HSTRING::from(ticket.get(..16).unwrap_or("connection")))?;
        let handle=app.clone();let selected=ticket.to_owned();
        let activated=TypedEventHandler::<ToastNotification,windows::core::IInspectable>::new(move|_,_|{super::open_request(&handle,&selected);Ok(())});
        toast.Activated(&activated)?;
        notifier.Show(&toast)?;Ok(toast)
    }

    pub fn start(app:tauri::AppHandle){
        std::thread::spawn(move||{
            let mut announced=HashSet::new();let mut active:HashMap<String,ToastNotification>=HashMap::new();
            let mut initialized=false;let mut notifier:Option<ToastNotifier>=None;
            loop{
                let pending=workproof_engine::pairing::pending();
                let live:HashSet<String>=pending.iter().map(|request|request.ticket.clone()).collect();
                announced.retain(|ticket|live.contains(ticket));
                active.retain(|ticket,toast|{if live.contains(ticket){true}else{if let Some(notifier)=&notifier{let _:windows::core::Result<()>=ToastNotifier::Hide(notifier,&*toast);}false}});
                for request in pending{
                    if !announced.insert(request.ticket.clone()){continue;}
                    // Load the Windows notification stack only on the first
                    // connection request, keeping the idle recorder lean.
                    if !initialized{let _=unsafe{RoInitialize(RO_INIT_MULTITHREADED)};initialized=true;}
                    if notifier.is_none(){notifier=ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("org.workproof.desktop")).ok();}
                    let shown=notifier.as_ref().and_then(|notifier|notify(notifier,&app,&request.ticket,&request.source).ok());
                    if let Some(toast)=shown{active.insert(request.ticket,toast);}else{
                        // An installed app can still be denied notification
                        // access. Show the same explicit consent dialog once.
                        super::open_request(&app,&request.ticket);
                    }
                }
                std::thread::sleep(Duration::from_millis(1500));
            }
        });
    }
}
