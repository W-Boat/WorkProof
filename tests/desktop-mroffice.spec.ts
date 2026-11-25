import {expect, test} from '@playwright/test';

test('MR Office lists all six local editors and keeps document edits and events after reload', async ({page}) => {
  test.setTimeout(60_000);
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
  await kind.selectOption('sheets');
  await expect(page.getByText(/可打开 .*\.csv/)).toBeVisible();
  await kind.selectOption('docs');
  await page.getByRole('button', {name:'新建', exact:true}).click();
  const body = page.locator('.ProseMirror[contenteditable="true"]').first();
  await expect(body).toBeVisible({timeout:30_000});
  await body.click();
  await page.keyboard.insertText('在本机保存的写作内容');
  await expect(body).toContainText('在本机保存的写作内容');
  await expect(page.getByRole('status').filter({hasText:'已保存到本机'})).toBeVisible();
  await page.getByRole('button', {name:'操作记录', exact:true}).click();
  await expect(page.getByRole('complementary', {name:'操作记录'})).toContainText('内容已更改');
  const local = page.getByLabel('本机文档', {exact:true});
  const id = await local.inputValue();
  expect(id).toBeTruthy();
  await page.reload();
  await local.selectOption(id);
  await expect(body).toContainText('在本机保存的写作内容');
  await page.getByRole('button', {name:'操作记录', exact:true}).click();
  await expect(page.getByRole('complementary', {name:'操作记录'})).toContainText('内容已更改');
  expect(remote).toEqual([]);
});
