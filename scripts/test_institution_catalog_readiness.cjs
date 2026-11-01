// Uses the real deliberately unprepared isolated CI database, no API mocking.
const assert=require('node:assert/strict'),{chromium,expect}=require('@playwright/test');
(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.DB_NAME,'workproof_ci');
  const origin='http://127.0.0.1:18089',token=process.env.WORKPROOF_TEST_TOKEN;assert(token);
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext();
    await context.addInitScript(({token})=>{localStorage.setItem('scaffold.token',token);localStorage.setItem('scaffold.expiresAt',String(Date.now()+3600000));},{token});
    const page=await context.newPage();let catalogRequests=0;
    page.on('request',request=>{if(new URL(request.url()).pathname==='/api/workproof/certificates')catalogRequests++;});
    await page.goto(origin+'/workproof/certificates');
    await expect(page.getByRole('status')).toContainText('数据结构尚未准备好');
    await expect(page.getByRole('button',{name:'批量检查',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'检查并保存摘要',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'重新检查',exact:true}).click();
    await expect(page.getByRole('button',{name:'重新检查',exact:true})).toBeEnabled();
    assert.equal(catalogRequests,0,'Unprepared page must not fetch or save catalog entries');
    console.log('PASS: real missing-table state, readable next step, disabled save/batch and read-only retry');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
