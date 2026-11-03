// Real bundled Vue/HTTP/Java; real pinned weights only in explicitly enabled acceptance.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {chromium,expect}=require('@playwright/test');
(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.DB_NAME,'workproof_ci');
  const origin=process.env.WORKPROOF_TEST_ORIGIN,token=process.env.WORKPROOF_TEST_TOKEN;
  assert.equal(origin,'http://127.0.0.1:18089');assert(token);
  const user=(await(await fetch(origin+'/api/auth/me',{headers:{Authorization:'Bearer '+token}})).json()).data;
  const unauthorized=await fetch(origin+'/api/workproof/analysis/capabilities');assert.equal(unauthorized.status,401);
  const noConsent=await fetch(origin+'/api/workproof/analysis/tasks/mpu-zh-v3/txt',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:'not uploaded for analysis'});assert.equal((await noConsent.json()).code,400);
  const capabilities=(await(await fetch(origin+'/api/workproof/analysis/capabilities',{headers:{Authorization:'Bearer '+token}})).json()).data;
  assert.deepEqual(capabilities.engines.map(engine=>engine.id).sort(),['desklib-en-v1.01','mpu-en-v3','mpu-zh-v3']);
  assert.equal(capabilities.engines.find(engine=>engine.id==='desklib-en-v1.01').score_kind,'uncalibrated_binary_sigmoid');
  const browser=await chromium.launch({headless:true});
  let page;
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    await context.addInitScript(({origin,token,user})=>{if(location.origin===origin){localStorage.setItem('scaffold.token',token);localStorage.setItem('scaffold.user',JSON.stringify(user));localStorage.setItem('scaffold.expiresAt',String(Date.now()+3600000));}},{origin,token,user});
    page=await context.newPage();await page.goto(origin+'/');await page.getByRole('button',{name:'AI 辅助分析',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'AI 辅助分析',exact:true}),submit=dialog.getByRole('button',{name:'发送并分析',exact:true});await expect(submit).toBeDisabled();
    await expect(dialog.getByText('支持 DOCX、TXT、Markdown，最多 8 MB。中文至少 80 个汉字，英文至少 80 个单词。',{exact:true})).toBeVisible();
    await expect(dialog.getByText('中文选中文模型，英文选英文模型。英文有两个模型可分别参考；它们都在比较文字写法，不是两种独立证据，分数不合并。',{exact:true})).toBeVisible();
    const text='这是一段用于机构流程验收的合成文字，只检查真实模型和页面是否连通。分数不是创作比例，也不能单独证明作者身份或学术不端。临时文档不应出现在操作日志或模型报告中。'.repeat(2);
    await dialog.getByLabel('选择文档',{exact:true}).setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from(text)});await expect(submit).toBeDisabled();
    await dialog.getByText('我同意将所选文档发送给机构服务器进行辅助分析',{exact:true}).click();
    if(process.env.WORKPROOF_TEST_REAL_AI!=='1'){
      await expect(submit).toBeDisabled();await expect(dialog.getByText('中文 MPU v3（尚未准备）',{exact:true})).toBeVisible();
    }else{
      await expect(submit).toBeEnabled();await submit.click();await expect(dialog.getByText('仅供人工参考',{exact:true})).toBeVisible({timeout:150000});
      await expect(dialog.getByText('更换文档或模型',{exact:true})).toBeVisible();
      await expect(dialog.getByRole('combobox')).toBeHidden();
      await expect(dialog.getByRole('button',{name:'保存中文说明',exact:true})).toBeVisible();
      await expect(dialog.getByText('文档 SHA-256：'+crypto.createHash('sha256').update(text).digest('hex'),{exact:true})).toBeVisible();
      await expect(dialog.getByText('更接近生成样本的模型得分',{exact:true})).toBeVisible();
      await dialog.getByText('模型版本与报告',{exact:true}).click();
      const readableEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'保存中文说明',exact:true}).click();
      const readableDownload=await readableEvent;assert(readableDownload.suggestedFilename().endsWith('.txt'));
      const readableStream=await readableDownload.createReadStream();const readableChunks=[];for await(const chunk of readableStream)readableChunks.push(chunk);
      const readable=Buffer.concat(readableChunks).toString('utf8');
      assert(readable.includes('不是签名创作证书')&&readable.includes(crypto.createHash('sha256').update(text).digest('hex')));
      assert(readable.includes('模型参考得分（未校准）')&&readable.includes('47695ff451b32c225dd938f4f478f7fdc6aa6bb0'));
      assert(!readable.includes(text)&&!readable.includes('100% 人类'));
      const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'保存辅助报告',exact:true}).click();
      const download=await downloadEvent;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const saved=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(saved.model_revision,'47695ff451b32c225dd938f4f478f7fdc6aa6bb0');assert.equal(saved.model,'yuchuantian/AIGC_detector_zhv3');assert.equal(saved.artifact_hash,crypto.createHash('sha256').update(text).digest('hex'));assert.equal(saved.calibration,null);assert.equal(saved.score_kind,'uncalibrated_class_softmax');assert(!('text' in saved));assert(!JSON.stringify(saved).includes(text));
      await dialog.getByLabel('选择文档',{exact:true}).setInputFiles({name:'short.txt',mimeType:'text/plain',buffer:Buffer.from('你好')});await expect(submit).toBeDisabled();
      await dialog.getByText('我同意将所选文档发送给机构服务器进行辅助分析',{exact:true}).click();await submit.click();await expect(dialog.getByText('文字过短：中文至少需要 80 个汉字，英文至少需要 80 个单词。',{exact:true})).toBeVisible({timeout:30000});
      await dialog.getByLabel('选择文档',{exact:true}).setInputFiles({name:'cancel.txt',mimeType:'text/plain',buffer:Buffer.from(text)});await dialog.getByText('我同意将所选文档发送给机构服务器进行辅助分析',{exact:true}).click();await submit.click();await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog.getByText('服务器已结束本次分析。',{exact:true})).toBeVisible({timeout:30000});
      const english='This synthetic paragraph exercises the actual English model through the authenticated institution workbench. The returned scores are not an accuracy benchmark, an authorship probability, or a proportion of generated content. '.repeat(3);
      await dialog.getByLabel('选择文档',{exact:true}).setInputFiles({name:'english.txt',mimeType:'text/plain',buffer:Buffer.from(english)});
      await dialog.getByRole('combobox').click();await page.getByRole('option',{name:'英文 MPU v3',exact:true}).click();
      await expect(submit).toBeDisabled();await dialog.getByText('我同意将所选文档发送给机构服务器进行辅助分析',{exact:true}).click();await submit.click();
      await expect(dialog.getByText('仅供人工参考',{exact:true})).toBeVisible({timeout:150000});
      await expect(dialog.getByRole('button',{name:'本次分析已结束',exact:true})).toBeDisabled();
      await expect(dialog.getByText('文档 SHA-256：'+crypto.createHash('sha256').update(english).digest('hex'),{exact:true})).toBeVisible();
      await expect(dialog.getByText('更接近生成样本的模型得分',{exact:true})).toBeVisible();
      await dialog.getByText('更换文档或模型',{exact:true}).click();
      await dialog.getByRole('combobox').click();await page.getByRole('option',{name:'英文 Desklib v1.01',exact:true}).click();
      await expect(submit).toBeDisabled();await dialog.getByText('我同意将所选文档发送给机构服务器进行辅助分析',{exact:true}).click();await submit.click();
      await expect(dialog.getByText('仅供人工参考',{exact:true})).toBeVisible({timeout:150000});
      await dialog.getByText('模型版本与报告',{exact:true}).click();
      const desklibDownloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'保存辅助报告',exact:true}).click();
      const desklibStream=await(await desklibDownloadEvent).createReadStream();const desklibChunks=[];for await(const chunk of desklibStream)desklibChunks.push(chunk);
      const desklibReport=JSON.parse(Buffer.concat(desklibChunks).toString('utf8'));
      assert.equal(desklibReport.engine_id,'desklib-en-v1.01');assert.equal(desklibReport.model_revision,'5fdea974cd4287c61674951ec78803aa274e2fb7');
      assert.equal(desklibReport.score_kind,'uncalibrated_binary_sigmoid');assert.equal(desklibReport.artifact_hash,crypto.createHash('sha256').update(english).digest('hex'));assert(!('text' in desklibReport));
      await expect(dialog.getByText('更接近生成样本的模型得分',{exact:true})).toBeVisible();
      await expect(dialog.getByText('更接近人类样本的模型得分',{exact:true})).toHaveCount(0);
      await expect(dialog.getByText('本模型只输出一个参考分数。报告中的人类分数是它的补值，不是另一项独立判断。',{exact:true})).toBeVisible();
      assert.deepEqual(Object.keys(desklibReport.raw_scores).sort(),['AI','Human']);
      const singleEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'保存中文说明',exact:true}).click();
      const singleStream=await(await singleEvent).createReadStream();const singleChunks=[];for await(const chunk of singleStream)singleChunks.push(chunk);
      const single=Buffer.concat(singleChunks).toString('utf8');assert(single.includes('更接近生成样本：'));
      assert(!single.includes('更接近人类样本：')&&!single.includes(english));assert(single.includes('人类补值不作为第二项独立判断'));
    }
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/institution-ai-mobile.png',fullPage:true});
  }catch(error){fs.mkdirSync('test-results',{recursive:true});if(page)await page.screenshot({path:'test-results/institution-ai-failed.png',fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
