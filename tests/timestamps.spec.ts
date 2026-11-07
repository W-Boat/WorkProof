import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const fixture='test-timestamp-fixtures/';

test('cancelling an online timestamp request ignores its late response',async({page})=>{
  let release!:()=>void,started!:()=>void,finished!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),received=new Promise<void>(resolve=>started=resolve),settled=new Promise<void>(resolve=>finished=resolve);
  await page.route('https://tsa.example.test/sign',async route=>{started();await gate;try{await route.fulfill({status:200,contentType:'application/timestamp-reply',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from([48,0])});}catch{}finally{finished();}});
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'检查外部时间凭据',exact:true});await panel.getByText('添加或检查时间凭据（可选）',{exact:true}).click();await panel.getByText('直接向时间服务申请',{exact:true}).click();await panel.getByLabel('HTTPS 时间服务地址').fill('https://tsa.example.test/sign');await panel.getByRole('button',{name:'生成请求并发送至此服务'}).click();await received;
  await panel.getByRole('button',{name:'取消当前操作'}).click();release();await settled;
  await expect(panel.getByRole('status')).toContainText('已取消');await expect(panel.getByRole('button',{name:'保存当前响应'})).toHaveCount(0);await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toHaveCount(0);
});

for(const invalid of ['html','oversized'])test(`online timestamp rejects ${invalid} response without a trusted result`,async({page})=>{
  await page.route('https://tsa.example.test/sign',route=>route.fulfill({status:200,contentType:invalid==='html'?'text/html':'application/timestamp-reply',headers:{'Access-Control-Allow-Origin':'*'},body:invalid==='html'?'<html>login</html>':Buffer.alloc(128*1024+1)}));
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'检查外部时间凭据',exact:true});await panel.getByText('添加或检查时间凭据（可选）',{exact:true}).click();await panel.getByText('直接向时间服务申请',{exact:true}).click();await panel.getByLabel('HTTPS 时间服务地址').fill('https://tsa.example.test/sign');await panel.getByRole('button',{name:'生成请求并发送至此服务'}).click();
  await expect(panel.getByRole('alert')).toContainText(invalid==='html'?'文件类型':'128 KB');await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toHaveCount(0);await expect(panel.getByRole('button',{name:'保存当前响应'})).toHaveCount(0);
});

test('explicit online request receives a real synthetic TSA response without trusting it automatically',async({page},info)=>{
  test.setTimeout(120000);
  const query=info.outputPath('online.tsq'),response=info.outputPath('online.tsr'),ca=info.outputPath('online-ca.pem');let sent=0;
  await page.route('https://tsa.example.test/sign',async route=>{
    const request=route.request();
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'content-type'}});return;}
    sent++;expect(request.method()).toBe('POST');expect(request.headers()['content-type']).toBe('application/timestamp-query');expect(request.headers()['authorization']).toBeUndefined();expect(request.headers()['cookie']).toBeUndefined();expect(request.headers()['referer']).toBeUndefined();
    const bytes=request.postDataBuffer()!;expect(bytes.length).toBeLessThan(8193);fs.writeFileSync(query,bytes);
    execFileSync('python',['scripts/sign_browser_timestamp.py',query,response,ca],{timeout:90000});
    await route.fulfill({status:200,contentType:'application/timestamp-reply',headers:{'Access-Control-Allow-Origin':'*'},body:fs.readFileSync(response)});
  });
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'检查外部时间凭据',exact:true});await panel.getByText('添加或检查时间凭据（可选）',{exact:true}).click();await panel.getByText('直接向时间服务申请',{exact:true}).click();
  await panel.getByLabel('HTTPS 时间服务地址').fill('http://tsa.example.test/sign');await panel.getByRole('button',{name:'生成请求并发送至此服务'}).click();await expect(panel.getByRole('alert')).toContainText('HTTPS');expect(sent).toBe(0);
  await panel.getByLabel('HTTPS 时间服务地址').fill('https://tsa.example.test/sign');await panel.getByRole('button',{name:'生成请求并发送至此服务'}).click();
  await expect(panel.getByRole('status')).toContainText('尚未核验');expect(sent).toBe(1);await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'保存当前请求'})).toBeVisible();await expect(panel.getByRole('button',{name:'保存当前响应'})).toBeVisible();
  await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(ca);await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'检查时间凭据',exact:true}).click();await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toBeVisible();
  await panel.getByLabel('HTTPS 时间服务地址').fill('http://tsa.example.test/sign');await panel.getByRole('button',{name:'生成请求并发送至此服务'}).click();await expect(panel.getByRole('alert')).toContainText('HTTPS');await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toHaveCount(0);await expect(panel.getByRole('checkbox')).not.toBeChecked();expect(sent).toBe(1);
});
test('real OpenSSL timestamp is verified locally with explicit trust and honest scope',async({page})=>{
  const external:string[]=[];
  page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173')&&!request.url().startsWith('blob:'))external.push(request.url());});
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'检查外部时间凭据',exact:true});await panel.getByText('添加或检查时间凭据（可选）',{exact:true}).click();
  await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'request.tsq');await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(fixture+'response.tsr');await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(fixture+'ca.pem');
  const submit=panel.getByRole('button',{name:'检查时间凭据',exact:true}),consent=panel.getByRole('checkbox');await expect(submit).toBeDisabled();await consent.check();await submit.click();
  await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toBeVisible();await expect(panel.getByText('服务声明的时间：',{exact:false})).toBeVisible();
  await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(fixture+'wrong-ca.pem');await expect(consent).not.toBeChecked();await expect(panel.getByRole('status')).toHaveCount(0);await consent.check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(fixture+'ca.pem');await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'other.tsq');await consent.check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  const changed=Buffer.from(fs.readFileSync(fixture+'response.tsr'));changed[changed.length-1]^=1;
  await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'request.tsq');await panel.getByLabel('时间戳响应（.tsr）').setInputFiles({name:'changed.tsr',mimeType:'application/timestamp-reply',buffer:changed});await consent.check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByRole('status')).toHaveCount(0);
  await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'legacy.tsq');await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(fixture+'legacy.tsr');await consent.check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByLabel('原始时间戳请求（.tsq）').setInputFiles(fixture+'request.tsq');await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(fixture+'response.tsr');await consent.check();await submit.click();await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/timestamp-mobile.png',fullPage:true});
  expect(external).toEqual([]);
});

