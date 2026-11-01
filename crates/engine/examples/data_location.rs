fn main(){match workproof_engine::data_dir(){Ok(path)=>println!("{}",path.display()),Err(error)=>{eprintln!("{error}");std::process::exit(2);}}}
