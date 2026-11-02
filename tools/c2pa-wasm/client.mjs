/** Verify files entirely inside a disposable module worker. File bytes are never fetched/uploaded. */
export async function verifyEmbeddedFile(assetFile, independentCaFile, { signal, timeoutMs = 60_000, workerUrl } = {}) {
  if (!assetFile || !independentCaFile || assetFile.size > 96 * 1024 * 1024 ||
      independentCaFile.size > 256 * 1024 || !independentCaFile.size) throw new Error('INVALID_LOCAL_INPUT');
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = workerUrl ? new URL(workerUrl, location.href) : new URL('./worker.mjs', import.meta.url);
  if (url.origin !== location.origin) throw new Error('SAME_ORIGIN_VERIFIER_REQUIRED');
  const [asset, ca] = await Promise.all([assetFile.arrayBuffer(), independentCaFile.text()]);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const worker = new Worker(url, { type: 'module', name: 'workproof-local-c2pa' });
  return new Promise((resolve, reject) => {
    let timer, settled = false;
    const finish = (error, report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      error ? reject(error) : resolve(report);
    };
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error('VERIFICATION_TIMEOUT')), Number.isFinite(timeoutMs) ? Math.min(60_000, Math.max(1, timeoutMs)) : 60_000);
    worker.onerror = () => finish(new Error('VERIFIER_UNAVAILABLE'));
    worker.onmessageerror = () => finish(new Error('INVALID_VERIFIER_REPORT'));
    worker.onmessage = ({ data }) => {
      if (!data?.ok) return finish(new Error(data?.code || 'VERIFICATION_FAILED'));
      const report = data.report;
      const proof = report?.workproof;
      const formats = { 'image/png': 'original_png_checked', 'image/jpeg': 'original_jpeg_checked', 'application/pdf': 'original_pdf_checked' };
      const formatCheck = formats[report?.media_type];
      const coverage = proof?.scope === 'full'
        ? proof.chain_valid === true && (proof.merkle_valid === true || proof.merkle_valid === null) && proof.disclosed_events === proof.total_events
        : proof?.scope === 'selective' && proof.chain_valid === false && proof.merkle_valid === true;
      if (report?.protocol !== 'workproof-c2pa-report/1' || report.c2pa_integrity_valid !== true ||
          report.c2pa_trusted !== true || report.trust_policy !== 'explicit-ca-file' ||
          report.original_asset_checked !== true || report.workproof?.valid !== true ||
          !formatCheck || report[formatCheck] !== true ||
          Object.values(formats).some(field => field !== formatCheck && report[field] !== false) ||
          proof.file_match !== true || proof.signature_valid !== true || !coverage ||
          !Array.isArray(proof.errors) || proof.errors.length !== 0 ||
          !Number.isSafeInteger(proof.disclosed_events) || !Number.isSafeInteger(proof.total_events) ||
          proof.disclosed_events < 2 || proof.disclosed_events > proof.total_events ||
          report.network_used !== false || report.identity_verified !== false ||
          report.creation_time_verified !== false || report.revocation_checked !== false) {
        return finish(new Error('INVALID_VERIFIER_REPORT'));
      }
      finish(null, report);
    };
    try { worker.postMessage({ asset, ca }, [asset]); }
    catch { finish(new Error('INVALID_LOCAL_INPUT')); }
  });
}
