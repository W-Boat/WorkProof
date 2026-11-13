fn main() {
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    println!("cargo:rerun-if-env-changed=GITHUB_RUN_NUMBER");
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");
    let source=std::env::var("GITHUB_SHA").ok().filter(|value|value.len()==40&&value.bytes().all(|byte|byte.is_ascii_hexdigit())).unwrap_or_else(||"development".into());
    let number=std::env::var("GITHUB_RUN_NUMBER").ok().filter(|value|!value.is_empty()&&value.bytes().all(|byte|byte.is_ascii_digit())).unwrap_or_else(||"local".into());
    let epoch=std::env::var("SOURCE_DATE_EPOCH").ok().and_then(|value|value.parse::<u64>().ok()).unwrap_or_else(||std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("Build clock must be after Unix epoch").as_secs());
    println!("cargo:rustc-env=WORKPROOF_BUILD_SOURCE={source}");
    println!("cargo:rustc-env=WORKPROOF_BUILD_NUMBER={number}");
    println!("cargo:rustc-env=WORKPROOF_BUILD_EPOCH={epoch}");
    println!("cargo:warning=WorkProof build source={source} number={number} epoch={epoch}");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "window_action","office_setup","engine_status","app_info","pending_adapters","take_pairing_notice","decide_adapter","save_report","save_certificate",
            "adapter_connections","revoke_adapter","open_verifier","open_verifier_browser","verifier_url",
            "install_vscode","open_word","open_powerpoint","verify_image","embed_image",
            "recording_limit","set_recording_limit","editor_list","editor_create","editor_load","editor_save","editor_version","editor_history","editor_replay_frame","editor_export",
            "external_documents_list","external_document_load","external_document_open",
            "external_document_locate","external_document_read","library_states","library_set_state","library_delete",
        ])
    )).expect("WorkProof build permissions failed");
}
