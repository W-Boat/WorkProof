import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

test('standalone website downloads encrypted HTML and a matching MD5 association without desktop IPC',async({page})=>{
  test.setTimeout(60000);await page.goto('/');
  await page.getByRole('button',{name:'先体验一份演示证据',exact:true}).click();await expect(page.locator('.result-banner.success')).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'下载加密 HTML 报告',exact:true}).click();const dialog=page.getByRole('dialog',{name:'保存完整核验报告'});
  await dialog.getByLabel('设置报告密码',{exact:true}).fill('Web-report-test-password');await dialog.getByLabel('再次输入报告密码',{exact:true}).fill('Web-report-test-password');
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'生成并保存',exact:true}).click();const htmlFile=await download,bytes=fs.readFileSync((await htmlFile.path())!);
  expect(htmlFile.suggestedFilename()).toMatch(/\.html$/);expect(bytes.toString()).toContain('workproof-encrypted-report/1');expect(bytes.toString()).not.toContain('Web-report-test-password');
  const md5=createHash('md5').update(bytes).digest('hex');await expect(dialog.locator('.report-export-saved')).toContainText(md5);
  const checksum=page.waitForEvent('download');await dialog.getByRole('button',{name:'保存 MD5 校验文件',exact:true}).click();expect(fs.readFileSync((await (await checksum).path())!,'utf8')).toBe(`${md5}  ${htmlFile.suggestedFilename()}\n`);
  const association=page.waitForEvent('download');await dialog.getByRole('button',{name:'保存关联清单',exact:true}).click();const binding=JSON.parse(fs.readFileSync((await (await association).path())!,'utf8'));
  expect(binding.file).toBe(htmlFile.suggestedFilename());expect(binding.md5).toBe(md5);expect(binding.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(binding.source_certificate_id).toMatch(/^[0-9a-f]{64}$/);
});
