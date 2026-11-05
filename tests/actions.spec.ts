import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const fixture='apps/verifier/public/demo/';

test('signed action counts reach the chart through real Wasm and reject changed counts',async({page})=>{
  await page.goto('/');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles(fixture+'actions-demo.txt');
  await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles(fixture+'actions-demo.txt.wproof');
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const actions=page.getByRole('region',{name:'操作统计'});
  await expect(actions).toContainText('退格');await expect(actions).toContainText('3 次');
  await expect(actions).toContainText('粘贴');await expect(actions).toContainText('2 次');
  await expect(actions).toContainText('格式变化');await expect(actions).toContainText('版式变化');
  await expect(actions).toContainText('不代表执行成功');
  await page.screenshot({path:'test-results/actions-verified.png',fullPage:true});
  const proof=JSON.parse(fs.readFileSync(fixture+'actions-demo.txt.wproof','utf8'));
  proof.records[1].event.metrics.paste=999;
  await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles({name:'changed.wproof',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(proof))});
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toHaveCount(0);
  await expect(actions).toHaveCount(0);
});

test('selective proof summarizes only disclosed operations',async({page})=>{
  await page.goto('/');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles(fixture+'actions-demo.txt');
  await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles(fixture+'actions-demo.selected.wproof');
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
  const actions=page.getByRole('region',{name:'操作统计'});
  await expect(actions).toContainText('退格');await expect(actions).toContainText('版式变化');
  await expect(actions.getByText('格式变化',{exact:true})).toHaveCount(0);
  await expect(actions).toContainText('这里只统计已披露的记录');
});
