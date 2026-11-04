import {test,expect} from '@playwright/test';
import fs from 'node:fs';

async function desktop(page:import('@playwright/test').Page,fail=false,nativeWord=false){
  await page.route('**/desktop-status/**',route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)||'index.html';
    const types:Record<string,string>={'status.js':'application/javascript','index.html':'text/html','theme.css':'text/css','workbench.css':'text/css','brand.png':'image/png'};
    if(!types[name])return route.abort();
    return route.fulfill({contentType:types[name],body:fs.readFileSync('apps/desktop/ui/'+name)});
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
  await page.getByRole('button',{name:'连接管理',exact:true}).click();
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
  await page.getByRole('button',{name:'连接管理',exact:true}).click();
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
  await expect(page.getByRole('region',{name:'允许连接的软件'})).toBeHidden();
  await expect(page.locator('#verification')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/desktop-simple-guide.png',fullPage:true});
});

test('asset certificate check explains partial PDF scope, cancellation and failures',async({page})=>{
  await desktop(page);
  await page.getByRole('button',{name:'设置与工具',exact:true}).click();
  await page.locator('.advanced-tools > summary').click();
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
  await page.getByRole('button',{name:'设置与工具',exact:true}).click();
  await page.locator('.advanced-tools > summary').click();
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

test('desktop remembers software and keeps the workbench readable at desktop and narrow sizes',async({page},testInfo)=>{
  await desktop(page);
  await page.getByLabel('你用什么软件创作？').selectOption('powerpoint');
  await page.reload();
  await expect(page.getByLabel('你用什么软件创作？')).toHaveValue('powerpoint');
  await expect(page.getByRole('button',{name:'打开 PowerPoint 并开始记录'})).toBeVisible();
  await expect(page.locator('#tool-requirement')).toContainText('PowerPoint 原生加载项');
  await expect(page.getByText('累计记录',{exact:true})).toBeVisible();
  await expect(page.locator('.advanced-tools')).not.toHaveAttribute('open','');
  for(const width of [960,420,360]){
    await page.setViewportSize({width,height:780});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`workbench-${width}.png`),fullPage:true});
  }
});

test('desktop sends one launch while busy, exposes actionable failure and permits retry',async({page})=>{
  await desktop(page);
  await page.evaluate(()=>{
    const target=window as any,ipc=target.__TAURI__.core,original=ipc.invoke;
    target.launchCalls=0;
    ipc.invoke=(command:string,args:unknown)=>{
      if(command!=='open_word')return original(command,args);
      target.launchCalls++;return new Promise((_resolve,reject)=>{target.failLaunch=()=>reject(new Error('Office 已打开，但没有加载 WorkProof。请先安装对应的加载项。'));});
    };
  });
  const button=page.locator('#open-word');
  await button.click();await expect(button).toBeDisabled();
  await page.evaluate(()=>document.getElementById('open-word')!.click());
  expect(await page.evaluate(()=>(window as any).launchCalls)).toBe(1);
  await page.evaluate(()=>(window as any).failLaunch());
  await expect(page.locator('#message')).toContainText('请先安装对应的加载项');
  await expect(page.locator('#message')).toHaveAttribute('data-state','error');
  await expect(page.locator('#installation-help')).toHaveAttribute('open','');
  await expect(button).toBeEnabled();await expect(button).toHaveText('打开 Word 并开始记录');
  await button.click();expect(await page.evaluate(()=>(window as any).launchCalls)).toBe(2);
  await page.evaluate(()=>(window as any).failLaunch());
});

test('desktop disables launch when the service is unavailable and recovers after refresh',async({page})=>{
  await desktop(page);await expect(page.locator('#open-word')).toBeEnabled();
  await page.getByRole('button',{name:'连接管理',exact:true}).click();
  await page.evaluate(()=>{
    const target=window as any,ipc=target.__TAURI__.core;target.originalInvoke=ipc.invoke;
    ipc.invoke=(command:string,args:unknown)=>command==='engine_status'?Promise.reject(new Error('Synthetic service failure')):target.originalInvoke(command,args);
  });
  await page.getByRole('button',{name:'刷新连接'}).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state','error');
  await expect(page.locator('#open-word')).toBeDisabled();
  await expect(page.locator('#status')).not.toContainText('已就绪');
  await page.evaluate(()=>{const target=window as any;target.__TAURI__.core.invoke=target.originalInvoke;});
  await page.getByRole('button',{name:'刷新连接'}).click();
  await expect(page.locator('#open-word')).toBeEnabled();
  await expect(page.locator('#status')).toHaveAttribute('data-state','ready');
});

