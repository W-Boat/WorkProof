// Actual Chromium module-worker/Wasm acceptance against fresh native-signed fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
const root = __dirname;
const imageDir = path.resolve(process.argv[2]);
const pdfDir = path.resolve(process.argv[3]);
function checkFixtures(folder) {
  const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'VALIDATION.json')));
  assert.equal(metadata.source_commit, process.env.GITHUB_SHA);
  assert.equal(metadata.build_run, process.env.GITHUB_RUN_ID);
  assert.equal(metadata.private_keys_included, false);
  const sums = fs.readFileSync(path.join(folder, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  const names = new Set(['SHA256SUMS.txt']);
  for (const line of sums) {
    const [_, digest, name] = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line) || [];
    assert(digest && name && !names.has(name)); names.add(name);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex'), digest);
  }
  assert.deepEqual([...names].sort(), fs.readdirSync(folder).sort());
  assert.deepEqual(metadata.files.slice().sort(), [...names].filter(n => !['VALIDATION.json', 'SHA256SUMS.txt'].includes(n)).sort());
  assert([...names].every(n => !/\.key$|\.csr$|\.wproof$/i.test(n)));
}
checkFixtures(imageDir); checkFixtures(pdfDir);
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url.includes('?')) { res.writeHead(405).end(); return; }
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'");
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<input id="asset" type="file"><input id="ca" type="file"><script type="module" src="/harness.mjs"></script>');return;
  }
  if (req.url === '/harness.mjs') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end("import {verifyEmbeddedFile} from './client.mjs'; window.verifyLocal=verifyEmbeddedFile; window.ready=true;");return;
  }
  const relative = req.url.slice(1);
  if (!['client.mjs', 'worker.mjs', 'pkg/workproof_c2pa_wasm.js', 'pkg/workproof_c2pa_wasm_bg.wasm'].includes(relative)) {
    res.writeHead(404).end();return;
  }
  res.setHeader('Content-Type', relative.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
  res.end(fs.readFileSync(path.join(root, relative)));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({serviceWorkers: 'block'});
    const requests = [];
    await context.route('**/*', async route => {
      const req=route.request();requests.push({url:req.url(),method:req.method()});
      if (!req.url().startsWith(origin + '/') || req.method() !== 'GET' || req.url().includes('?')) return route.abort();
      return route.continue();
    });
    const page=await context.newPage();
    await page.addInitScript(() => {
      const NativeWorker=window.Worker;
      window.workerCounts={started:0,terminated:0};
      window.Worker=class extends NativeWorker {
        constructor(...args){super(...args);window.workerCounts.started++;queueMicrotask(()=>window.cancelOnWorkerStart?.());}
        terminate(){window.workerCounts.terminated++;super.terminate();}
      };
    });
    await page.goto(origin);await page.waitForFunction(()=>window.ready);
    async function verify(folder,asset,ca='synthetic-ca.pem',mode='normal') {
      await page.locator('#asset').setInputFiles(path.join(folder,asset));
      await page.locator('#ca').setInputFiles(path.join(folder,ca));
      return page.evaluate(async mode => {
        const controller=new AbortController();
        if(mode==='cancel')window.cancelOnWorkerStart=()=>controller.abort();
        const before={...window.workerCounts};
        try {
          const ca=mode==='no-ca'?new File([],'empty.pem'):document.querySelector('#ca').files[0];
          const report=await window.verifyLocal(document.querySelector('#asset').files[0],ca,{signal:controller.signal,timeoutMs:mode==='timeout'?1:60_000});
          return {ok:true,report,before,after:{...window.workerCounts}};
        }catch(error){return {ok:false,code:error.message,name:error.name,before,after:{...window.workerCounts}};}
        finally{window.cancelOnWorkerStart=null;}
      },mode);
    }
    const evidence=[];
    for(const [folder,file,scope] of [[imageDir,'full.png','full'],[imageDir,'selected.png','selective'],
      [imageDir,'baseline.jpg','full'],[imageDir,'baseline-selected.jpg','selective'],[imageDir,'progressive.jpg','full'],
      [imageDir,'progressive-selected.jpg','selective'],[pdfDir,'full.pdf','full'],[pdfDir,'selected.pdf','selective']]) {
      const actual=await verify(folder,file);assert.equal(actual.ok,true,JSON.stringify(actual));
      assert.equal(actual.report.workproof.scope,scope);assert.equal(actual.after.terminated,actual.before.terminated+1);
      evidence.push({file,scope,media_type:actual.report.media_type,explicit_ca:true});
    }
    for(const [folder,file,ca] of [[imageDir,'full.png','wrong-ca.pem'],[imageDir,'baseline.jpg','wrong-ca.pem'],[pdfDir,'full.pdf','wrong-ca.pem'],
      [imageDir,'unsigned.png'],[imageDir,'changed.png'],[imageDir,'assertion-changed.png'],[imageDir,'changed.jpg'],
      [pdfDir,'unsigned.pdf'],[pdfDir,'changed.pdf'],[pdfDir,'extra.pdf'],[pdfDir,'encrypted.pdf']]) {
      const actual=await verify(folder,file,ca);assert.equal(actual.ok,false,file);assert.equal(actual.after.terminated,actual.before.terminated+1);
    }
    const missing=await verify(imageDir,'full.png','synthetic-ca.pem','no-ca');assert.equal(missing.ok,false);assert.equal(missing.code,'INVALID_LOCAL_INPUT');
    const cancelled=await verify(imageDir,'full.png','synthetic-ca.pem','cancel');assert.equal(cancelled.name,'AbortError');
    assert.equal(cancelled.after.started,cancelled.before.started+1);assert.equal(cancelled.after.terminated,cancelled.before.terminated+1);
    const timed=await verify(imageDir,'full.png','synthetic-ca.pem','timeout');assert.equal(timed.code,'VERIFICATION_TIMEOUT');
    assert.equal(timed.after.terminated,timed.before.terminated+1);
    assert(requests.length>0);
    for(const req of requests){assert.equal(req.method,'GET');assert(req.url.startsWith(origin+'/'));assert(!req.url.includes('?'));
      assert(['/', '/harness.mjs','/client.mjs','/worker.mjs','/pkg/workproof_c2pa_wasm.js','/pkg/workproof_c2pa_wasm_bg.wasm'].includes(new URL(req.url).pathname));}
    fs.writeFileSync('test-c2pa-wasm-results.json',JSON.stringify({source_commit:process.env.GITHUB_SHA,build_run:process.env.GITHUB_RUN_ID,
      runtime:'Chromium module worker / actual c2pa-rs Wasm',accepted:evidence,negative_cases:11,explicit_ca_required:true,
      actual_worker_cancellation:true,actual_worker_timeout:true,requests_get_local_resources_only:true,asset_upload_requests:0},null,2));
    console.log('PASS real browser SDK Wasm: PNG/JPEG/PDF full/selective, explicit CA, wrong roots/tampering/unsigned/encrypted rejection, worker cancellation/timeout, no asset upload or external request');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
