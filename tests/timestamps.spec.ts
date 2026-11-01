import {test,expect} from '@playwright/test';
const fixture='test-timestamp-fixtures/';
test('real OpenSSL timestamp is verified locally with explicit trust and honest scope',async({page})=>{
  const external:string[]=[];
  page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173')&&!request.url().startsWith('blob:'))external.push(request.url());});
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'检查外部时间凭据',exact:true});await panel.getByText('有时间戳请求与响应？展开检查（可选）',{exact:true}).click();
  await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'request.tsq');await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(fixture+'response.tsr');await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(fixture+'ca.pem');
  const submit=panel.getByRole('button',{name:'检查时间凭据',exact:true}),consent=panel.getByRole('checkbox');await expect(submit).toBeDisabled();await consent.check();await submit.click();
  await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toBeVisible();await expect(panel.getByText('服务声明的时间：',{exact:false})).toBeVisible();
  await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(fixture+'wrong-ca.pem');await expect(consent).not.toBeChecked();await expect(panel.getByRole('status')).toHaveCount(0);await consent.check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(fixture+'ca.pem');await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'other.tsq');await consent.check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'legacy.tsq');await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(fixture+'legacy.tsr');await consent.check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'request.tsq');await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(fixture+'response.tsr');await consent.check();await submit.click();await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/timestamp-mobile.png',fullPage:true});
  expect(external).toEqual([]);
});
