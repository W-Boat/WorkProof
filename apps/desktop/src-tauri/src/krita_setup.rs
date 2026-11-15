use std::{fs, io::{ErrorKind, Write}, path::{Path, PathBuf}};

const FILES: &[&str] = &[
    "workproof/__init__.py", "workproof/core.py", "workproof/docker.py",
    "workproof/qt_compat.py", "workproof/Manual.html", "workproof/COPYING",
    "workproof/README.md", "workproof.desktop",
];

pub fn install(source: &Path) -> Result<String, String> {
    let directory = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|path| PathBuf::from(path).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME").filter(|path| Path::new(path).is_absolute()).map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|path| PathBuf::from(path).join(".local/share")))
    };
    let directory = directory.filter(|path| path.is_absolute()).ok_or("无法定位当前用户的 Krita 数据目录。")?;
    install_files(source, &directory.join("krita/pykrita"))?;
    Ok("插件文件已就绪。打开 Krita，在「配置 Krita → Python 插件管理器」启用 WorkProof，然后重启 Krita。".into())
}

fn install_files(source: &Path, destination: &Path) -> Result<(), String> {
    let mut missing = Vec::new();
    for name in FILES {
        let bytes = fs::read(source.join(name)).map_err(|_| "安装包缺少 Krita 插件文件。")?;
        let target = destination.join(name);
        match fs::read(&target) {
            Ok(existing) if existing == bytes => {}
            Ok(_) => return Err("检测到不同版本的 WorkProof 插件。请先在 Krita 中移除旧插件，再重试。".into()),
            Err(error) if error.kind() == ErrorKind::NotFound => missing.push((target, bytes)),
            Err(_) => return Err("无法检查 Krita 插件目录。".into()),
        }
    }
    let mut created = Vec::new();
    for (target, bytes) in missing {
        let result = (|| -> std::io::Result<()> {
            fs::create_dir_all(target.parent().expect("fixed relative plugin file"))?;
            let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&target)?;
            created.push(target);
            file.write_all(&bytes)?;
            file.sync_all()
        })();
        if result.is_err() {
            for file in created.iter().rev() { let _ = fs::remove_file(file); }
            return Err("无法完整写入 Krita 插件。请检查当前用户目录的写入权限后重试。".into());
        }
    }
    Ok(())
}
