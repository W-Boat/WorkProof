import {test,expect} from '@playwright/test';
import fs from 'node:fs';

async function desktop(page:import('@playwright/test').Page,fail=false,nativeWord=false){
  await page.route('**/desktop-status/**',route=>{
    const script=new URL(route.request().url()).pathname.endsWith('status.js');
    return route.fulfill({contentType:script?'application/javascript':'text/html',body:fs.readFileSync('apps/desktop/ui/'+(script?'status.js':'index.html'),'utf8')});
  });
  await page.addInitScript(({fail,nativeWord})=>{
    let connections=[{ticket:'word-ticket',origin:'https://school.example',source:'word',channel:'browser',expires_in_seconds:1800,sessions:2},{ticket:'wps-ticket',origin:'https://wps.example',source:'wps',channel:'browser',expires_in_seconds:3600,sessions:1}];
    (window as any).__TAURI__={core:{invoke:async(command:string,args?:{ticket:string})=>{
      if(command==='engine_status')return {ready:true,sessions:3,events:12};
      if(command==='pending_adapters')return nativeWord?[{ticket:'native-word',origin:'',source:'word',channel:'native'}]:[];
      if(command==='adapter_connections')return connections;
      if(command==='revoke_adapter'){
        if(fail)throw new Error('撤销失败，请重试');
        connections=connections.filter(c=>c.ticket!==args?.ticket);return null;
      }
      throw new Error('Unexpected IPC command '+command);
    }}};
  },{fail,nativeWord});
  await page.goto('/desktop-status/index.html');
}

test('native Word approval names Word and discloses unverified publisher',async({page})=>{
  await desktop(page,false,true);
  await expect(page.getByText('Word 想连接 WorkProof',{exact:true})).toBeVisible();
  await expect(page.getByText('插件称自己来自本机，尚未确认发布者。',{exact:true})).toBeVisible();
  await expect(page.getByText(/请只允许你刚在 Word 中发起的连接/)).toBeVisible();
  await expect(page.getByText(/请只允许你刚在 Photoshop 中发起的连接/)).toHaveCount(0);
});

test('desktop shows grant origins and revokes one connection while retaining the other',async({page})=>{
  await desktop(page);
  const region=page.getByRole('region',{name:'允许连接的软件'});
  await expect(region).toContainText('https://school.example');
  await expect(region).toContainText('已开始 2 份记录');
  const wps=page.getByRole('button',{name:'断开 WPS 连接'});
  await wps.focus();
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(wps).toBeFocused();
  await page.getByRole('button',{name:'断开 Word 连接'}).click();
  await expect(page.getByRole('button',{name:'断开 Word 连接'})).toHaveCount(0);
  await expect(wps).toBeVisible();
  await expect(page.locator('#message')).toContainText('已有记录不会删除');
  await wps.click();
  await expect(page.locator('#no-connections')).toBeVisible();
});

test('failed desktop revocation keeps the connection and offers retry',async({page})=>{
  await desktop(page,true);
  const button=page.getByRole('button',{name:'断开 Word 连接'});
  await button.click();
  await expect(page.locator('#message')).toContainText('撤销失败');
  await expect(button).toBeEnabled();
  await expect(page.getByRole('region',{name:'允许连接的软件'})).toContainText('https://school.example');
});

test('desktop starts with Word and shows only the chosen software steps',async({page})=>{
  await desktop(page);await page.setViewportSize({width:420,height:600});
  await expect(page.getByLabel('你用什么软件创作？')).toHaveValue('word');
  const steps=page.getByRole('list',{name:'开始记录的三个步骤'});
  await expect(steps.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'打开 Word 并开始记录'})).toBeVisible();
  await expect(steps).toContainText('首次使用时');
  await expect(steps).toContainText('导出作品和证书');
  const install=page.getByRole('button',{name:'安装 / 更新 VS Code 插件'});
  await expect(install).toBeHidden();
  await page.getByLabel('你用什么软件创作？').selectOption('vscode');
  await expect(install).toBeVisible();await expect(steps).toContainText('VS Code 底部');
  await page.getByLabel('你用什么软件创作？').selectOption('wps');
  await expect(install).toBeHidden();await expect(page.locator('#installation-note')).toContainText('暂未提供面向普通用户的一键安装包');
  const guideBox=await steps.boundingBox(),connectionsBox=await page.getByRole('region',{name:'允许连接的软件'}).boundingBox();
  expect(guideBox).not.toBeNull();expect(connectionsBox).not.toBeNull();expect(guideBox!.y).toBeLessThan(connectionsBox!.y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/desktop-simple-guide.png',fullPage:true});
});

test('asset certificate check explains partial PDF scope, cancellation and failures',async({page})=>{
  await desktop(page);
  await page.getByText('检查作品内嵌的创作证书',{exact:true}).click();
  const button=page.getByRole('button',{name:'选择作品和 CA，开始检查'});
  const result=page.locator('#image-result');
  await page.evaluate(()=>{
    const ipc=(window as any).__TAURI__.core,original=ipc.invoke;
    const responses=[{scope:'selective',disclosed:3,total:1500,mediaType:'application/pdf'},{cancelled:true},{scope:'full',disclosed:5,total:5}];
    ipc.invoke=async(command:string,args:unknown)=>{
      if(command!=='verify_image')return original(command,args);
      if(args!==undefined)throw new Error('Image paths must not be supplied by the webview');
      if(responses.length)return responses.shift();
      throw new Error('所选 CA 未能建立可信签名链');
    };
  });
  await button.click();await expect(result).toContainText('已披露的 3 条记录');
  await expect(result).toContainText('未披露记录不在本次检查范围内');
  await button.click();await expect(result).toHaveText('已取消，本次没有核验。');
  await button.click();await expect(result).toContainText('完整过程记录');
  await button.click();await expect(result).toContainText('所选 CA 未能建立可信签名链');
  await expect(result).not.toContainText('检查通过');await expect(button).toBeEnabled();
  await expect(page.getByText(/不要仅因它与作品一起收到就信任它/)).toBeVisible();
});

test('embedding requires fresh consent and does not claim independent trust',async({page})=>{
  await desktop(page);
  await page.getByText('把创作证书放进作品',{exact:true}).click();
  const consent=page.locator('#embed-consent'),button=page.getByRole('button',{name:'选择材料，生成带证书的作品'}),result=page.locator('#embed-result');
  await expect(button).toBeDisabled();
  await page.evaluate(()=>{
    const ipc=(window as any).__TAURI__.core,original=ipc.invoke;
    let count=0;
    ipc.invoke=async(command:string,args:unknown)=>{
      if(command!=='embed_image')return original(command,args);
      if(JSON.stringify(args)!==JSON.stringify({consent:true}))throw new Error('Only explicit consent may cross IPC');
      return count++===0?{scope:'selective',disclosed:3,total:5,mediaType:'application/pdf'}:{cancelled:true};
    };
  });
  await consent.check();await button.click();
  await expect(result).toContainText('尚未通过独立可信 CA 核验');
  await expect(result).toContainText('选择性披露的 3 条');
  await expect(consent).not.toBeChecked();await expect(button).toBeDisabled();
  await consent.check();await button.click();
  await expect(result).toHaveText('已取消，没有生成新文件。');
  await expect(consent).not.toBeChecked();await expect(button).toBeDisabled();
});
