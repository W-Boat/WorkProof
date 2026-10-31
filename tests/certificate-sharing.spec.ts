import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const fixture='apps/verifier/public/demo/';
const certificate=()=>JSON.parse(fs.readFileSync(fixture+'essay.md.wproof','utf8'));
const identifier=()=>createHash('sha256').update(Buffer.from(certificate().signature,'hex')).digest('hex');

async function load(page:import('@playwright/test').Page){
  await page.goto('/');
  await page.getByLabel('选择最终作品').setInputFiles(fixture+'essay.md');
  await page.getByLabel('选择 .wproof 证书').setInputFiles(fixture+'essay.md.wproof');
}

test('a valid certificate cannot pass a different sender fingerprint',async({page})=>{
  await load(page);
  await page.getByText('收到证书指纹？',{exact:false}).click();
  const input=page.getByRole('textbox',{name:'发送者提供的完整证书指纹'});
  await input.fill('0'.repeat(64));
  await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('证据核验未通过',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'证书指纹不一致'})).toBeVisible();
  await expect(page.getByRole('button',{name:'分享签名证书'})).toHaveCount(0);
  await input.fill(identifier().toUpperCase());
  await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await expect(page.getByText('证书指纹一致：与发送者提供的证书相符。',{exact:true})).toBeVisible();
  await expect(page.locator('.share-fingerprint')).toHaveText(identifier());
});

test('download fallback preserves verified bytes and the certificate is legible on mobile',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));
  await load(page);await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'分享签名证书'}).click();
  const download=await pending;
  expect(fs.readFileSync((await download.path())!)).toEqual(fs.readFileSync(fixture+'essay.md.wproof'));
  await expect(page.getByRole('status').filter({hasText:'签名证书已下载'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator('.certificate-name').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.locator('.certificate-disclaimer').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/share-certificate-mobile.png',fullPage:true});
});

test('selective export retains the original certificate fingerprint and original disclosure bytes',async({page})=>{
  await load(page);await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出部分证据'}).click();
  const selected=(await (await pending).path())!;
  await page.getByLabel('选择 .wproof 证书').setInputFiles(selected);
  await page.getByRole('button',{name:'开始本地核验'}).click();
  await expect(page.getByText('部分证据核验通过',{exact:true})).toBeVisible();
  await expect(page.locator('.share-fingerprint')).toHaveText(identifier());
  const saved=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载签名证书'}).click();
  expect(fs.readFileSync((await (await saved).path())!)).toEqual(fs.readFileSync(selected));
});
