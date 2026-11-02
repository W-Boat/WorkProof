import init, { verify_embedded } from './pkg/workproof_c2pa_wasm.js';

let busy = false;
const ready = init({ module_or_path: new URL('./pkg/workproof_c2pa_wasm_bg.wasm', import.meta.url) });

self.onmessage = async ({ data }) => {
  if (busy) return self.postMessage({ ok: false, code: 'VERIFIER_BUSY' });
  busy = true;
  try {
    if (!data || !(data.asset instanceof ArrayBuffer) || data.asset.byteLength > 96 * 1024 * 1024 ||
        typeof data.ca !== 'string' || !data.ca || new TextEncoder().encode(data.ca).byteLength > 256 * 1024) {
      throw new Error('INVALID_LOCAL_INPUT');
    }
    await ready;
    const report = JSON.parse(await verify_embedded(new Uint8Array(data.asset), data.ca));
    self.postMessage({ ok: true, report });
  } catch (error) {
    // Rust returns fixed diagnostic codes, never assertions, records, names or keys.
    const code = String(error?.message || error || 'VERIFICATION_FAILED');
    self.postMessage({ ok: false, code: /^[A-Z][A-Z0-9_]{0,100}$/.test(code) ? code : 'VERIFICATION_FAILED' });
  }
};
