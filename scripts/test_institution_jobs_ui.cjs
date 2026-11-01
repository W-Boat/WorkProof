// Real bundled Vue / authenticated HTTP / persistent Java task. No mocked job endpoints.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {chromium,expect}=require('@playwright/test');
(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.DB_NAME,'workproof_ci');
  const origin=process.env.WORKPROOF_TEST_ORIGIN,token=process.env.WORKPROOF_TEST_TOKEN;
  assert.equal(origin,process.env.WORKPROOF_TEST_REAL_JOBS==='1'?'http://127.0.0.1:18091':'http://127.0.0.1:18089');assert(token);
  const headers={Authorization:'Bearer '+token},base=origin+'/api/workproof/certificate-jobs';
  const user=(await(await fetch(origin+'/api/auth/me',{headers})).json()).data;assert(user);
  const capability=(await(await fetch(base+'/capabilities',{headers})).json()).data;
  const browser=await chromium.launch({headless:true});let page;
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    await context.addInitScript(({origin,token,user})=>{
      if(location.origin!==origin)return;
      localStorage.setItem('scaffold.token',token);localStorage.setItem('scaffold.user',JSON.stringify(user));localStorage.setItem('scaffold.expiresAt',String(Date.now()+3600000));
      const original=window.fetch.bind(window);window.__jobUploads=[];
      window.fetch=async(input,init)=>{
        if(new URL(String(input),location.href).pathname.match(/\/certificate-jobs\/[^/]+\/items\/\d+$/)&&init?.method==='PUT'){
          if(!(init.body instanceof Blob))throw Error('Job upload must retain the original File/Blob');
          const bytes=await init.body.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);
          window.__jobUploads.push({bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')});
        }
        return original(input,init);
      };
    },{origin,token,user});
    page=await context.newPage();await page.goto(origin+'/workproof/certificates');
    const open=page.getByRole('button',{name:'后台批量任务',exact:true});
    await expect(open).toBeEnabled();await open.click();
    const dialog=page.getByRole('dialog',{name:'后台批量任务',exact:true});
    if(process.env.WORKPROOF_TEST_REAL_JOBS!=='1'){
      assert.equal(capability.ready,false);
      await expect(dialog.getByRole('status')).toContainText('后台批量任务尚未准备好');
      await expect(dialog.getByLabel('选择后台任务证书',{exact:true})).toHaveCount(0);
      await expect(dialog.getByRole('button',{name:'上传并提交后台',exact:true})).toHaveCount(0);
    }else{
      assert.equal(capability.ready,true);
      assert(process.env.WORKPROOF_JOB_FIXTURE);const bytes=fs.readFileSync(process.env.WORKPROOF_JOB_FIXTURE);
      const submit=dialog.getByRole('button',{name:'上传并提交后台',exact:true});await expect(submit).toBeDisabled();
      await dialog.getByLabel('选择后台任务证书',{exact:true}).setInputFiles({name:'essay.md.wproof',mimeType:'application/json',buffer:bytes});
      await expect(submit).toBeDisabled();
      await dialog.getByText('我同意将这一批证书交给机构后台检查并保存摘要',{exact:true}).click();
      const created=page.waitForResponse(response=>response.url()===base&&response.request().method()==='POST');
      const submitted=page.waitForResponse(response=>response.url().startsWith(base+'/')&&response.url().endsWith('/submit')&&response.request().method()==='POST');
      await submit.click();const job=(await(await created).json()).data;assert(job.id);
      assert.equal((await(await submitted).json()).code,200);
      await expect(submit).toBeDisabled();
      const uploads=await page.evaluate(()=>window.__jobUploads);assert.equal(uploads.length,1);assert.equal(uploads[0].sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(uploads[0].bytes,bytes.length);
      await page.close();
      // Closing the entire page must not cancel an already submitted server task.
      await expect.poll(async()=>{const value=(await(await fetch(base+'/'+job.id,{headers})).json()).data;return value.state;},{timeout:60000}).toMatch(/^(completed|partial)$/);
      page=await context.newPage();await page.goto(origin+'/workproof/certificates');
      await page.getByRole('button',{name:'后台批量任务',exact:true}).click();
      const reopened=page.getByRole('dialog',{name:'后台批量任务',exact:true});
      await reopened.getByRole('button',{name:'刷新状态',exact:true}).click();
      await reopened.getByRole('button',{name:job.createdAt+' · 1 份证书',exact:true}).click();
      await expect(reopened.getByText('任务编号：'+job.id,{exact:true})).toBeVisible();
      await expect(reopened.getByText(/第 1 份：/)).toBeVisible();
    }
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/institution-jobs-mobile.png',fullPage:true});
  }catch(error){fs.mkdirSync('test-results',{recursive:true});if(page)await page.screenshot({path:'test-results/institution-jobs-failed.png',fullPage:true}).catch(()=>{});throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
