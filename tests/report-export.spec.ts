import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

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

test('browser verifies a gzip certificate and rejects a truncated gzip member',async({page})=>{
  await page.goto('/');
  const certificate=gzipSync(fs.readFileSync('apps/verifier/public/demo/essay.md.wproof'));
  const verify=async(buffer:Buffer)=>page.evaluate(async bytes=>{
    const response=await fetch('/demo/essay.md');
    const artifact=new File([await response.blob()],'essay.md');
    const proof=new File([Uint8Array.from(bytes)],'essay.md.wproof');
    return new Promise<{type:string;fingerprint?:string;report?:{valid:boolean}}>((resolve,reject)=>{
      const worker=new Worker('/verify-worker.js',{type:'module'});
      worker.onmessage=({data})=>{if(data.type!=='progress'){worker.terminate();resolve(data);}};
      worker.onerror=error=>{worker.terminate();reject(error.message);};
      worker.postMessage({artifact,proof});
    });
  },Array.from(buffer));
  const good=await verify(certificate);
  expect(good.type).toBe('result');
  expect(good.report?.valid).toBe(true);
  const broken=await verify(certificate.subarray(0,-1));
  expect(broken.type).toBe('error');
});
