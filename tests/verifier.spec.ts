import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const fixture='apps/verifier/public/demo/';
test('real Wasm verifies fixture, declares trust boundaries, and exports PNG',async({page})=>{
  const external:string[]=[];const errors:string[]=[];
  page.on('request',req=>{if(!req.url().startsWith('http://127.0.0.1:4173')&&!req.url().startsWith('blob:'))external.push(req.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'让创作过程，有据可查。'})).toBeVisible();
  await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await expect(page.getByText('演示数据',{exact:true})).toBeVisible();
  await expect(page.getByText('未提供外部时间凭据',{exact:false})).toBeVisible();
  await page.getByRole('slider').fill('30');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存证书图片'}).click();
  expect((await download).suggestedFilename()).toBe('WorkProof-certificate.png');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/verified-desktop.png',fullPage:true});
  expect(external).toEqual([]);expect(errors).toEqual([]);
});
test('replaced artifact fails without a trusted badge',async({page})=>{
  await page.goto('/');await page.getByLabel('选择最终作品').setInputFiles({name:'essay.md',mimeType:'text/plain',buffer:Buffer.from('different content')});
  await page.getByLabel('选择 .wproof 证书').setInputFiles(fixture+'essay.md.wproof');await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('证据核验未通过',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存证书图片'})).toBeDisabled();
});
test('altered event is detected by browser protocol core',async({page})=>{
  const proof=JSON.parse(fs.readFileSync(fixture+'essay.md.wproof','utf8'));proof.records[5].event.inserted++;
  await page.goto('/');await page.getByLabel('选择最终作品').setInputFiles(fixture+'essay.md');await page.getByLabel('选择 .wproof 证书').setInputFiles({name:'tampered.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(proof))});
  await page.getByRole('button',{name:'开始本地核验'}).click();await expect(page.getByText('证据核验未通过',{exact:true})).toBeVisible();
});
test('invalid JSON is a clear error',async({page})=>{
  await page.goto('/');await page.getByLabel('选择最终作品').setInputFiles(fixture+'essay.md');await page.getByLabel('选择 .wproof 证书').setInputFiles({name:'broken.wproof',mimeType:'application/json',buffer:Buffer.from('{')});await page.getByRole('button',{name:'开始本地核验'}).click();await expect(page.getByRole('region',{name:'核验作品与证书'}).getByRole('alert')).toBeVisible();
});
test('unknown protocol versions never fall back to a trusted result',async({page})=>{
  const proof=JSON.parse(fs.readFileSync(fixture+'essay.md.wproof','utf8'));proof.manifest.protocol='workproof/999';
  await page.goto('/');await page.getByLabel('选择最终作品').setInputFiles(fixture+'essay.md');await page.getByLabel('选择 .wproof 证书').setInputFiles({name:'future.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(proof))});await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('不支持的证据协议版本',{exact:true})).toBeVisible();await expect(page.getByText('证据核验通过',{exact:true})).toHaveCount(0);
});
test('mobile is usable and has no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/verified-mobile.png',fullPage:true});
});

test('browser exports selected evidence with original signature and verifies it with an honest scope',async({page})=>{
  const external:string[]=[];
  page.on('request',req=>{if(!req.url().startsWith('http://127.0.0.1:4173')&&!req.url().startsWith('blob:'))external.push(req.url());});
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await page.getByLabel('公开的事件编号').fill('6,21,41');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出部分证据'}).click();
  const download=await pending;expect(download.suggestedFilename()).toBe('essay.md.selected.wproof');
  const selectedPath=await download.path();expect(selectedPath).toBeTruthy();
  const selected=JSON.parse(fs.readFileSync(selectedPath!,'utf8'));
  const original=JSON.parse(fs.readFileSync(fixture+'essay.md.wproof','utf8'));
  expect(selected.signature).toBe(original.signature);expect(selected.manifest).toEqual(original.manifest);
  expect(selected.disclosed.map((e:any)=>e.record.event.seq)).toEqual([0,5,20,40,85]);
  expect(selected.records).toBeUndefined();
  await page.getByLabel('选择 .wproof 证书').setInputFiles({name:'essay.md.selected.wproof',mimeType:'application/json',buffer:fs.readFileSync(selectedPath!)});
  await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('部分证据核验通过',{exact:true})).toBeVisible();
  await expect(page.locator('.certificate-disclaimer')).toContainText('未核验完整记录链');
  await expect(page.getByText('记录链完整',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'已披露的事件'}).locator('.event-detail')).toHaveCount(5);
  await expect(page.getByRole('button',{name:'导出部分证据'})).toHaveCount(0);
  const image=page.waitForEvent('download');await page.getByRole('button',{name:'保存证书图片'}).click();
  const certificateImage=await image;expect(certificateImage.suggestedFilename()).toBe('WorkProof-certificate.png');
  await certificateImage.saveAs('test-results/disclosure-certificate.png');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/disclosure-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/disclosure-mobile.png',fullPage:true});
  expect(external).toEqual([]);
});

test('invalid disclosure paths fail in real Wasm and cannot export a success image',async({page})=>{
  const selected=JSON.parse(fs.readFileSync(fixture+'essay.md.selected.wproof','utf8'));
  selected.disclosed[1].siblings[0]='00'.repeat(32);
  await page.goto('/');await page.getByLabel('选择最终作品').setInputFiles(fixture+'essay.md');
  await page.getByLabel('选择 .wproof 证书').setInputFiles({name:'altered.selected.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(selected))});
  await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('证据核验未通过',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存证书图片'})).toBeDisabled();
});

test('selection errors do not generate files and legacy signatures remain supported without re-commitment',async({page})=>{
  const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await page.getByLabel('公开的事件编号').fill('1-999999999');
  await page.getByRole('button',{name:'导出部分证据'}).click();
  await expect(page.getByRole('region',{name:'选择性披露导出'}).getByRole('alert')).toContainText('超出范围');
  expect(downloads).toEqual([]);
  await page.getByLabel('选择 .wproof 证书').setInputFiles('crates/proof/tests/fixtures/v2-demo.wproof');
  await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'导出部分证据'})).toHaveCount(0);
});
