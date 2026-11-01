import {test,expect} from '@playwright/test';
import fs from 'node:fs';

async function desktop(page:import('@playwright/test').Page,fail=false){
  await page.route('**/desktop-status/**',route=>{
    const script=new URL(route.request().url()).pathname.endsWith('status.js');
    return route.fulfill({contentType:script?'application/javascript':'text/html',body:fs.readFileSync('apps/desktop/ui/'+(script?'status.js':'index.html'),'utf8')});
  });
  await page.addInitScript(({fail})=>{
    let connections=[{ticket:'word-ticket',origin:'https://school.example',source:'word',channel:'browser',expires_in_seconds:1800,sessions:2},{ticket:'wps-ticket',origin:'https://wps.example',source:'wps',channel:'browser',expires_in_seconds:3600,sessions:1}];
    (window as any).__TAURI__={core:{invoke:async(command:string,args?:{ticket:string})=>{
      if(command==='engine_status')return {ready:true,sessions:3,events:12};
      if(command==='pending_adapters')return [];
      if(command==='adapter_connections')return connections;
      if(command==='revoke_adapter'){
        if(fail)throw new Error('撤销失败，请重试');
        connections=connections.filter(c=>c.ticket!==args?.ticket);return null;
      }
      throw new Error('Unexpected IPC command '+command);
    }}};
  },{fail});
  await page.goto('/desktop-status/index.html');
}

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
  await expect(steps).toContainText('Word 文档');
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
