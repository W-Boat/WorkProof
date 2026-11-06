fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "window_action","office_setup","engine_status","pending_adapters","decide_adapter",
            "adapter_connections","revoke_adapter","open_verifier","open_verifier_browser","verifier_url",
            "install_vscode","open_word","open_powerpoint","verify_image","embed_image",
            "editor_list","editor_create","editor_load","editor_save","editor_version","editor_export",
            "external_documents_list","external_document_load","external_document_open",
            "external_document_locate",
        ])
    )).expect("WorkProof build permissions failed");
}