test('browser request downloads, round-trips through OpenSSL and clears stale responses',async({page},testInfo)=>{
  test.setTimeout(120000);
  const external:string[]=[];
  page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173')&&!request.url().startsWith('blob:'))external.push(request.url());});
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'检查外部时间凭据',exact:true});await panel.getByText('添加或检查时间凭据（可选）',{exact:true}).click();
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'生成并下载时间戳请求',exact:true}).click();
  const query=testInfo.outputPath('browser.tsq'),response=testInfo.outputPath('browser.tsr'),ca=testInfo.outputPath('ca.pem');
  await (await download).saveAs(query);
  execFileSync('python',['scripts/sign_browser_timestamp.py',query,response,ca],{timeout:90000});
  await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(response);await panel.getByLabel('你信任的 CA 证书（.pem）').setInputFiles(ca);
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'检查时间凭据',exact:true}).click();
  await expect(panel.getByText('时间凭据与签名一致',{exact:true})).toBeVisible();
  const secondDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'生成并下载时间戳请求',exact:true}).click();
  const secondQuery=testInfo.outputPath('second.tsq');await (await secondDownload).saveAs(secondQuery);
  expect(fs.readFileSync(secondQuery).equals(fs.readFileSync(query))).toBe(false);
  await expect(panel.getByRole('status')).toHaveCount(0);await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await expect(panel.getByLabel('时间戳响应（.tsr）')).toHaveValue('');
  await expect(panel.getByText('browser.tsr',{exact:true})).toHaveCount(0);
  await panel.getByLabel('时间戳响应（.tsr）').setInputFiles(response);await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'检查时间凭据',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('timestamp-steps-mobile.png'),fullPage:true});
  expect(external).toEqual([]);
});

test('timestamp worker can be cancelled and times out without blocking the page',async({page})=>{
  await page.addInitScript(()=>{
    const Original=window.Worker;
    const state={terminated:0,posted:0};Object.assign(window,{timestampWorkerTest:state});
    window.Worker=class extends Original{
      timestamp:boolean;
      constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.timestamp=!String(url).endsWith('/verify-worker.js');}
      postMessage(message:unknown,transfer:Transferable[]=[]){if(this.timestamp){state.posted++;return;}super.postMessage(message,transfer);}
      terminate(){if(this.timestamp)state.terminated++;super.terminate();}
    };
  });
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'检查外部时间凭据',exact:true});await panel.getByText('添加或检查时间凭据（可选）',{exact:true}).click();
  const generate=panel.getByRole('button',{name:'生成并下载时间戳请求',exact:true});
  await generate.click();await expect(panel.getByRole('button',{name:'取消当前操作',exact:true})).toBeVisible();
  // A worker that never replies must leave the main thread responsive to cancellation.
  await panel.getByRole('button',{name:'取消当前操作',exact:true}).click();await expect(panel.getByText('已取消。可以更换文件或重新检查。',{exact:true})).toBeVisible();await expect(generate).toBeEnabled();
  expect(await page.evaluate(()=>(window as unknown as {timestampWorkerTest:{terminated:number}}).timestampWorkerTest.terminated)).toBe(1);
  await page.clock.install();await generate.click();await page.clock.fastForward(16000);
  await expect(panel.getByRole('alert')).toContainText('耗时过长，已停止');await expect(generate).toBeEnabled();await expect(panel.getByRole('button',{name:'取消当前操作',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {timestampWorkerTest:{terminated:number}}).timestampWorkerTest.terminated)).toBe(2);
  await generate.click();await expect(panel.getByRole('button',{name:'取消当前操作',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {timestampWorkerTest:{terminated:number}}).timestampWorkerTest.terminated)).toBe(3);
});