test('desktop navigation switches bounded workspaces and preserves recording inputs',async({page},testInfo)=>{
  await desktop(page);await page.setViewportSize({width:960,height:780});
  await page.getByLabel('你用什么软件创作？').selectOption('powerpoint');
  await page.getByRole('button',{name:'证书核验',exact:true}).click();
  await expect(page.locator('#workspace-title')).toBeFocused();
  await expect(page.locator('#verification')).toBeVisible();
  await expect(page.locator('.creation-panel')).toBeHidden();
  await page.screenshot({path:testInfo.outputPath('pc-verification.png')});
  await page.getByRole('button',{name:'连接管理',exact:true}).click();
  await expect(page.getByRole('region',{name:'允许连接的软件'})).toBeVisible();
  await page.getByRole('button',{name:'创作记录',exact:true}).click();
  await expect(page.getByLabel('你用什么软件创作？')).toHaveValue('powerpoint');
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('pc-creation.png')});
});

test('application rail shows actual grants and appearance persists with system changes',async({page},testInfo)=>{
  await page.emulateMedia({colorScheme:'dark'});await desktop(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('[data-connection=word]')).toHaveText('已连接');
  await expect(page.locator('[data-connection=powerpoint]')).toHaveText('未连接');
  await page.getByRole('button',{name:'选择 PowerPoint',exact:true}).click();
  await expect(page.getByLabel('你用什么软件创作？')).toHaveValue('powerpoint');
  await expect(page.locator('#selected-connection')).toContainText('尚未连接');
  await page.setViewportSize({width:1100,height:780});
  await page.screenshot({path:testInfo.outputPath('host-rail-dark.png')});
  await page.getByRole('button',{name:'设置与工具',exact:true}).click();
  await page.getByLabel('界面主题',{exact:true}).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'设置与工具',exact:true}).click();
  await page.getByLabel('界面主题',{exact:true}).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'连接管理',exact:true}).click();
  await page.getByRole('button',{name:'断开 Word 连接'}).click();
  await expect(page.locator('[data-connection=word]')).toHaveText('未连接');
  await page.getByRole('button',{name:'选择 Word',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('host-rail-light.png')});
  expect(await page.evaluate(()=>{const main=document.querySelector('main')!;return main.scrollWidth<=main.clientWidth;})).toBe(true);
});

test('Windows internal titlebar routes controls without closing the webpage',async({page},testInfo)=>{
  await desktop(page);
  await page.evaluate(()=>{
    document.body.dataset.platform='windows';
    const target=window as any,original=target.__TAURI__.core.invoke;target.windowActions=[];
    target.__TAURI__.core.invoke=(command:string,args:any)=>{
      if(command==='window_action'){target.windowActions.push(args.action);return Promise.resolve();}
      return original(command,args);
    };
  });
  await page.setViewportSize({width:1100,height:780});
  for(const [name,action] of [['最小化窗口','minimize'],['最大化或还原窗口','maximize'],['关闭窗口并保留后台记录','close']]){
    await page.getByRole('button',{name,exact:true}).click();
    expect(await page.evaluate(()=>(window as any).windowActions.at(-1))).toBe(action);
  }
  await page.screenshot({path:testInfo.outputPath('windows-internal-controls.png')});
  await expect(page.locator('.workspace-nav')).toBeVisible();
});

test('desktop Office configuration reports failures and actual returned installation state',async({page})=>{
  await desktop(page);
  await page.evaluate(()=>{
    const target=window as any,original=target.__TAURI__.core.invoke;target.setupRequests=[];
    target.__TAURI__.core.invoke=(command:string,args:any)=>{
      if(command!=='office_setup')return original(command,args);
      target.setupRequests.push(args);
      if(!args.install)return Promise.resolve({installed:false});
      if(target.setupRequests.length===2)return Promise.reject(new Error('请先保存并完全退出对应的 Office 软件，再点击安装。'));
      return Promise.resolve({installed:true,restart_required:true});
    };
  });
  await page.getByRole('button',{name:'检查安装状态',exact:true}).click();
  await expect(page.locator('#office-setup-result')).toContainText('还没有安装加载项');
  await page.getByRole('button',{name:'安装 / 修复加载项',exact:true}).click();
  await expect(page.locator('#office-setup-result')).toContainText('请先保存并完全退出');
  await expect(page.getByRole('button',{name:'安装 / 修复加载项',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'安装 / 修复加载项',exact:true}).click();
  await expect(page.locator('#office-setup-result')).toContainText('加载项已安装');
  expect(await page.evaluate(()=>(window as any).setupRequests)).toEqual([{host:'word',install:false},{host:'word',install:true},{host:'word',install:true}]);
});
