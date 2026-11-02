//! Browser-only verification surface. No signer, filesystem or upload API is exported.
use wasm_bindgen::prelude::*;

/// A separately chosen CA is mandatory; no trust is inferred from embedded certificates.
#[wasm_bindgen]
pub async fn verify_embedded(asset:Vec<u8>,independent_ca_pem:String)->Result<String,JsValue>{
    workproof_c2pa::verify_embedded_async(&asset,&independent_ca_pem).await
        .map_err(|error|JsValue::from_str(&error.to_string()))
}
