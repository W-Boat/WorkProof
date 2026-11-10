// Actions-only: actual packaged Vue, real ordinary-role HTTP service and Rust verifier.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,expect}=require('@playwright/test');
let phase='preflight';
(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');
  const raw=fs.readFileSync(0,'utf8');assert(Buffer.byteLength(raw)<=65536);
  const input=JSON.parse(raw),{origin,token,project,allowed,publicKeyPath,ttl}=input;
  assert.equal(origin,'http://127.0.0.1:18082');assert(/^workproof-server-ci-[0-9a-f]{12}$/.test(project));
  assert.equal(typeof allowed,'boolean');assert.equal(ttl,'600');assert.equal(typeof token,'string');
  const response=await fetch(origin+'/api/auth/me',{headers:{Authorization:'Bearer '+token}});
  assert.equal(response.status,200);const user=(await response.json()).data;
  assert(user&&!user.permissions.includes('*')&&!user.roles.includes('super_admin'));
  assert.equal(user.permissions.includes('workproof:receipt:issue'),allowed);
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    await context.addInitScript(({origin,token,user})=>{
      if(location.origin!==origin)return;
      localStorage.setItem('scaffold.token',token);localStorage.setItem('scaffold.user',JSON.stringify(user));
      localStorage.setItem('scaffold.expiresAt',String(Date.now()+3600000));
    },{origin,token,user});
    const page=await context.newPage();phase='dashboard';
    await page.goto(origin+'/');await expect(page.locator('.dashboard .page-title')).toBeVisible();
    const issue=page.getByRole('button',{name:'签发接收回执',exact:true});
    await expect(page.getByRole('button',{name:'检查一份证书',exact:true})).toBeHidden();
    await expect(page.getByRole('button',{name:'AI 辅助分析',exact:true})).toBeHidden();
    phase='visibility';
    if(!allowed){await expect(issue).toBeHidden();return;}
    await expect(issue).toBeVisible();await issue.click();
    const dialog=page.getByRole('dialog',{name:'签发机构接收回执',exact:true});
    const submit=dialog.getByRole('button',{name:'发送并签发回执',exact:true});
    const proof=path.resolve('apps/verifier/public/demo/essay.md.wproof');
    phase='consent';await expect(submit).toBeDisabled();
    await dialog.getByLabel('选择 .wproof 证书').setInputFiles(proof);await expect(submit).toBeDisabled();
    await dialog.getByText('我同意将所选证书发送给机构服务器签发接收回执',{exact:true}).click();
    await expect(submit).toBeEnabled();phase='issue';await submit.click();
    await expect(dialog.getByText('已收到接收回执',{exact:true})).toBeVisible();
    const downloaded=page.waitForEvent('download');
    await dialog.getByRole('button',{name:'下载接收回执',exact:true}).click();
    const file=await downloaded;assert.equal(file.suggestedFilename(),'workproof-server-receipt.json');
    phase='verify-download';
    const checked=require('node:child_process').spawnSync(path.resolve('target/release/workproof-receipt'),
      ['verify',proof,await file.path(),'ci-image-http',ttl,publicKeyPath],{encoding:'utf8',timeout:15000});
    assert.equal(checked.status,0);const result=JSON.parse(checked.stdout);
    assert.equal(result.receipt_verified,true);
    for(const flag of ['artifact_checked','client_origin_verified','collection_verified','author_identity_verified','rule_calibration_verified'])assert.equal(result[flag],false);
  }finally{await browser.close();}
})().catch(()=>{console.error('RECEIPT_ROLE_UI_PHASE='+phase);process.exitCode=1;});
