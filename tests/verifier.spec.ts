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
test('invalid JSON and unknown versions are clear errors',async({page})=>{
  await page.goto('/');await page.getByLabel('选择最终作品').setInputFiles(fixture+'essay.md');await page.getByLabel('选择 .wproof 证书').setInputFiles({name:'broken.wproof',mimeType:'application/json',buffer:Buffer.from('{')});await page.getByRole('button',{name:'开始本地核验'}).click();await expect(page.getByRole('alert')).toBeVisible();
});
test('mobile is usable and has no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/verified-mobile.png',fullPage:true});
});
