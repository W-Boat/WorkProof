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
    await page.goto(origin+'/');await page.getByRole('button',{name:'检查一份证书',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'检查一份证书',exact:true});await expect(dialog).toBeVisible();
    const submit=dialog.getByRole('button',{name:'检查证书内容',exact:true}),consent=dialog.getByRole('checkbox',{name:'我同意将所选证书发送给机构服务器检查'});
    await expect(submit).toBeDisabled();await expect(dialog.getByText('下一步：选择一份证书。',{exact:true})).toBeVisible();
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles({name:'other.json',mimeType:'application/json',buffer:Buffer.from('{"not":"a certificate"}')});await expect(dialog.getByText('请选择 .wproof 证书文件，其他文件不会发送。',{exact:true})).toBeVisible();assert.equal(inspections,0);
    const fixture=path.resolve('apps/verifier/public/demo/essay.md.wproof'),bytes=fs.readFileSync(fixture),proof=JSON.parse(bytes);
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles(fixture);await expect(submit).toBeDisabled();await expect(dialog.getByText('下一步：阅读上方说明，确认同意后勾选，再点击“检查证书内容”。',{exact:true})).toBeVisible();assert.equal(inspections,0);
    await dialog.getByText('我同意将所选证书发送给机构服务器检查', {exact:true}).click();await expect(consent).toBeChecked();await expect(submit).toBeEnabled();await consent.focus();await page.keyboard.press('Space');await expect(consent).not.toBeChecked();await expect(submit).toBeDisabled();await page.keyboard.press('Space');await expect(consent).toBeChecked();await submit.click();
    await expect(dialog.getByText('证书内容一致',{exact:true})).toBeVisible();assert.equal(inspections,1);
    const uploaded=await page.evaluate(()=>window.__workproofTestUpload);
    assert.deepEqual(uploaded,{bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},'Fetch must send the original certificate Blob');
    const fingerprint=crypto.createHash('sha256').update(Buffer.from(proof.signature,'hex')).digest('hex');
    await expect(dialog.getByText(fingerprint,{exact:true})).toBeVisible();await expect(dialog.getByText('作品仍需在本机单独检查。这里没有确认作者身份，也没有确认实际创作时间。',{exact:true})).toBeVisible();
    fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/institution-certificate-inspection-full.png',fullPage:true});
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles(path.resolve('test-institution-selected.wproof'));await expect(submit).toBeDisabled();
    await dialog.getByText('我同意将所选证书发送给机构服务器检查', {exact:true}).click();await expect(consent).toBeChecked();await submit.click();await expect(dialog.getByText('只检查本次分享的记录',{exact:false})).toBeVisible();await expect(dialog.getByText('未检查全部过程记录，不能据此判断未分享的过程。',{exact:true})).toBeVisible();await expect(dialog.getByText(fingerprint,{exact:true})).toBeVisible();
    proof.records[1].event.inserted++;
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles({name:'changed.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(proof))});await dialog.getByText('我同意将所选证书发送给机构服务器检查', {exact:true}).click();await expect(consent).toBeChecked();await submit.click();await expect(dialog.getByText('证书内容未能确认',{exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile modal must not overflow');await page.screenshot({path:'test-results/institution-certificate-inspection-mobile.png',fullPage:true});
    console.log('PASS: real Vue certificate dialog, explicit consent, original bytes, full/selective scope, shared fingerprint, tamper failure and mobile layout');
  }catch(error){if(page){fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/institution-certificate-inspection-failure.png',fullPage:true}).catch(()=>{});}throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
