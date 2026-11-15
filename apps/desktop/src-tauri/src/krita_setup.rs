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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_bundled_plugin_and_preserves_a_different_existing_version() {
        let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("workproof-krita-{}-{id}", std::process::id()));
        fs::create_dir(&root).unwrap();
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
        }
        let fixture = Fixture(root);
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/adapters/krita");
        let destination = fixture.0.join("pykrita");
        install_files(&source, &destination).unwrap();
        install_files(&source, &destination).unwrap();
        for name in FILES {
            assert_eq!(fs::read(source.join(name)).unwrap(), fs::read(destination.join(name)).unwrap());
        }
        let conflicting = destination.join("workproof/core.py");
        let missing = destination.join("workproof/Manual.html");
        fs::write(&conflicting, b"different plugin version").unwrap();
        fs::remove_file(&missing).unwrap();
        assert!(install_files(&source, &destination).is_err());
        assert_eq!(fs::read(conflicting).unwrap(), b"different plugin version");
        assert!(!missing.exists());
        fs::copy(source.join("workproof/core.py"), destination.join("workproof/core.py")).unwrap();
        install_files(&source, &destination).unwrap();
        assert!(missing.is_file());
    }
}
