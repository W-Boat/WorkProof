// Real bundled Vue + authenticated Java + Rust. Only the uploaded example is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium,expect}=require('@playwright/test');
(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.DB_NAME,'workproof_ci');
  const origin=process.env.WORKPROOF_TEST_ORIGIN,token=process.env.WORKPROOF_TEST_TOKEN;
  assert.equal(origin,'http://127.0.0.1:18089');assert(token);
  const response=await fetch(origin+'/api/auth/me',{headers:{Authorization:'Bearer '+token}});const user=(await response.json()).data;assert(user);
  const browser=await chromium.launch({headless:true});let page;
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    await context.addInitScript(({token,user,origin})=>{
      if(location.origin!==origin)return;
      localStorage.setItem('scaffold.token',token);localStorage.setItem('scaffold.user',JSON.stringify(user));localStorage.setItem('scaffold.expiresAt',String(Date.now()+3600000));
      // Chromium omits file-backed Blob bytes from Playwright's request.postDataBuffer().
      // Observe the actual fetch body without replacing it or mocking the real service.
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,options)=>{
        if(new URL(String(input),location.href).pathname==='/api/workproof/certificates/inspect'&&options?.method==='POST'){
          if(!(options.body instanceof Blob))throw new Error('Certificate upload must preserve the original Blob');
          const bytes=await options.body.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
          window.__workproofTestUpload={bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
        }
        return originalFetch(input,options);
      };
    },{token,user,origin});
    page=await context.newPage();let inspections=0;
    page.on('request',request=>{if(new URL(request.url()).pathname==='/api/workproof/certificates/inspect'&&request.method()==='POST')inspections++;});
    await page.goto(origin+'/');
    // Exercise the actual bundled Vue -> authenticated Java -> Rust receipt path.
    await page.getByRole('button',{name:'签发接收回执',exact:true}).click();
    const receiptDialog=page.getByRole('dialog',{name:'签发机构接收回执',exact:true});
    const receiptSubmit=receiptDialog.getByRole('button',{name:'发送并签发回执',exact:true});
    const receiptFixture=path.resolve('apps/verifier/public/demo/essay.md.wproof');
    await expect(receiptSubmit).toBeDisabled();
    await receiptDialog.getByLabel('选择 .wproof 证书').setInputFiles(receiptFixture);
    await expect(receiptSubmit).toBeDisabled();
    await receiptDialog.getByText('我同意将所选证书发送给机构服务器签发接收回执',{exact:true}).click();
    await expect(receiptSubmit).toBeEnabled();await receiptSubmit.click();
    await expect(receiptDialog.getByText('已收到接收回执',{exact:true})).toBeVisible();
    await expect(receiptDialog).toContainText('ci-institution');
    await expect(receiptSubmit).toBeDisabled();
    const receiptDownload=page.waitForEvent('download');
    await receiptDialog.getByRole('button',{name:'下载接收回执',exact:true}).click();
    const receiptFile=await receiptDownload;
    assert.equal(receiptFile.suggestedFilename(),'workproof-server-receipt.json');
    const downloadedPath=await receiptFile.path();
    const checked=require('node:child_process').spawnSync(path.resolve('target/release/workproof-receipt'),
      ['verify',receiptFixture,downloadedPath,'ci-institution','60',process.env.WORKPROOF_TEST_RECEIPT_PUBLIC_KEY],{encoding:'utf8',timeout:15000});
    assert.equal(checked.status,0,checked.stderr);
    const receiptReport=JSON.parse(checked.stdout);assert.equal(receiptReport.receipt_verified,true);assert.equal(receiptReport.client_origin_verified,false);
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Receipt dialog must fit mobile width');
    await page.screenshot({path:'test-results/institution-receipt-mobile.png',fullPage:true});
    await receiptDialog.getByLabel('选择 .wproof 证书').setInputFiles(receiptFixture);
    await expect(receiptDialog.getByText('已收到接收回执',{exact:true})).toHaveCount(0);
    await expect(receiptSubmit).toBeDisabled();
    await receiptDialog.getByRole('button',{name:'关闭',exact:true}).click();
    await page.setViewportSize({width:1280,height:900});
    await page.getByRole('button',{name:'检查一份证书',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'检查一份证书',exact:true});await expect(dialog).toBeVisible();
    const submit=dialog.getByRole('button',{name:'检查证书内容',exact:true}),consent=dialog.getByRole('checkbox',{name:'我同意将所选证书发送给机构服务器检查'});
    await expect(submit).toBeDisabled();await expect(dialog.getByText('下一步：选择一份证书。',{exact:true})).toBeVisible();
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles({name:'other.json',mimeType:'application/json',buffer:Buffer.from('{"not":"a certificate"}')});await expect(dialog.getByText('请选择 .wproof 证书文件，其他文件不会发送。',{exact:true})).toBeVisible();assert.equal(inspections,0);
    const fixture=path.resolve('apps/verifier/public/demo/essay.md.wproof'),bytes=fs.readFileSync(fixture),proof=JSON.parse(bytes);
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles(fixture);await expect(submit).toBeDisabled();await expect(dialog.getByText('下一步：阅读上方说明，确认同意后勾选，再点击“检查证书内容”。',{exact:true})).toBeVisible();assert.equal(inspections,0);
    await dialog.getByText('我同意将所选证书发送给机构服务器检查', {exact:true}).click();await expect(consent).toBeChecked();await expect(submit).toBeEnabled();await consent.focus();await page.keyboard.press('Space');await expect(consent).not.toBeChecked();await expect(submit).toBeDisabled();await page.keyboard.press('Space');await expect(consent).toBeChecked();await submit.click();
    await expect(dialog.getByText('证书内容一致',{exact:true})).toBeVisible();assert.equal(inspections,1);
    await expect(dialog.getByText('请向提供者索取原始 .wproof 文件，并确认它没有被修改。',{exact:true})).toHaveCount(0);
    const uploaded=await page.evaluate(()=>window.__workproofTestUpload);
    assert.deepEqual(uploaded,{bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},'Fetch must send the original certificate Blob');
    const fingerprint=crypto.createHash('sha256').update(Buffer.from(proof.signature,'hex')).digest('hex');
    await expect(dialog.getByText(fingerprint,{exact:true})).toBeVisible();await expect(dialog.getByText('作品仍需在本机单独检查。这里没有确认作者身份，也没有确认实际创作时间。',{exact:true})).toBeVisible();
    fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/institution-certificate-inspection-full.png',fullPage:true});
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles(path.resolve('test-institution-selected.wproof'));await expect(submit).toBeDisabled();
    await dialog.getByText('我同意将所选证书发送给机构服务器检查', {exact:true}).click();await expect(consent).toBeChecked();await submit.click();await expect(dialog.getByText('只检查本次分享的记录',{exact:false})).toBeVisible();await expect(dialog.getByText('未检查全部过程记录，不能据此判断未分享的过程。',{exact:true})).toBeVisible();await expect(dialog.getByText(fingerprint,{exact:true})).toBeVisible();
    // Real Java -> Rust inspection, not a mocked actions response. The fixture
    // carries deterministic signed counts and explicitly declares demo status.
    const actionFixture=path.resolve('apps/verifier/public/demo/actions-demo.txt.wproof');
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles(actionFixture);
    await dialog.getByText('我同意将所选证书发送给机构服务器检查',{exact:true}).click();await submit.click();
    const actionRegion=dialog.getByRole('region',{name:'已披露记录的动作统计'});
    await expect(actionRegion).toContainText('退格');await expect(actionRegion).toContainText('3 次');
    await expect(actionRegion).toContainText('格式变化');await expect(actionRegion).toContainText('版式变化');
    await expect(actionRegion).toContainText('键盘指令不代表执行成功');
    await page.screenshot({path:'test-results/institution-certificate-inspection-actions.png',fullPage:true});
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles(path.resolve('apps/verifier/public/demo/actions-demo.selected.wproof'));
    await dialog.getByText('我同意将所选证书发送给机构服务器检查',{exact:true}).click();await submit.click();
    await expect(actionRegion).toContainText('版式变化');
    await expect(actionRegion.getByText('格式变化',{exact:true})).toHaveCount(0);
    const changedActions=JSON.parse(fs.readFileSync(actionFixture,'utf8'));
    changedActions.records[1].event.metrics.copy=999;
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles({name:'changed-actions.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changedActions))});
    await dialog.getByText('我同意将所选证书发送给机构服务器检查',{exact:true}).click();await submit.click();
    await expect(dialog.getByText('证书内容未能确认',{exact:true})).toBeVisible();
    await expect(actionRegion).toHaveCount(0);
    proof.records[1].event.inserted++;
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles({name:'changed.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(proof))});await dialog.getByText('我同意将所选证书发送给机构服务器检查', {exact:true}).click();await expect(consent).toBeChecked();await submit.click();await expect(dialog.getByText('证书内容未能确认',{exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile modal must not overflow');await page.screenshot({path:'test-results/institution-certificate-inspection-mobile.png',fullPage:true});
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/workproof/certificates');
    await expect(page.getByRole('heading',{name:'证书管理',exact:true})).toBeVisible();
    await expect(page.getByText('essay.md',{exact:true}).first()).toBeVisible();
    await page.getByRole('button',{name:'查看详情',exact:true}).first().click();
    const details=page.getByRole('dialog',{name:'证书摘要详情',exact:true});await expect(details).toBeVisible();
    await expect(details.getByText(fingerprint,{exact:true})).toBeVisible();
    await details.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByLabel('文件名或证书指纹').fill('not-present');await page.getByRole('button',{name:'查询',exact:true}).click();
    await expect(page.getByText('essay.md',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'重置',exact:true}).click();await expect(page.getByText('essay.md',{exact:true}).first()).toBeVisible();
    const csv=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前查询结果',exact:true}).click();
    assert((await csv).suggestedFilename().endsWith('.csv'));
    await page.screenshot({path:'test-results/institution-certificate-catalog.png',fullPage:true});
    await page.getByRole('button',{name:'批量检查',exact:true}).click();
    const batch=page.getByRole('dialog',{name:'批量检查并保存摘要',exact:true});
    const batchStart=batch.getByRole('button',{name:'开始批量检查',exact:true});
    await batch.getByLabel('选择多份 .wproof 证书').setInputFiles([
      {name:'valid.wproof',mimeType:'application/json',buffer:bytes},
      {name:'changed.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(proof))},
      {name:'valid-again.wproof',mimeType:'application/json',buffer:bytes},
    ]);
    await expect(batchStart).toBeDisabled();
    await batch.getByText('我同意发送这一批证书，并保存检查通过的摘要',{exact:true}).click();await batchStart.click();
    await expect(batch.getByRole('status')).toContainText('已处理 3 / 3');
    await expect(batch.getByText('已保存',{exact:true})).toHaveCount(2);await expect(batch.getByText('未完成',{exact:true})).toHaveCount(1);
    await expect(batchStart).toBeDisabled();
    const batchDownload=page.waitForEvent('download');await batch.getByRole('button',{name:'下载本批结果',exact:true}).click();
    assert((await batchDownload).suggestedFilename().endsWith('.csv'));
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'test-results/institution-certificate-batch-mobile.png',fullPage:true});
    // Delay delivery of a real Java/Rust response: the server may already have saved
    // while the user cancels. Do not mock success or assume abort rolls back a save.
    await page.setViewportSize({width:1280,height:900});
    await batch.getByRole('button',{name:'关闭',exact:true}).last().click();
    await page.getByRole('button',{name:'批量检查',exact:true}).click();
    const pair=[{name:'first.wproof',mimeType:'application/json',buffer:bytes},{name:'second.wproof',mimeType:'application/json',buffer:bytes}];
    let serverFinished,releaseResponse,routeFinished;
    const serverReady=new Promise(resolve=>serverFinished=resolve),gate=new Promise(resolve=>releaseResponse=resolve),routeDone=new Promise(resolve=>routeFinished=resolve);
    let queuedSends=0;
    const countSends=request=>{if(new URL(request.url()).pathname==='/api/workproof/certificates'&&request.method()==='POST')queuedSends++;};
    page.on('request',countSends);
    await page.route('**/api/workproof/certificates',async route=>{
      try {const response=await route.fetch();assert.equal(response.status(),200);serverFinished();await gate;await route.fulfill({response}).catch(()=>{});}
      finally{routeFinished();}
    },{times:1});
    await batch.getByLabel('选择多份 .wproof 证书').setInputFiles(pair);
    await batch.getByText('我同意发送这一批证书，并保存检查通过的摘要',{exact:true}).click();await batchStart.click();
    await Promise.race([serverReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Real batch request did not reach the server')),20000))]);
    await batch.getByRole('button',{name:'停止后续处理',exact:true}).click();
    await expect(batch.getByText('未发送',{exact:true})).toHaveCount(1);assert.equal(queuedSends,1);
    await expect(batch.getByText('已停止等待结果；服务器可能已保存，可在列表查询。',{exact:true})).toBeVisible();
    await batch.getByRole('button',{name:'关闭',exact:true}).last().click();await page.getByRole('button',{name:'批量检查',exact:true}).click();
    await batch.getByLabel('选择多份 .wproof 证书').setInputFiles({name:'fresh.wproof',mimeType:'application/json',buffer:bytes});
    releaseResponse();await routeDone;
    await expect(batch.getByRole('status')).toContainText('已处理 0 / 1');await expect(batchStart).toBeDisabled();
    await expect(batch.getByText('已保存',{exact:true})).toHaveCount(0);assert.equal(queuedSends,1);
    await batch.getByText('我同意发送这一批证书，并保存检查通过的摘要',{exact:true}).click();await batchStart.click();
    await expect(batch.getByText('已保存',{exact:true})).toHaveCount(1);assert.equal(queuedSends,2);
    page.off('request',countSends);
    console.log('PASS: cancellation stops remaining uploads; a delayed real response cannot alter a reopened batch; resubmission succeeds');
    console.log('PASS: real sequential batch, consent gating, failure isolation, deduplication, results download and mobile layout');
    console.log('PASS: real Vue inspection and catalog navigation, scoped list, details, search/reset and CSV download');
  }catch(error){if(page){fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/institution-certificate-inspection-failure.png',fullPage:true}).catch(()=>{});}throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
