import {expect, test} from '@playwright/test';

test('MR Office lists all six local editors and keeps document edits and events after reload', async ({page}) => {
  test.setTimeout(90_000);
  const remote: string[] = [];
  const startup: string[] = [];
  page.on('pageerror', error => startup.push(error.message));
  page.on('console', message => {if(message.type()==='error')startup.push(message.text());});
  page.on('requestfailed', request=>startup.push(request.url()+' '+request.failure()?.errorText));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') remote.push(request.url());
  });
  await page.goto('/mroffice.html');
  const kind = page.locator('.office-toolbar select').first();
  try {
    await expect(kind.locator('option')).toHaveText(['文档', '表格', '演示', 'PDF', '手写', '代码']);
  } catch (error) {
    throw new Error(`MR Office startup: ${startup.join(' | ')}. Page: ${await page.locator('body').innerText()}\n${error}`);
  }
  await expect(kind).toHaveValue('docs');
  await expect(page.getByRole('heading', {name:'文档编辑器'})).toBeVisible();
  await page.getByRole('button', {name:'新建', exact:true}).press('Enter');
  const body = page.locator('.ProseMirror[contenteditable="true"]').first();
  try {
    await expect(body).toBeVisible({timeout:30_000});
  } catch (error) {
    throw new Error(`MR Office document open: ${startup.join(' | ')}. ${await page.locator('.office-status').textContent()}. ${error}`);
  }
  await body.click();
  await page.keyboard.insertText('在本机保存的写作内容');
  await expect(body).toContainText('在本机保存的写作内容',{timeout:20_000});
  await expect(page.getByRole('status').filter({hasText:'已保存到本机'})).toBeVisible();
  await page.getByRole('button', {name:'操作记录', exact:true}).click();
  await expect(page.getByRole('complementary', {name:'操作记录'})).toContainText('内容已更改');
  const local = page.getByLabel('本机文档', {exact:true});
  const id = await local.inputValue();
  expect(id).toBeTruthy();
  await page.reload();
  await expect(local.locator(`option[value="${id}"]`)).toBeAttached({timeout:15000});
  await local.selectOption('');
  await local.selectOption(id);
  try {
    await expect(body).toContainText('在本机保存的写作内容',{timeout:30000});
  } catch (error) {
    throw new Error(`MR Office document reopen: ${startup.join(' | ')}. ${await page.locator('.office-status').textContent()}. ${error}`);
  }
  await page.getByRole('button', {name:'操作记录', exact:true}).click();
  await expect(page.getByRole('complementary', {name:'操作记录'})).toContainText('内容已更改');
  expect(remote).toEqual([]);
});

for (const kind of ['sheets', 'slides', 'ink', 'code']) {
  test('MR Office opens and saves a new ' + kind + ' file locally', async ({page}) => {
    test.setTimeout(90_000);
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto('/mroffice.html');
    await page.getByLabel('编辑器', {exact:true}).selectOption(kind);
    await page.getByRole('button', {name:'新建', exact:true}).press('Enter');
    const file = page.getByLabel('本机文档', {exact:true});
    try{
      await expect(file).not.toHaveValue('',{timeout:45_000});
    }catch(error){
      throw new Error(`MR Office ${kind}: ${errors.join(' | ')}. ${await page.locator('.office-status').textContent()}. ${error}`);
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    const exportButton = page.getByRole('button', {name:'导出文件', exact:true});
    await expect(exportButton).toBeEnabled({timeout:15000});
    const downloaded = page.waitForEvent('download');
    await exportButton.click();
    const result = await downloaded;
    const extensions = {sheets:'.mrsheet', slides:'.mrslides', ink:'.mrink', code:'.py'};
    expect(result.suggestedFilename().endsWith(extensions[kind as keyof typeof extensions])).toBe(true);
  });
}
