import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {strToU8,zipSync} from 'fflate';

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

test('signed paragraph location is highlighted and only selected excerpts reach the report',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles('apps/verifier/public/demo/essay.md');
  await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles('apps/verifier/public/demo/essay.paragraphs.wproof');
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
  await expect(page.locator('.result-banner.success')).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'在作品中查看',exact:true}).click();
  await expect(page.frameLocator('iframe[title="作品只读预览"]').locator('#paragraph-1.located')).toHaveText('让创作过程，有据可查');
  await expect(page.frameLocator('iframe[title="作品只读预览"]').locator('#paragraph-1')).toBeFocused();
  await page.getByRole('button',{name:'下载加密 HTML 报告',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'保存完整核验报告'});
  await dialog.getByText('选择要附上的段落摘录',{exact:true}).click();
  const checkbox=dialog.getByRole('checkbox',{name:/第 1 段/});
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  const password='paragraph-report-password';
  await dialog.getByLabel('设置报告密码',{exact:true}).fill(password);
  await dialog.getByLabel('再次输入报告密码',{exact:true}).fill(password);
  const download=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'生成并保存',exact:true}).click();
  const report=await download;
  const html=fs.readFileSync((await report.path())!);
  await page.route('**/paragraph-report.html',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('/paragraph-report.html');
  await page.getByLabel('报告密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'打开报告',exact:true}).click();
  await expect(page.locator('#report-paragraphs')).toContainText('让创作过程，有据可查');
  await expect(page.locator('#report-paragraphs')).not.toContainText('证据可以复核，隐私应被尊重。');
});

test('Word preview locates the final paragraph with tracked replacements and moves',async({page})=>{
  await page.goto('/');
  const finalText='这是核验时应显示的段落。';
  const deleted='旧版文字不应出现在最终视图。';
  const moved='已移动到这里的文字。';
  const fingerprint=(value:string)=>createHash('sha256').update(value,'utf16le').digest('hex');
  const document=zipSync({
    '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml':strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:ins w:id="1"><w:r><w:t>${finalText}</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>${deleted}</w:delText></w:r></w:del></w:p>
      <w:p><w:r><w:t>原位置。</w:t></w:r><w:moveFrom w:id="3"><w:r><w:t>${moved}</w:t></w:r></w:moveFrom></w:p>
      <w:p><w:moveTo w:id="4"><w:r><w:t>${moved}</w:t></w:r></w:moveTo></w:p>
    </w:body></w:document>`),
  });
  const finalHash=fingerprint(finalText);
  const movedHash=fingerprint(moved);
  const excerpts=await page.evaluate(async({bytes,hashes})=>{
    const url=new URL('/document-preview.js',location.origin).href;
    const {previewDocument}=await import(url);
    const file=new File([Uint8Array.from(bytes)],'tracked.docx');
    const preview=await previewDocument(file,[],hashes.map(fingerprint=>({fingerprint})));
    const frame=document.createElement('iframe');
    frame.title='Word revision preview';
    frame.srcdoc=preview.html;
    document.body.append(frame);
    return preview.excerpts;
  },{bytes:[...document],hashes:[finalHash,movedHash]});
  expect(excerpts).toEqual([{ordinal:1,text:finalText},{ordinal:3,text:moved}]);
  const frame=page.frameLocator('iframe[title="Word revision preview"]');
  await expect(frame.locator('#word-paragraph-'+finalHash+'.located')).toHaveText(finalText);
  await expect(frame.locator('#word-paragraph-'+movedHash+'.located')).toHaveText(moved);
  await expect(frame.locator('body')).not.toContainText(deleted);
});

test('historical preview renders only a file matching a signed save checkpoint',async({page})=>{
  await page.goto('/');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles('apps/verifier/public/demo/essay.md');
  await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles('apps/verifier/public/demo/essay.history.wproof');
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
  await expect(page.locator('.result-banner.success')).toBeVisible({timeout:20000});
  const section=page.getByRole('region',{name:'历史保存版本'});
  const file=section.locator('input[type="file"]');
  await file.setInputFiles({name:'unrelated.md',mimeType:'text/markdown',buffer:Buffer.from('unrelated')});
  await expect(section.getByRole('status')).toContainText('不匹配');
  await expect(section.locator('iframe')).toHaveCount(0);
  await file.setInputFiles('apps/verifier/public/demo/essay.previous.md');
  await expect(section.getByRole('status')).toContainText('已核对历史保存记录 17');
  await expect(section.frameLocator('iframe').getByRole('heading',{name:'Previously saved version'})).toBeVisible();
});
