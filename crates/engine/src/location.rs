use std::{ffi::OsString,path::PathBuf};

pub fn resolve(platform:&str,get:impl Fn(&str)->Option<OsString>)->Result<PathBuf,String>{
    let value=|name:&str|get(name).filter(|v|!v.is_empty()).map(PathBuf::from);
    if let Some(dir)=value("WORKPROOF_DATA_DIR"){
        return if dir.is_absolute(){Ok(dir)}else{Err("WORKPROOF_DATA_DIR must be an absolute path".into())};
    }
    let home=||value("HOME").filter(|p|p.is_absolute()).or_else(||value("USERPROFILE").filter(|p|p.is_absolute())).ok_or("Cannot find a home directory; configure WORKPROOF_DATA_DIR".to_string());
    match platform{
        "windows"=>{let base=if let Some(p)=value("LOCALAPPDATA").filter(|p|p.is_absolute()){p}else{home()?.join("AppData/Local")};Ok(base.join("WorkProof"))},
        "macos"=>Ok(home()?.join("Library/Application Support/WorkProof")),
        _=>{let base=if let Some(p)=value("XDG_DATA_HOME").filter(|p|p.is_absolute()){p}else{home()?.join(".local/share")};Ok(base.join("WorkProof"))},
    }
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn missing_home_does_not_write_into_working_directory(){assert!(resolve(std::env::consts::OS,|_|None).is_err());}
    #[test]fn relative_override_is_rejected(){assert!(resolve(std::env::consts::OS,|key|(key=="WORKPROOF_DATA_DIR").then(||"relative".into())).is_err());}
}
