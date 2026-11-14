import {selectChoice} from './desktop-select';
import {test,expect,Page} from '@playwright/test';
import fs from 'node:fs';
import {createHash,createDecipheriv,pbkdf2Sync} from 'node:crypto';

// Browser tests exercise the real bundled Tiptap. Only native storage IPC is a
// fixture; engine editor::tests cover actual SQLite and Ed25519 separately.
async function desktop(page:Page){
  await page.route('**/desktop-status/**',route=>{
    const asset=new URL(route.request().url()).pathname.slice('/desktop-status/'.length);
    const name=asset.split('/').at(-1)!;
    const type:Record<string,string>={'index.html':'text/html','word-worker.js':'application/javascript','components.js':'application/javascript','markdown-source-runtime.js':'application/javascript','theme.css':'text/css','native-editor.css':'text/css','report-export.css':'text/css','report-viewer.js':'application/javascript','native-verifier.css':'text/css','verify-worker.js':'application/javascript','brand.png':'image/png'};
    const headers=name==='index.html'?{'Content-Security-Policy':JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8')).app.security.csp}:{};
    const hostIcon=/^adapter-icons\/([a-z0-9-]+)\.webp$/.test(asset)&&fs.existsSync('apps/desktop/ui/'+asset);
    if(hostIcon)return route.fulfill({contentType:'image/webp',body:fs.readFileSync('apps/desktop/ui/'+asset)});
    const chunk=/^chunks\/[A-Za-z0-9_-]+\.js$/.test(asset);
    if(!chunk&&(!type[name]||asset!==name))return route.abort();
    return route.fulfill({contentType:chunk?'application/javascript':type[name],headers,body:fs.readFileSync('apps/desktop/ui/'+asset)});
  });
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    const w=window as any;
    const read=()=>JSON.parse(localStorage.getItem('test.editor.documents')||'{}');
    const write=(docs:any)=>localStorage.setItem('test.editor.documents',JSON.stringify(docs));
    w.editorHarness={failNext:false,saves:[],exports:0,listeners:{},windowActions:[]};
    w.__TAURI__={event:{listen:async(name:string,listener:any)=>{w.editorHarness.listeners[name]=listener;return ()=>delete w.editorHarness.listeners[name];}},core:{invoke:async(command:string,args:any)=>{
      const docs=read();
      if(command==='app_info')return {version:'0.1.0',build_number:'1234',source:'0123456789abcdef0123456789abcdef01234567',built_at:'1794384000'};
      if(command==='save_certificate'){if(w.nativeCertificateSave)return w.nativeCertificateSave(args);throw new Error('Native certificate saver is not configured for this test');}
      if(command==='save_report'){if(w.nativeReportSave)return w.nativeReportSave(args);throw new Error('Native report saver is not configured for this test');}
      if(command==='engine_status')return {ready:true,sessions:0,events:0,...(w.editorHarness.engineStatus||{})};
      if(command==='pending_adapters'||command==='adapter_connections')return [];
      if(command==='office_auto_start'){const key='test.auto-start.'+args.host;if(args.enabled!==null)localStorage.setItem(key,String(args.enabled));return localStorage.getItem(key)==='true';}
      if(command==='office_reconnect')return {seconds:5,attempts:3};
      if(command==='recording_limit')return Number(localStorage.getItem('test.recording-limit'))||null;
      if(command==='set_recording_limit'){localStorage.setItem('test.recording-limit',String(args.limit??''));return null;}
      if(command==='editor_list')return Object.values(docs);
      if(command==='library_delete'){if(args.kind==='editor'){for(const id of args.ids)delete docs[id];write(docs);}else w.editorHarness.externalDocuments=(w.editorHarness.externalDocuments||[]).filter((item:any)=>!args.ids.includes(item.id));return {deleted:args.ids.length};}
      if(command==='library_states')return JSON.parse(localStorage.getItem('library.states')||'{}');
      if(command==='library_set_state'){
        const states=JSON.parse(localStorage.getItem('library.states')||'{}');
        for(const id of args.ids)states[args.kind+':'+id]=args.state;
        localStorage.setItem('library.states',JSON.stringify(states));return {state:args.state};
      }
      if(command==='external_documents_list')return w.editorHarness.externalDocuments||[];
      if(command==='external_document_load'){
        const document=w.editorHarness.externalDocuments?.find((item:any)=>item.id===args.id);if(!document)throw new Error('记录不存在');
        const available=(w.editorHarness.externalRecords?.[args.id]||[]).filter((record:any)=>args.beforeSeq===null||record.event.seq<args.beforeSeq);
        const records=available.slice(0,args.limit),has_more=available.length>records.length;
        return {document,records,has_more,next_before:has_more?records.at(-1).event.seq:null};
      }
      if(command==='external_document_open'){(w.editorHarness.openedExternalIds||=[]).push(args.id);return null;}
      if(command==='editor_create'){
        const id=crypto.randomUUID().replaceAll('-',''),now=Date.now();
        const doc={id,title:args.title,kind:args.kind,created:now,modified:now,revision:0,content:{type:'doc',content:[{type:'paragraph'}]},actions:[],versions:[{revision:0,saved:now,count:0}],snapshots:{0:{type:'doc',content:[{type:'paragraph'}]}},event_count:1};docs[id]=doc;write(docs);return doc;
      }
      if(command==='editor_load')return docs[args.id];
      if(command==='editor_version')return docs[args.id].snapshots[args.revision];
      if(command==='editor_history'){
        (w.editorHarness.historyRequests||=[]).push({...args});
        const frames=docs[args.id].versions.filter((frame:any)=>frame.revision<=args.through&&(args.after===null||frame.revision>args.after)).sort((a:any,b:any)=>a.revision-b.revision).map((frame:any)=>{
          const actions=docs[args.id].actions.filter((item:any)=>item.revision===frame.revision).map((item:any)=>item.action);
          return {...frame,count:actions.length,pastes:actions.filter((a:any)=>a.kind==='paste').length,inserted:actions.reduce((n:number,a:any)=>n+(a.inserted||0),0),deleted:actions.reduce((n:number,a:any)=>n+(a.deleted||0),0)};
        });return {frames:frames.slice(0,128),has_more:frames.length>128,next_after:frames.length>128?frames[127].revision:null};
      }
      if(command==='editor_replay_frame'){(w.editorHarness.frameRequests||=[]).push({...args});return {revision:args.revision,saved:docs[args.id].versions.find((frame:any)=>frame.revision===args.revision).saved,content:docs[args.id].snapshots[args.revision],actions:docs[args.id].actions.filter((item:any)=>item.revision===args.revision).map((item:any)=>item.action).reverse()};}
      if(command==='editor_save'){
        w.editorHarness.saves.push(args.input);
        if(w.editorHarness.failNext){w.editorHarness.failNext=false;throw new Error('磁盘暂时无法写入，请重试。');}
        const input=args.input,doc=docs[input.id];
        if(input.expected_revision!==doc.revision)throw new Error('版本冲突');
        doc.revision++;doc.title=input.title;doc.content=input.content;doc.modified=Date.now();doc.event_count+=input.actions.length+1;
        doc.actions=input.actions.map((action:any)=>({action,revision:doc.revision})).reverse().concat(doc.actions).slice(0,300);
        doc.versions.unshift({revision:doc.revision,saved:Date.now(),count:input.actions.length});doc.snapshots[doc.revision]=input.content;write(docs);return {revision:doc.revision};
      }
      if(command==='editor_export'){w.editorHarness.exports++;w.editorHarness.lastExport=args;return {cancelled:true};}
      if(command==='window_action'){
        if(args.action==='ready'){w.editorHarness.ready={listeners:Object.keys(w.editorHarness.listeners),hasCloseGate:typeof w.workproofBeforeClose==='function'};return null;}
        w.editorHarness.closed=true;w.editorHarness.windowActions.push(args.action);return null;
      }
      if(command==='verifier_url')return 'http://127.0.0.1:4173/embedded-test/';
      throw new Error('Unexpected IPC '+command);
    }}};
  });
  await page.goto('/desktop-status/index.html');
  await expect(page.getByRole('button',{name:'新建文档',exact:true})).toBeVisible();
}
async function selectKind(page:Page,kind:'word'|'markdown'){await page.locator(`#document-kind-dialog button[value=${kind}]`).click();}
async function create(page:Page,kind:'word'|'markdown'='word'){await page.getByRole('button',{name:'新建文档',exact:true}).click();await selectKind(page,kind);await expect(page.getByRole('textbox',{name:'文档正文'})).toBeVisible();await expect(page.locator('#new-document')).toBeEnabled();return page.getByRole('textbox',{name:'文档正文'});}
async function ensureToolsOpen(page:Page){
  // Automatic pane decisions follow the native shell's resize animations. A
  // toggle observed as closed before that resize can be open by pointer-up.
  await expect.poll(()=>page.evaluate(()=>!document.getAnimations().some(animation=>
    animation.playState==='running'&&animation.effect?.getComputedTiming().iterations!==Infinity
  ))).toBe(true);
  // Dedicated interaction tests exercise pointer input. Here establish the
  // precondition in one task so resize observers cannot reverse the toggle.
  await page.locator('#toggle-ribbon').evaluate(button=>{
    if(document.getElementById('write-panel')?.dataset.ribbonOpen!=='true')(button as HTMLElement).click();
  });
  await expect(page.locator('#write-panel')).toHaveAttribute('data-ribbon-open','true');
  // A child can have a stable rectangle while its animated parent still clips
  // it. Wait for actual usable space before asking WebKit to scroll/click it.
  await expect.poll(()=>page.locator('#editor-tools').evaluate(element=>{
    const chrome=element.querySelector('.writing-chrome') as HTMLElement;
    return element.clientHeight>1&&element.clientHeight>=chrome.scrollHeight-1;
  })).toBe(true);
}
async function ensureRibbonOpen(page:Page){
  await expect(page.locator('#write-panel')).toHaveAttribute('data-panes-initialized','true');
  // Selecting a tool tab explicitly expands its page even if automatic layout
  // changes between the preceding observation and this user interaction.
  await ensureToolsOpen(page);
  await page.locator('#toolbar-home').click();
  await expect(page.locator('#write-panel')).toHaveAttribute('data-ribbon-open','true');
  await expect(page.locator('#writing-ribbon')).not.toHaveAttribute('inert','');
}

test('tray navigation is registered after the save gate and accepts only workspace pages',async({page})=>{
  await desktop(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.ready?.hasCloseGate)).toBe(true);
  expect(await page.evaluate(()=>(window as any).editorHarness.ready.listeners)).toEqual(expect.arrayContaining(['workproof-close-requested','workproof-quit-requested','workproof-tray-view']));
  await page.evaluate(()=>(window as any).editorHarness.listeners['workproof-tray-view']({payload:'settings'}));
  await expect(page.locator('body')).toHaveAttribute('data-view','settings');
  await page.evaluate(()=>(window as any).editorHarness.listeners['workproof-tray-view']({payload:'document'}));
  await expect(page.locator('body')).toHaveAttribute('data-view','settings');
  await page.evaluate(()=>(window as any).editorHarness.listeners['workproof-tray-view']({payload:'library'}));
  await expect(page.getByRole('button',{name:'新建文档',exact:true})).toBeVisible();
});
async function delayMarkdownRuntime(page:Page){
  let release!:()=>void,requested!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const requestStarted=new Promise<void>(resolve=>{requested=resolve;});
  await page.route('**/desktop-status/markdown-source-runtime.js*',async route=>{requested();await held;await route.fallback();});
  return {requestStarted,release};
}

test('CodeMirror loads only for Markdown source and reuses its runtime',async({page})=>{
  const requests:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/desktop-status/markdown-source-runtime.js'))requests.push(request.url());});
  await desktop(page);await expect(page.locator('#write-panel')).toHaveAttribute('data-panes-initialized','true');expect(requests).toEqual([]);
  const body=await create(page,'markdown');await body.fill('正文编辑无需源码组件');expect(requests).toEqual([]);
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toBeVisible();expect(requests).toHaveLength(1);
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(body).toBeVisible();await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toBeVisible();expect(requests).toHaveLength(1);
});

test('leaving the editor cancels a pending source open and reopening uses the latest document',async({page})=>{
  await desktop(page);const body=await create(page,'markdown');await body.fill('等待加载时的原稿');
  const delayed=await delayMarkdownRuntime(page);
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await delayed.requestStarted;
  await expect(page.locator('#toggle-source')).toHaveAttribute('aria-busy','true');await expect(body).toBeVisible();
  await page.locator('#tab-process').click();await page.locator('#tab-write').click();
  await body.focus();await body.press('ControlOrMeta+a');await body.press('Backspace');
  await expect(body).toHaveText('');await page.keyboard.insertText('加载期间更新后的正文');
  await expect(body).toHaveText('加载期间更新后的正文');
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/desktop-status/markdown-source-runtime.js'));
  delayed.release();await loaded;
  await page.evaluate(async()=>{await import(new URL('markdown-source-runtime.js',document.baseURI).href);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
  await expect(page.locator('#markdown-source-panel')).toBeHidden();await expect(page.locator('#markdown-source .cm-content')).toHaveCount(0);await expect(body).toHaveText('加载期间更新后的正文');
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toHaveText('加载期间更新后的正文');
});

test('tray quit saves while a source runtime is pending and prevents its late view from opening',async({page})=>{
  await desktop(page);const body=await create(page,'markdown');await body.click();await body.press('Control+a');await body.press('Backspace');await page.keyboard.insertText('退出前保留的正文');await expect(body).toContainText('退出前保留的正文');
  const delayed=await delayMarkdownRuntime(page);
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await delayed.requestStarted;
  await page.evaluate(()=>{(window as any).editorHarness.listeners['workproof-quit-requested']();});
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.windowActions)).toEqual(['quit']);
  expect(await page.evaluate(()=>(window as any).editorHarness.saves.at(-1).content.content[0].content[0].text)).toBe('退出前保留的正文');
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/desktop-status/markdown-source-runtime.js'));
  delayed.release();await loaded;
  await page.evaluate(async()=>{await import(new URL('markdown-source-runtime.js',document.baseURI).href);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
  await expect(page.locator('#markdown-source .cm-content')).toHaveCount(0);await expect(page.locator('#markdown-source-panel')).toBeHidden();await expect(page.locator('main')).toHaveAttribute('inert','');
});

test('a delayed source request cannot replace a different document opened from the library',async({page})=>{
  await desktop(page);const body=await create(page,'markdown');await body.fill('第一份文档的正文');
  const delayed=await delayMarkdownRuntime(page);await ensureToolsOpen(page);await page.locator('#toggle-source').click();await delayed.requestStarted;
  await page.locator('#back-library').click();await create(page);await body.fill('第二份文档保留自己的内容');
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/desktop-status/markdown-source-runtime.js'));
  delayed.release();await loaded;
  await page.evaluate(async()=>{await import(new URL('markdown-source-runtime.js',document.baseURI).href);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
  await expect(body).toHaveText('第二份文档保留自己的内容');await expect(page.locator('#markdown-source .cm-content')).toHaveCount(0);await expect(page.locator('#toggle-source')).toBeHidden();
});

test('a failed source entry request preserves text and can be retried without reloading the app',async({page})=>{
  await desktop(page);const body=await create(page,'markdown');await body.fill('网络失败也保留正文');
  let attempts=0;
  await page.route('**/desktop-status/markdown-source-runtime.js*',route=>++attempts===1?route.abort('failed'):route.fallback());
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(page.locator('#message')).toContainText('源码编辑器暂未加载');await expect(page.locator('#toggle-source')).toBeEnabled();await expect(body).toHaveText('网络失败也保留正文');
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toHaveText('网络失败也保留正文');expect(attempts).toBe(2);
});

test('real Tiptap edits and formats persist and reopen with independent navigation',async({page},info)=>{
  await desktop(page);const body=await create(page);
  await page.getByLabel('文档名称',{exact:true}).fill('学术写作记录');
  await body.fill('这是一份写作笔记。');await body.press('End');await body.pressSequentially(' hello world');await body.press('Enter');await body.pressSequentially('second paragraph');await body.press('Backspace');
  await ensureRibbonOpen(page);await body.press('Control+a');await page.getByRole('button',{name:'加粗',exact:true}).click();
  await expect(body.locator('strong')).not.toHaveCount(0);
  await expect(page.locator('#save-state')).toHaveText('已保存到本机');
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.saves.flatMap((s:any)=>s.actions).map((a:any)=>a.kind))).toEqual(expect.arrayContaining(['edit','format','space','enter','backspace']));
  await page.getByRole('tab',{name:'过程',exact:true}).click();await expect(page.locator('#version-flow button')).not.toHaveCount(0);
  await expect(page.locator('#flow-detail')).toBeHidden();
  const actionNode=page.locator('#action-route button').first();
  await actionNode.click();
  await expect(actionNode).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#flow-detail')).toBeVisible();
  await expect(page.locator('#flow-detail .action-details')).toHaveCount(1);
  await expect(page.locator('.workspace-nav [aria-current=page]')).toHaveCount(1);
  await expect(page.locator('.workspace-nav [aria-current=page] .nav-label')).toHaveText('我的文档');
  await page.locator('#version-flow button').first().click();await expect(page.locator('#history-version-label')).toHaveText('版本 1');await expect(page.locator('#history-preview')).not.toContainText('second');
  await page.screenshot({path:info.outputPath('fluent-editor-process.png')});
  await page.reload();await page.getByRole('button',{name:'继续编辑 学术写作记录'}).click();
  await expect(body).toContainText('这是一份写作笔记。');await expect(body.locator('strong')).not.toHaveCount(0);
  await page.screenshot({path:info.outputPath('fluent-editor-write.png')});
});

test('failed save keeps the same request and all pending edits before retry',async({page})=>{
  await desktop(page);const body=await create(page);
  await page.evaluate(()=>(window as any).editorHarness.failNext=true);
  await body.fill('失败后仍要保留的文字');
  await expect(page.locator('#save-state')).toContainText('未保存');
  await expect(body).toContainText('失败后仍要保留的文字');
  const first=await page.evaluate(()=>(window as any).editorHarness.saves.at(-1).request_id);
  await page.locator('#save-document').click();await expect(page.locator('#save-state')).toHaveText('已保存到本机');
  const retried=await page.evaluate(id=>(window as any).editorHarness.saves.filter((s:any)=>s.request_id===id),first);
  expect(retried).toHaveLength(2);expect(retried[1]).toEqual(retried[0]);
  await page.reload();await page.getByRole('button',{name:'继续编辑 未命名文档'}).click();await expect(body).toContainText('失败后仍要保留的文字');
});

test('undo redo and cancelled export preserve the document and do not show a certificate',async({page})=>{
  await desktop(page);const body=await create(page);
  await body.fill('初稿');await body.press('End');await body.pressSequentially(' changed');
  await ensureRibbonOpen(page);await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('button',{name:'重做',exact:true})).toBeEnabled();await page.getByRole('button',{name:'重做',exact:true}).click();
  await page.locator('#export-document').click();await expect(page.locator('#export-document')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).editorHarness.exports)).toBe(1);
  await expect(page.locator('#certificate-result')).toBeHidden();await expect(body).toContainText('changed');
  const kinds=await page.evaluate(()=>(window as any).editorHarness.saves.flatMap((s:any)=>s.actions).map((a:any)=>a.kind));expect(kinds).toEqual(expect.arrayContaining(['undo','redo']));
});

test('settings use upright icons and equal window buttons with reduced motion',async({page},info)=>{
  await desktop(page);await page.evaluate(()=>document.body.dataset.platform='windows');
  await page.setViewportSize({width:1280,height:800});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('fluent-radio[value=light]').click();
  await page.locator('main').evaluate(node=>node.scrollTop=0);
  await page.screenshot({path:info.outputPath('fluent-settings-light.png')});
  await page.locator('fluent-radio[value=dark]').click();
  await expect(page.locator('#settings-page .settings-group')).toHaveCount(6);
  await expect(page.locator('#settings-page .settings-surface')).toHaveCount(5);
  await expect(page.locator('#app-version')).toHaveText('0.1.0');
  await expect(page.locator('#app-build')).toHaveText('1234 · 0123456789ab');
  await expect(page.locator('#app-build')).toHaveAttribute('title','0123456789abcdef0123456789abcdef01234567');
  await expect(page.locator('#app-built-at')).toHaveAttribute('title',/^2026-11-11T.*Z$/);
  await expect(page.locator('#app-built-at')).not.toHaveText(/正在读取|暂未读取/);
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('#reduce-motion').click();await expect(page.locator('html')).toHaveAttribute('data-reduce-motion','true');
  expect(await page.locator('#settings-page').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
  const sizes=await page.locator('.window-controls button').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));expect(sizes).toEqual([{w:46,h:36},{w:46,h:36},{w:46,h:36}]);
  expect(await page.locator('.workspace-nav .wp-icon svg').first().evaluate(n=>getComputedStyle(n).transform)).toBe('none');
  for(const width of [1280,960,420,360]){
    await page.setViewportSize({width,height:780});
    if(width<640&&!await page.locator('body').evaluate(n=>n.classList.contains('compact-nav')))await page.locator('#collapse-nav').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.locator('#settings-page').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    expect(await page.locator('#appearance-label').evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(140);
    await page.locator('main').evaluate(node=>node.scrollTop=0);
    if(width===420)await page.screenshot({path:info.outputPath('fluent-settings-narrow.png')});
  }
  await page.setViewportSize({width:1280,height:800});await page.screenshot({path:info.outputPath('fluent-settings-dark.png')});
});

test('editor back command stays visible and saves before returning to the full-height library',async({page})=>{
  await desktop(page);await expect(page.locator('body > footer')).toBeHidden();
  const body=await create(page);
  await expect(page.locator('body > footer')).toBeVisible();
  await page.setViewportSize({width:420,height:780});
  const back=page.getByRole('button',{name:'返回我的文档',exact:true});
  await expect(back).toBeVisible();
  expect(await back.evaluate(node=>{const r=node.getBoundingClientRect();return r.width>=32&&r.height>=32&&r.left>=0&&r.right<=innerWidth;})).toBe(true);
  await body.fill('返回时保留的正文');
  await page.evaluate(()=>(window as any).editorHarness.failNext=true);
  await back.click();await expect(page.locator('#save-state')).toContainText('未保存');
  await expect(body).toBeVisible();
  await back.click();await expect(page.locator('body')).toHaveAttribute('data-view','library');
  await expect(page.locator('body > footer')).toBeHidden();
  await page.getByRole('button',{name:'继续编辑 未命名文档',exact:true}).click();
  await expect(body).toHaveText('返回时保留的正文');
});

test('verification is directly mounted in the client and accepts dropped files',async({page})=>{
  await desktop(page);await page.getByRole('button',{name:'文件核验',exact:true}).click();await page.locator('#verify').click();
  await expect(page.getByRole('heading',{name:'作品核验',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'开始核验',exact:true})).toContainText('开始核验');
  await expect(page.getByRole('button',{name:'清空文件',exact:true})).toContainText('清空文件');
  await expect(page.locator('#verifier-frame')).toHaveCount(0);await expect(page.locator('.workspace-nav')).toBeVisible();
  await page.locator('.nv-file').first().evaluate(element=>{const transfer=new DataTransfer();transfer.items.add(new File(['正文'],'作品.md',{type:'text/markdown'}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));});
  await expect(page.locator('.nv-file').first()).toContainText('作品.md');
  await expect(page.getByRole('button',{name:'开始核验',exact:true})).toBeDisabled();
});

test('offline Word module exports real DOCX and imports it through the existing converter',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('离线 Word 转换测试');
  await page.evaluate(()=>{const w=window as any,original=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(c:string,a:any)=>{if(c==='editor_export')w.wordBytes=a.docx;return original(c,a);};});
  await page.locator('#export-document').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).wordBytes?.length||0),{timeout:25000}).toBeGreaterThan(100);
  const bytes=await page.evaluate(()=>(window as any).wordBytes);expect(bytes.slice(0,4)).toEqual([80,75,3,4]);
  await expect(page.locator('#export-document')).toBeEnabled();await page.locator('.workspace-nav [data-view=library]').click();
  await page.locator('#word-file').setInputFiles({name:'往返导入.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(bytes)});
  await expect(body).toContainText('离线 Word 转换测试',{timeout:25000});await expect(page.getByLabel('文档名称',{exact:true})).toHaveValue('往返导入');
  await expect(page.locator('#save-state')).toHaveText('已保存到本机');
});

test('table pagebreak code rendering and non-content transactions are recorded',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('结构编辑');await body.press('End');await body.press('Enter');
  await ensureRibbonOpen(page);await page.locator('[data-ribbon=insert]').click();await page.getByRole('button',{name:'插入表格',exact:true}).click();await expect(body.locator('table')).toHaveCount(1);await page.getByRole('button',{name:'删除表格',exact:true}).click();
  await page.getByRole('button',{name:'分页符',exact:true}).click();await expect(body.locator('[data-page-break]')).toHaveCount(1);
  await body.press('ArrowDown');await page.getByRole('button',{name:'代码块',exact:true}).click();await expect(body.locator('pre')).toHaveCount(1);
  await body.press('ArrowLeft');await page.locator('#save-document').click();
  const kinds=await page.evaluate(()=>(window as any).editorHarness.saves.flatMap((s:any)=>s.actions).map((a:any)=>a.kind));expect(kinds).toEqual(expect.arrayContaining(['keyboard','selection','format']));
});

test('writing panes follow window space and preserve manual choices after reopening',async({page})=>{
  await page.setViewportSize({width:1600,height:900});
  await desktop(page);await create(page);
  const workspace=page.locator('#write-panel');
  await expect(workspace).toHaveAttribute('data-panes-initialized','true');
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  await expect.poll(()=>page.locator('#document-workspace').evaluate(element=>{const frame=element.getBoundingClientRect(),canvas=element.querySelector('.editor-canvas')!.getBoundingClientRect();return canvas.width*canvas.height/(frame.width*frame.height);})).toBeGreaterThanOrEqual(.7);
  await page.setViewportSize({width:760,height:800});
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  await expect(page.locator('#action-inspector')).toHaveAttribute('inert','');
  await ensureToolsOpen(page);await page.locator('#toggle-inspector').click();
  await expect(workspace).toHaveAttribute('data-inspector-open','true');
  await expect(workspace).toHaveClass(/pane-overlay-open/);
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  await page.setViewportSize({width:1600,height:900});
  await expect(workspace).toHaveAttribute('data-inspector-open','true');
  await ensureToolsOpen(page);await page.locator('#toggle-inspector').click();
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  await page.reload();
  await page.getByRole('button',{name:'继续编辑 未命名文档'}).click();
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  const ribbonBeforeFocus=await workspace.getAttribute('data-ribbon-open');
  await ensureToolsOpen(page);await page.locator('#focus-writing').click();
  await expect(workspace).toHaveAttribute('data-ribbon-open','false');
  await expect(workspace).toHaveAttribute('data-outline-open','false');
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveAttribute('data-ribbon-open',ribbonBeforeFocus!);
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
});

test('reduced motion removes pane animation and collapsing a focused pane restores keyboard focus',async({page})=>{
  await page.setViewportSize({width:1600,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await desktop(page);await create(page);
  if(await page.locator('#write-panel').getAttribute('data-inspector-open')!=='true'){await ensureToolsOpen(page);await page.locator('#toggle-inspector').click();}
  await ensureRibbonOpen(page);
  expect(await page.locator('#writing-ribbon').evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.locator('#view-process').focus();
  await page.evaluate(()=>document.getElementById('toggle-inspector')!.click());
  await expect(page.locator('#toggle-inspector')).toBeFocused();
  await expect(page.locator('#action-inspector')).toHaveAttribute('aria-hidden','true');
  await page.locator('#toggle-ribbon').click();
  await expect(page.locator('#writing-ribbon')).toHaveAttribute('inert','');
  await page.locator('#toggle-ribbon').click();
  await expect(page.getByRole('button',{name:'加粗',exact:true})).toBeVisible();
});

test('Markdown keeps exact source and its type after reopening',async({page})=>{
  await desktop(page);const body=await create(page,'markdown');
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();const source=page.locator('#markdown-source .cm-content');
  await source.fill('# 标题\n\n保留   源码空格');await page.locator('#save-document').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.saves.at(-1)?.content.attrs?.markdownSource)).toBe('# 标题\n\n保留   源码空格');
  await page.locator('#back-library').click();await page.getByRole('button',{name:'继续编辑 未命名文档',exact:true}).click();
  await expect(page.locator('#document-kind')).toHaveText('Markdown');await expect(body.locator('h1')).toHaveText('标题');
  await expect(page.locator('[data-mode]')).toHaveCount(0);
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(source).toContainText('保留   源码空格');
});

test('offline Word bridge preserves headings lists tables and supported rich marks',async({page})=>{
  await desktop(page);
  const result=await page.evaluate(async()=>{
    const convert=(action:string,data:any)=>new Promise<any>((resolve,reject)=>{
      const worker=new Worker(new URL('word-worker.js',document.baseURI),{type:'module'});
      const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Word bridge timeout'));},20000);
      worker.onmessage=event=>{if(event.data.ready){worker.postMessage({action,...data});return;}clearTimeout(timeout);worker.terminate();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.result);};
      worker.onerror=event=>{clearTimeout(timeout);worker.terminate();reject(new Error(event.message));};
    });
    const paragraph=(text:string)=>({type:'paragraph',content:[{type:'text',text}]});
    const fixture={type:'doc',content:[
      {type:'heading',attrs:{level:2},content:[{type:'text',text:'标题必须保留'}]},
      {type:'bulletList',content:[{type:'listItem',content:[paragraph('项目符号正文')]},{type:'listItem',content:[paragraph('第二条内容')]}]},
      {type:'orderedList',content:[{type:'listItem',content:[paragraph('编号列表正文')]}]},
      {type:'blockquote',content:[paragraph('引用内容')]},
      {type:'codeBlock',content:[{type:'text',text:'const preserved = true;'}]},
      {type:'paragraph',content:[{type:'text',text:'格式化文字',marks:[{type:'textStyle',attrs:{fontFamily:'Arial',fontSize:'18pt',color:'#c00000'}},{type:'highlight',attrs:{color:'#ffff00'}},{type:'subscript'}]},{type:'text',text:'可访问链接',marks:[{type:'link',attrs:{href:'https://example.com/workproof'}}]}]},
      {type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',content:[paragraph('表头不能丢')]},{type:'tableCell',content:[paragraph('单元格正文')]}]}]}
    ]};
    const bytes=await convert('export',{content:fixture});
    return {bytes:Array.from(bytes as Uint8Array),content:await convert('import',{bytes:Uint8Array.from(bytes).buffer})};
  });
  const allNodes:any[]=[];const collect=(node:any)=>{allNodes.push(node);for(const child of node.content||[])collect(child);};collect(result.content);
  const text=allNodes.filter(n=>n.type==='text').map(n=>n.text).join('');
  for(const expected of ['标题必须保留','项目符号正文','第二条内容','编号列表正文','引用内容','const preserved = true;','表头不能丢','单元格正文'])expect(text).toContain(expected);
  expect(allNodes.some(n=>n.type==='heading'&&n.attrs.level===2)).toBe(true);
  expect(allNodes.some(n=>n.type==='bulletList')).toBe(true);expect(allNodes.some(n=>n.type==='orderedList')).toBe(true);
  const rich=allNodes.find(n=>n.text==='格式化文字');
  expect(rich.marks).toEqual(expect.arrayContaining([{type:'textStyle',attrs:{fontFamily:'Arial',fontSize:'18pt',color:'#c00000'}},{type:'highlight',attrs:{color:'#ffff00'}},{type:'subscript'}]));
  expect(allNodes.find(n=>n.text==='可访问链接').marks).toEqual(expect.arrayContaining([expect.objectContaining({type:'link',attrs:expect.objectContaining({href:'https://example.com/workproof'})})]));
  await page.locator('#word-file').setInputFiles({name:'丰富格式往返.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(result.bytes)});
  await expect(page.locator('#tiptap-editor h2')).toHaveText('标题必须保留',{timeout:25000});
  await expect(page.locator('#tiptap-editor ul')).toBeVisible();await expect(page.locator('#tiptap-editor ol')).toBeVisible();
});

test('document type controls pagination and source access',async({page})=>{
  await desktop(page);const body=await create(page);
  await expect(page.locator('#export-format')).toHaveCount(0);
  await page.locator('#export-document').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.lastExport?.docx?.slice(0,4))).toEqual([80,75,3,4]);
  expect(await page.evaluate(()=>(window as any).editorHarness.lastExport.markdown)).toBeNull();
  await expect(page.locator('#document-kind')).toHaveText('Word');
  await expect(page.locator('#toggle-source')).toBeHidden();
  await ensureRibbonOpen(page);await page.locator('[data-ribbon=layout]').click();
  const pagination=page.locator('[data-command=pages]');
  await pagination.click();await expect(pagination).toHaveAttribute('aria-pressed','false');
  await page.locator('#back-library').click();await create(page,'markdown');
  await page.locator('#export-document').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.lastExport?.markdown)).toBe('');
  expect(await page.evaluate(()=>(window as any).editorHarness.lastExport.docx)).toBeNull();
  await expect(body).toHaveAttribute('rm-pagination-disabled','');
  await expect(pagination).toBeDisabled();await expect(page.locator('#toggle-source')).toBeVisible();
  await page.locator('#back-library').click();await create(page);
  await expect(page.locator('#document-kind')).toHaveText('Word');
  await expect(pagination).toBeEnabled();await expect(pagination).toHaveAttribute('aria-pressed','false');
});

test('lossless Markdown tables tasks and embedded images remain editable and export their exact source',async({page})=>{
  await desktop(page);
  const text='# 可编辑 Markdown\n\n| 项目 | 状态 |\n| --- | --- |\n| 表格正文 | 完成 |\n\n- [ ] 待办事项\n- [x] 已完成事项\n\n![小图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yoAAAAAASUVORK5CYII=)';
  await page.locator('#markdown-file').setInputFiles({name:'无损编辑.md',mimeType:'text/markdown',buffer:Buffer.from(text)});
  const body=page.locator('#tiptap-editor .tiptap');await expect(body.locator('table')).toHaveCount(1);await expect(body.getByRole('checkbox')).toHaveCount(2);await expect(body.locator('img')).toHaveCount(1);
  await expect.poll(()=>body.locator('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();const source=page.locator('#markdown-source .cm-content');await expect(source).toBeVisible();await expect(source).toContainText('待办事项');
  await source.press('ControlOrMeta+End');await source.press('Enter');await source.pressSequentially('源码继续编辑');await ensureToolsOpen(page);await page.locator('#toggle-source').click();await expect(body).toContainText('源码继续编辑');
  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(command:string,args:any)=>{if(command==='editor_export')w.exportedMarkdown=args.markdown;return invoke(command,args);};});
  await page.locator('#export-document').click();await expect.poll(()=>page.evaluate(()=>(window as any).exportedMarkdown)).toBe(text+'\n源码继续编辑');
});

test('closing freezes Markdown and waits for durable save before issuing the native close',async({page})=>{
  await desktop(page);const body=await create(page,'markdown');
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();
  await page.evaluate(()=>{
    const w=window as any,invoke=w.__TAURI__.core.invoke;let blockNext=true;
    w.__TAURI__.core.invoke=(command:string,args:any)=>{
      if(command==='editor_save'&&blockNext){blockNext=false;return new Promise(resolve=>{w.releaseCloseSave=()=>resolve(invoke(command,args));});}
      return invoke(command,args);
    };
  });
  await page.locator('#markdown-source .cm-content').fill('关闭时必须保存的源码');
  await page.evaluate(()=>{(window as any).editorHarness.listeners['workproof-close-requested']();});
  await expect(page.locator('main')).toHaveAttribute('inert','');
  await expect(page.locator('#tiptap-editor .tiptap')).toHaveAttribute('contenteditable','false');
  await expect(page.locator('#markdown-source .cm-content')).toHaveAttribute('contenteditable','false');
  expect(await page.evaluate(()=>(window as any).editorHarness.windowActions)).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseCloseSave)).toBe('function');
  await page.evaluate(()=>(window as any).releaseCloseSave());
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.windowActions)).toEqual(['close']);
  await expect(page.locator('main')).toHaveAttribute('inert','');
  await expect(page.locator('#markdown-source .cm-content')).toHaveAttribute('contenteditable','false');
  expect(await page.evaluate(()=>(window as any).editorHarness.saves.at(-1).content.attrs.markdownSource)).toBe('关闭时必须保存的源码');
});

test('failed save blocks tray quit and restores editing before a successful quit retry',async({page})=>{
  await desktop(page);const body=await create(page);await body.click();await body.pressSequentially('退出前必须保存');
  await page.evaluate(()=>{const h=(window as any).editorHarness;h.failNext=true;h.listeners['workproof-quit-requested']();});
  await expect(page.locator('#message')).toContainText('文档尚未保存');
  await expect(body).toHaveAttribute('contenteditable','true');
  expect(await page.evaluate(()=>(window as any).editorHarness.windowActions)).toEqual([]);
  await page.evaluate(()=>{(window as any).editorHarness.listeners['workproof-quit-requested']();});
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.windowActions)).toEqual(['quit']);
  expect(await page.evaluate(()=>(window as any).editorHarness.saves.at(-1).content.content[0].content[0].text)).toBe('退出前必须保存');
});

test('library defers the editor runtime until the first document and reuses it across documents',async({page})=>{
  const runtimeRequests:string[]=[];
  page.on('request',request=>{if(/\/desktop-status\/chunks\/editor-runtime-[A-Za-z0-9_-]+\.js$/.test(new URL(request.url()).pathname))runtimeRequests.push(request.url());});
  await desktop(page);
  await expect(page.locator('#write-panel')).toHaveAttribute('data-panes-initialized','true');
  expect(runtimeRequests).toEqual([]);
  const body=await create(page);await body.fill('首次打开后加载完整编辑能力');
  expect(runtimeRequests).toHaveLength(1);
  await page.locator('#save-document').click();
  await page.locator('.workspace-nav [data-view=library]').click();
  await create(page);await expect(body).toBeVisible();
  expect(runtimeRequests).toHaveLength(1);
});

test('ribbon keyboard navigation exposes the selected page and returns focus from controls',async({page})=>{
  await desktop(page);await create(page);
  await ensureRibbonOpen(page);const home=page.locator('#toolbar-home'),insert=page.locator('#toolbar-insert'),layout=page.locator('#toolbar-layout');
  await home.focus();await home.press('ArrowRight');await expect(insert).toBeFocused();await expect(insert).toHaveAttribute('aria-selected','true');await expect(page.locator('#ribbon-insert')).toBeVisible();
  await insert.press('End');await expect(layout).toBeFocused();await expect(page.locator('#ribbon-layout')).toBeVisible();
  await layout.press('Home');await expect(home).toBeFocused();await home.press('ArrowDown');
  expect(await page.locator('#ribbon-home').evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(home).toBeFocused();
});

test('toolbar follows cursor formats and represents mixed font sizes truthfully',async({page})=>{
  await desktop(page);const body=await create(page);await ensureRibbonOpen(page);await body.fill('大号文字');await body.press('ControlOrMeta+a');
  await selectChoice(page,'#font-size','18pt');await body.press('End');await selectChoice(page,'#font-size','12pt');await body.pressSequentially('小号文字');
  await body.press('ControlOrMeta+a');await expect(page.locator('#font-size')).toHaveValue('__mixed');await expect(page.locator('#font-size option:checked')).toHaveText('多种格式');await expect(page.locator('[data-native-select=font-size] [slot=control]')).toContainText('多种格式');
  for(const [text,size] of [['大号文字','18pt'],['小号文字','12pt']]){
    await body.evaluate((root,target)=>{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode,offset=node.textContent?.indexOf(target)??-1;
        if(offset<0)continue;
        getSelection()!.collapse(node,offset+1);
        return;
      }
      throw new Error(`Missing formatted text: ${target}`);
    },text);
    await expect(page.locator('#font-size')).toHaveValue(size);
  }
});

test('link dialog inserts edits validates and removes links while preserving their visible text',async({page})=>{
  await desktop(page);const body=await create(page);await body.click();await body.pressSequentially('需要链接的正文');await body.press('ControlOrMeta+a');await body.press('ControlOrMeta+k');
  await expect(page.locator('#link-dialog')).toBeVisible();await page.locator('#link-url').fill('https://example.com/first');await page.locator('#link-confirm').click();await expect(body).toBeFocused();
  await expect(body.locator('a')).toHaveAttribute('href','https://example.com/first');await expect(body.locator('a')).toHaveText('需要链接的正文');
  await body.locator('a').click({position:{x:5,y:5}});await body.press('ControlOrMeta+k');await expect(page.locator('#link-dialog')).toBeVisible();await expect(page.locator('#link-url')).toHaveValue('https://example.com/first');
  await page.locator('#link-url').fill('javascript:alert(1)');await page.locator('#link-confirm').click();await expect(page.locator('#link-dialog')).toBeVisible();await expect(body.locator('a')).toHaveAttribute('href','https://example.com/first');
  await page.locator('#link-url').fill('https://example.com/updated');await page.locator('#link-url').press('Enter');await expect(page.locator('#link-dialog')).not.toBeVisible();await expect(body.locator('a')).toHaveAttribute('href','https://example.com/updated');
  await body.locator('a').click({position:{x:5,y:5}});await body.press('ControlOrMeta+k');await page.locator('#link-remove').click();await expect(body.locator('a')).toHaveCount(0);await expect(body).toHaveText('需要链接的正文');
});

test('navigation drawer closes on Escape and manual rail choice survives reopening',async({page})=>{
  await page.setViewportSize({width:390,height:820});await desktop(page);
  await expect(page.locator('body')).toHaveClass(/compact-nav/);
  await page.locator('#collapse-nav').click();await expect(page.locator('body')).toHaveClass(/nav-drawer-open/);
  await expect(page.locator('#nav-dismiss')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.locator('#nav-dismiss')).toBeHidden();await expect(page.locator('#collapse-nav')).toBeFocused();
  await page.locator('#collapse-nav').click();await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.locator('body')).not.toHaveClass(/nav-drawer-open/);
  await selectChoice(page,'#navigation-mode','auto');await page.setViewportSize({width:1280,height:820});
  await expect(page.locator('body')).not.toHaveClass(/compact-nav/);
  await selectChoice(page,'#navigation-mode','closed');await page.reload();
  await expect(page.locator('body')).toHaveClass(/compact-nav/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('icon command tooltips explain their action and shortcut for keyboard users',async({page})=>{
  await desktop(page);await create(page);await page.locator('#save-document').focus();
  const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();await expect(tooltip).toContainText('保存');await expect(tooltip).toContainText('Ctrl+S');
  await expect(page.locator('#save-document')).toHaveAttribute('aria-describedby','workproof-command-tooltip');
  await page.keyboard.press('Escape');await expect(tooltip).toBeHidden();
});

test('native verification shares client theme and closes without leaving stale results',async({page})=>{
  await desktop(page);await page.getByRole('button',{name:'文件核验',exact:true}).click();await page.locator('#verify').click();
  const root=page.locator('.native-verifier');await expect(root).toBeVisible();
  const light=await root.evaluate(node=>getComputedStyle(node).color);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('fluent-radio[value=dark]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect.poll(()=>root.evaluate(node=>getComputedStyle(node).color)).not.toBe(light);
  await page.locator('#reduce-motion').click();await expect(page.locator('html')).toHaveAttribute('data-reduce-motion','true');
  await page.getByRole('button',{name:'文件核验',exact:true}).click();
  await page.getByRole('button',{name:'关闭本次核验'}).click();await expect(root).toHaveCount(0);await expect(page.locator('#verify')).toBeFocused();
});

test('encrypted report saves through native IPC, includes every record and certificate, and opens offline without the original artifact',async({page,context},testInfo)=>{
  test.setTimeout(60000);let generated='',savedCertificate='';
  await page.exposeFunction('nativeReportSave',({html,certificateId}:{html:string;certificateId:string})=>{
    generated=html;savedCertificate=certificateId;const bytes=Buffer.from(html,'utf8');
    return {cancelled:false,file_name:'WorkProof-report.html',md5:createHash('md5').update(bytes).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  });
  await desktop(page);await page.getByRole('button',{name:'文件核验',exact:true}).click();await page.locator('#verify').click();
  await page.getByLabel('1 · 最终作品',{exact:true}).setInputFiles('apps/verifier/public/demo/essay.md');
  await page.getByLabel('2 · WorkProof 证书',{exact:true}).setInputFiles('apps/verifier/public/demo/essay.md.wproof');
  await page.getByRole('button',{name:'开始核验',exact:true}).click();await expect(page.getByRole('heading',{name:'文件与证书一致',exact:true})).toBeVisible({timeout:20000});
  await page.getByRole('navigation',{name:'核验结果视图'}).getByRole('button',{name:'证书信息',exact:true}).click();
  await page.getByRole('button',{name:'下载加密 HTML 报告',exact:true}).click();const dialog=page.getByRole('dialog',{name:'保存完整核验报告'});
  const password='WorkProof-test-report-secret-123';await dialog.getByLabel('设置报告密码',{exact:true}).fill(password);await dialog.getByLabel('再次输入报告密码',{exact:true}).fill(password);
  await dialog.getByRole('button',{name:'生成并保存',exact:true}).click();await expect(dialog.locator('.report-export-saved')).toContainText('HTML 与配套校验文件已保存',{timeout:20000});
  const bytes=Buffer.from(generated,'utf8');await expect(dialog.locator('.report-export-saved')).toContainText(createHash('md5').update(bytes).digest('hex'));
  expect(generated).not.toContain(password);const rawProof=fs.readFileSync('apps/verifier/public/demo/essay.md.wproof'),original=JSON.parse(rawProof.toString());expect(generated).not.toContain(original.signature);
  const envelopeText=generated.match(/id="report-envelope">([^<]+)<\/script>/)![1],pack=JSON.parse(envelopeText);
  expect(createHash('sha256').update(Buffer.from(pack.viewer,'base64')).digest('hex')).toBe(pack.viewer_sha256);
  const cipher=Buffer.from(pack.ciphertext,'base64'),key=pbkdf2Sync(password,Buffer.from(pack.salt,'base64'),600000,32,'sha256'),decoder=createDecipheriv('aes-256-gcm',key,Buffer.from(pack.iv,'base64'));
  decoder.setAAD(Buffer.from('workproof-encrypted-report/1:'+pack.viewer_sha256));decoder.setAuthTag(cipher.subarray(-16));
  const model=JSON.parse(Buffer.concat([decoder.update(cipher.subarray(0,-16)),decoder.final()]).toString('utf8'));
  expect(model.result.proof.records).toEqual(original.records);expect(model.result.certificateId).toBe(savedCertificate);expect(Buffer.from(model.certificate.base64,'base64')).toEqual(rawProof);
  expect(Object.keys(model.artifact).sort()).toEqual(['bytes','name','type']);expect(model.metadata.status).toBe('not_run');
  fs.writeFileSync(testInfo.outputPath('encrypted-report.html'),generated);
  const viewer=await context.newPage();await viewer.route('**/report-output.html',route=>route.fulfill({contentType:'text/html',body:generated}));await viewer.goto(new URL('/report-output.html',page.url()).href);
  await viewer.getByLabel('报告密码',{exact:true}).fill('incorrect-password');await viewer.getByRole('button',{name:'打开报告',exact:true}).click();await expect(viewer.getByRole('status')).toContainText('密码不正确');
  const requests:string[]=[];viewer.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await viewer.getByLabel('报告密码',{exact:true}).fill(password);await viewer.getByRole('button',{name:'打开报告',exact:true}).click();await expect(viewer.getByRole('heading',{name:'作品核验报告',exact:true})).toBeVisible({timeout:20000});
  await expect(viewer.locator('.chart-card')).toHaveCount(10);await expect(viewer.locator('#report-records')).toContainText(`共 ${original.records.length.toLocaleString()} 条`);await expect(viewer.locator('#report-files')).toContainText('原作品另附');await expect(viewer.locator('#report-metadata')).toContainText('文件属性检查：未执行');expect(requests).toEqual([]);
  const proofDownload=viewer.waitForEvent('download');await viewer.getByRole('button',{name:'下载原始证书',exact:true}).click();expect(fs.readFileSync((await (await proofDownload).path())!)).toEqual(rawProof);
  await viewer.screenshot({path:testInfo.outputPath('decrypted-report.png'),fullPage:true});
  const changed=Buffer.from(cipher);changed[changed.length-1]^=1;const tampered=generated.replace(envelopeText,JSON.stringify({...pack,ciphertext:changed.toString('base64')}));expect(createHash('md5').update(tampered).digest('hex')).not.toBe(createHash('md5').update(bytes).digest('hex'));
  await viewer.route('**/report-changed.html',route=>route.fulfill({contentType:'text/html',body:tampered}));await viewer.goto(new URL('/report-changed.html',page.url()).href);await viewer.getByLabel('报告密码',{exact:true}).fill(password);await viewer.getByRole('button',{name:'打开报告',exact:true}).click();await expect(viewer.getByRole('status')).toContainText('报告已损坏');await expect(viewer.locator('#report-root')).toHaveCount(0);await viewer.close();
});

test('native verification uses real Wasm, renders all report views and rejects a changed artifact',async({page},testInfo)=>{
  const certificateSaves:any[]=[];await page.exposeFunction('nativeCertificateSave',(args:any)=>{
    certificateSaves.push(args);if(certificateSaves.length===1)return {cancelled:true};
    const bytes=Buffer.from(args.certificate);return {cancelled:false,file_name:'original-copy.wproof',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source_certificate_id:args.certificateId};
  });
  await desktop(page);await page.getByRole('button',{name:'文件核验',exact:true}).click();await page.locator('#verify').click();
  await page.getByLabel('1 · 最终作品', {exact:true}).setInputFiles('apps/verifier/public/demo/essay.md');
  await page.getByLabel('2 · WorkProof 证书', {exact:true}).setInputFiles('apps/verifier/public/demo/essay.md.wproof');
  await page.getByRole('button',{name:'开始核验',exact:true}).click();
  await expect(page.getByRole('heading',{name:'文件与证书一致',exact:true})).toBeVisible({timeout:20000});
  await expect(page.getByRole('heading',{name:'编辑过程检验单',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'保存原始证书',exact:true}).click();await expect(page.locator('.native-verifier')).toContainText('已取消保存，可以重新选择位置。');
  await page.getByRole('button',{name:'保存原始证书',exact:true}).click();await expect(page.locator('.native-verifier')).toContainText('原始证书已保存：original-copy.wproof。');
  expect(certificateSaves).toHaveLength(2);expect(Buffer.from(certificateSaves[1].certificate)).toEqual(fs.readFileSync('apps/verifier/public/demo/essay.md.wproof'));
  expect(certificateSaves[1].sha256).toBe(createHash('sha256').update(Buffer.from(certificateSaves[1].certificate)).digest('hex'));
  await expect(page.getByRole('navigation',{name:'核验结果视图'}).getByRole('button',{name:'检验单',exact:true})).toContainText('检验单');
  await expect(page.locator('.nv-tabs [icon-only]')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('native-verification-report.png')});
  await page.getByRole('navigation',{name:'核验结果视图'}).getByRole('button',{name:'统计图',exact:true}).click();
  await expect(page.locator('.verification-chart')).toBeVisible();
  await page.getByRole('combobox',{name:'选择统计图',exact:true}).click();await page.getByRole('option',{name:'新增与删除',exact:true}).click();await expect(page.locator('#verification-charts h3')).toHaveText('新增与删除');await page.locator('#verification-charts').screenshot({path:testInfo.outputPath('verified-chart-legend.png')});
  await page.getByRole('navigation',{name:'核验结果视图'}).getByRole('button',{name:'过程回放',exact:true}).click();
  const replay=page.getByRole('region',{name:'过程回放',exact:true});await expect(replay).toContainText('证书不含历史正文');await expect(replay.getByRole('button',{name:'播放过程',exact:true}).locator('svg')).toBeVisible();
  const position=replay.getByRole('slider',{name:'核验过程回放位置'});await expect(position).toHaveValue('0');
  const last=await position.getAttribute('max');await position.fill(last!);await expect(replay.getByRole('button',{name:'下一个动作',exact:true})).toBeDisabled();
  await replay.getByRole('button',{name:'上一个动作',exact:true}).click();await expect(position).toHaveValue(String(Number(last)-1));
  await replay.getByRole('button',{name:'播放过程',exact:true}).click();await expect(replay.getByRole('button',{name:'暂停回放',exact:true})).toBeVisible();await replay.getByRole('button',{name:'暂停回放',exact:true}).click();await replay.screenshot({path:testInfo.outputPath('verified-process-replay.png')});
  await page.getByRole('navigation',{name:'核验结果视图'}).getByRole('button',{name:'操作记录',exact:true}).click();await expect(page.locator('.nv-table tbody tr').first()).toBeVisible();
  await page.getByRole('navigation',{name:'核验结果视图'}).getByRole('button',{name:'证书信息',exact:true}).click();await expect(page.locator('.nv-certificate')).toContainText('essay.md');
  const certificateId=await page.locator('.nv-certificate > div').filter({hasText:'证书指纹'}).locator('dd').innerText();
  await page.getByRole('button',{name:'保存原始证书',exact:true}).click();await expect.poll(()=>certificateSaves.length).toBe(3);
  expect(certificateSaves[2].certificateId).toBe(certificateId);expect(Buffer.from(certificateSaves[2].certificate)).toEqual(fs.readFileSync('apps/verifier/public/demo/essay.md.wproof'));
  const expected=page.locator('.nv-expected input');await expected.fill('0'.repeat(64));await expect(page.locator('.nv-certificate')).toHaveCount(0);
  await page.getByRole('button',{name:'开始核验',exact:true}).click();await expect(page.locator('.nv-verdict')).toContainText('证书指纹不一致');
  await expect(page.getByRole('button',{name:'保存原始证书',exact:true})).toHaveCount(0);
  await expected.fill(certificateId);await page.getByRole('button',{name:'开始核验',exact:true}).click();await expect(page.locator('.nv-verdict')).toContainText('指定证书指纹一致');
  await page.getByLabel('1 · 最终作品', {exact:true}).setInputFiles({name:'essay.md',mimeType:'text/markdown',buffer:Buffer.from('被修改的正文')});
  await expect(page.locator('.nv-certificate')).toHaveCount(0);await page.getByRole('button',{name:'开始核验',exact:true}).click();
  await expect(page.getByRole('heading',{name:'核验未通过',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'核验结果视图'}).getByRole('button',{name:'操作记录',exact:true}).click();await expect(page.locator('.nv-table')).toHaveCount(0);
});

test('desktop rail leaves an unsaved editor open on a failed save and supports retry',async({page})=>{
  await desktop(page);
  const body=await create(page);
  await page.locator('#document-title').fill('跨页保存测试');
  await body.fill('切换页面前保存这段文字。');
  await page.evaluate(()=>{(window as any).editorHarness.failNext=true;});
  const settings=page.getByRole('button',{name:'设置',exact:true});
  await settings.click();
  await expect(page.locator('#message')).toContainText('磁盘暂时无法写入');
  await expect(body).toBeVisible();
  await expect(page.locator('#save-state')).toContainText('未保存');
  await settings.click();
  await expect(page.locator('#settings-page')).toBeVisible();
  await expect(page.locator('#workspace-title')).toBeFocused();
  await page.getByRole('button',{name:'我的文档',exact:true}).click();
  await page.getByRole('button',{name:'继续编辑 跨页保存测试'}).click();
  await expect(body).toHaveText('切换页面前保存这段文字。');
});

test('cancelling Markdown export keeps the source editor open and editable',async({page})=>{
  await desktop(page);await create(page,'markdown');
  await ensureToolsOpen(page);await page.locator('#toggle-source').click();
  const source=page.locator('#markdown-source .cm-content');
  await expect(source).toBeVisible();
  await source.fill('# 保留源码');

  await page.locator('#export-document').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.exports)).toBe(1);
  await expect(source).toBeEditable();
  await expect(source).toContainText('# 保留源码');
  await expect(page.locator('#tab-write')).toHaveAttribute('aria-selected','true');
});

test('My Documents combines external sessions with internal documents and paginates their read-only history',async({page})=>{
  await desktop(page);await create(page);await page.locator('#document-title').fill('同名创作');await page.locator('#save-document').click();
  await page.evaluate(()=>{
    const w=window as any,internal=Object.values(JSON.parse(localStorage.getItem('test.editor.documents')!))[0] as any;
    w.editorHarness.externalDocuments=[{id:internal.id,title:'同名创作',source:'word',started_at:'2026-11-01T08:00:00Z',event_count:205,last_elapsed_ms:204000,modified_ms:Date.now(),local_path:'C:\\作品\\同名创作.docx',file_available:true,can_open:true,recent_order:1,demo:false}];
    w.editorHarness.externalRecords={[internal.id]:Array.from({length:205},(_,i)=>({event:{seq:204-i,elapsed_ms:(204-i)*1000,kind:'edit',inserted:1,deleted:0,chars:205-i,checkpoint:'0'.repeat(64),metrics:{}},hash:'a'.repeat(64)}))};
  });
  await page.locator('.workspace-nav [data-view=library]').click();await expect(page.locator('#document-list .document-row')).toHaveCount(2);
  expect(await page.locator('#document-list .document-row').evaluateAll(rows=>rows.map(row=>(row as HTMLElement).dataset.documentKey))).toEqual(expect.arrayContaining([expect.stringMatching(/^editor:/),expect.stringMatching(/^external:/)]));
  await selectChoice(page,'#library-source-filter','word');await expect(page.locator('#document-list .document-row')).toHaveCount(1);await expect(page.locator('#document-list')).toContainText('Word');
  await page.getByRole('button',{name:'查看记录 同名创作',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-view','external-document');
  await expect(page.locator('#external-actions > li')).toHaveCount(200);await expect(page.locator('#external-document-title')).toHaveText('同名创作');await expect(page.locator('#external-document-summary')).toContainText('205 条记录');
  await page.locator('#external-load-more').click();await expect(page.locator('#external-actions > li')).toHaveCount(205);await expect(page.locator('#external-load-more')).toBeHidden();
  await page.locator('#external-open-file').click();await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.openedExternalIds.length)).toBe(1);
  await page.locator('#external-back-library').click();await selectChoice(page,'#library-source-filter','editor');await expect(page.getByRole('button',{name:'继续编辑 同名创作',exact:true})).toBeVisible();
});

test('legacy external records explain missing file locations and offer the matching connection guide',async({page})=>{
  await desktop(page);await page.evaluate(()=>{(window as any).editorHarness.externalDocuments=[{id:'legacy-ppt',title:'历史演示文稿',source:'powerpoint',started_at:'2026-11-01T08:00:00Z',event_count:0,last_elapsed_ms:null,local_path:null,file_available:false,can_open:false,recent_order:1,demo:false}];});
  await page.locator('#reload-documents').click();await page.locator('#document-search input').fill('PowerPoint');await expect(page.locator('#document-list .document-row')).toHaveCount(1);
  await page.getByRole('button',{name:'查看记录 历史演示文稿',exact:true}).click();await expect(page.locator('#external-empty')).toBeVisible();await expect(page.locator('#external-file-status')).toContainText('文件位置未记录');await expect(page.locator('#external-open-file')).toBeHidden();
  await page.locator('#external-connection-help').click();await expect(page.locator('body')).toHaveAttribute('data-view','connections');await expect(page.locator('#creation-tool')).toHaveValue('powerpoint');
});

test('a new adapter session appears in the open file library without manual refresh',async({page})=>{
  await desktop(page);
  await page.evaluate(()=>{
    const w=window as any;w.editorHarness.externalDocuments=[{id:'new-session',title:'刚在 Word 编辑的文件.docx',source:'word',started_at:new Date().toISOString(),event_count:1,last_elapsed_ms:0,modified_ms:Date.now(),local_path:null,file_available:false,can_open:false,recent_order:1,demo:false}];
    w.editorHarness.engineStatus={sessions:1,events:1};
  });
  await expect(page.getByRole('button',{name:'查看记录 刚在 Word 编辑的文件.docx',exact:true})).toBeVisible();
});

test('known files group recording sessions while unbound same-name sessions remain distinct',async({page})=>{
  await desktop(page);await page.evaluate(()=>{
    const w=window as any,base={title:'多次记录.docx',source:'word',started_at:'2026-11-01T08:00:00Z',event_count:1,last_elapsed_ms:0,file_available:true,can_open:true,demo:false};
    w.editorHarness.externalDocuments=[{...base,id:'known-new',local_path:'C:\\作品\\多次记录.docx',modified_ms:2000,recent_order:2},{...base,id:'known-old',local_path:'c:/作品/多次记录.docx',modified_ms:1000,recent_order:1},{...base,id:'unbound-a',title:'未绑定的同名文件',local_path:null,can_open:false,file_available:false},{...base,id:'unbound-b',title:'未绑定的同名文件',local_path:null,can_open:false,file_available:false},{...base,id:'script',title:'代码.py',source:'vscode',local_path:'C:\\作品\\代码.py',can_open:false}];
    w.editorHarness.externalRecords=Object.fromEntries(w.editorHarness.externalDocuments.map((item:any)=>[item.id,[{event:{seq:0,elapsed_ms:0,kind:'edit',inserted:0,deleted:0,chars:0,checkpoint:'0'.repeat(64),metrics:{}},hash:'a'.repeat(64)}]]));
  });
  await page.locator('#reload-documents').click();await expect(page.locator('#document-list .document-row')).toHaveCount(4);
  await selectChoice(page,'#library-source-filter','word');await expect(page.locator('#document-list .document-row')).toHaveCount(3);await expect(page.getByRole('button',{name:'查看记录 未绑定的同名文件',exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'查看记录 多次记录.docx',exact:true}).click();await expect(page.locator('#external-session-select')).toHaveValue('known-new');await expect(page.locator('#external-session-select option')).toHaveCount(2);
  await selectChoice(page,'#external-session-select','known-old');await expect(page.locator('#external-actions > li')).toHaveCount(1);await page.locator('#external-open-file').click();await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.openedExternalIds)).toEqual(['known-old']);
  await page.locator('#external-back-library').click();await selectChoice(page,'#library-source-filter','vscode');await page.getByRole('button',{name:'查看记录 代码.py',exact:true}).click();await expect(page.locator('#external-open-file')).toBeDisabled();await expect(page.locator('#external-file-status')).toContainText('请在原应用中打开此文件');
});

for(const viewport of [{width:1280,height:800},{width:960,height:780}]){
  test(`default editor reserves seventy percent of workspace for writing at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await desktop(page);const body=await create(page);await body.fill('把空间留给写作。');
    await expect.poll(()=>page.locator('#document-workspace').evaluate(workspace=>{
      const frame=workspace.getBoundingClientRect(),canvas=workspace.querySelector('.editor-canvas')!.getBoundingClientRect();
      return Math.min(canvas.width*canvas.height/(frame.width*frame.height),canvas.height/frame.height,canvas.width*canvas.height/(innerWidth*innerHeight));
    })).toBeGreaterThanOrEqual(.7);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const iconCentered=await page.locator('.workspace-nav [data-view=library] .wp-icon').evaluate(icon=>{const rail=icon.closest('nav')!.getBoundingClientRect(),rect=icon.getBoundingClientRect();return Math.abs((rect.left+rect.width/2)-(rail.left+rail.width/2))<=3;});
    expect(iconCentered).toBe(true);
    if(viewport.width===1280)await page.screenshot({path:info.outputPath('default-editor-wide.png')});
  });
}

test('simple writing fills the window and restores pane choices navigation and text on Escape',async({page},info)=>{
  await page.setViewportSize({width:1280,height:800});await desktop(page);const body=await create(page);await body.fill('精简模式让正文成为视线的中心。');await page.locator('#save-document').click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('fluent-radio[value=dark]').click();
  await selectChoice(page,'[data-pane-preference=ribbon]','open');await selectChoice(page,'[data-pane-preference=outline]','closed');await selectChoice(page,'[data-pane-preference=inspector]','open');
  await page.getByRole('button',{name:'我的文档',exact:true}).click();await page.getByRole('button',{name:'继续编辑 未命名文档',exact:true}).click();
  const workspace=page.locator('#write-panel');
  await expect(workspace).toHaveAttribute('data-ribbon-open','true');await expect(workspace).toHaveAttribute('data-outline-open','false');await expect(workspace).toHaveAttribute('data-inspector-open','true');
  const before=await page.evaluate(()=>({compact:document.body.classList.contains('compact-nav'),preferences:['ribbon','outline','inspector'].map(name=>localStorage.getItem(`workproof.pane.${name}`))}));
  await ensureToolsOpen(page);await page.locator('#focus-writing').click();await expect(page.locator('body')).toHaveClass(/simple-writing/);await expect(page.locator('#exit-simple-writing')).toBeVisible();
  await expect(page.locator('.workspace-nav')).toHaveAttribute('inert','');await expect(page.locator('.doc-head')).toHaveAttribute('inert','');
  await page.evaluate(()=>(window as any).workproofSetInteractionLock('engine',false));
  await expect(page.locator('.workspace-nav')).toHaveAttribute('inert','');await expect(page.locator('main')).not.toHaveAttribute('inert','');
  await expect.poll(()=>page.locator('.editor-canvas').evaluate(element=>{const rectangle=element.getBoundingClientRect();return rectangle.width*rectangle.height/(innerWidth*innerHeight);})).toBeGreaterThanOrEqual(.7);
  await page.screenshot({path:info.outputPath('typora-simple-dark.png')});
  await page.keyboard.press('Escape');await expect(page.locator('body')).not.toHaveClass(/simple-writing/);await expect(page.locator('#exit-simple-writing')).toBeHidden();
  await expect(workspace).toHaveAttribute('data-ribbon-open','true');await expect(workspace).toHaveAttribute('data-outline-open','false');await expect(workspace).toHaveAttribute('data-inspector-open','true');
  await expect(page.locator('.workspace-nav')).not.toHaveAttribute('inert','');await expect(page.locator('.doc-head')).not.toHaveAttribute('inert','');await expect(body).toHaveText('精简模式让正文成为视线的中心。');
  expect(await page.evaluate(()=>({compact:document.body.classList.contains('compact-nav'),preferences:['ribbon','outline','inspector'].map(name=>localStorage.getItem(`workproof.pane.${name}`))}))).toEqual(before);
  await ensureToolsOpen(page);await page.locator('#focus-writing').click();await page.locator('#exit-simple-writing').click();await expect(page.locator('body')).not.toHaveClass(/simple-writing/);
});

test('leaving the editor exits simple writing and releases navigation controls',async({page})=>{
  await desktop(page);await create(page);await ensureToolsOpen(page);await page.locator('#focus-writing').click();await expect(page.locator('body')).toHaveClass(/simple-writing/);
  await page.evaluate(()=>(window as any).workproofUI.selectView('connections',true));
  await expect(page.locator('body')).toHaveAttribute('data-view','connections');await expect(page.locator('body')).not.toHaveClass(/simple-writing/);await expect(page.locator('#exit-simple-writing')).toBeHidden();await expect(page.locator('.workspace-nav')).not.toHaveAttribute('inert','');
});

test('locating a legacy original file preserves history across cancel error and successful association',async({page})=>{
  await desktop(page);await page.evaluate(()=>{
    const w=window as any,document={id:'legacy-location',title:'待定位作品.docx',source:'word',started_at:'2026-11-01T08:00:00Z',event_count:1,last_elapsed_ms:1000,local_path:null,file_available:false,can_open:false,recent_order:1,demo:false};
    w.editorHarness.externalDocuments=[document];w.editorHarness.externalRecords={[document.id]:[{event:{seq:0,elapsed_ms:1000,kind:'edit',inserted:3,deleted:0,chars:3,checkpoint:'0'.repeat(64),metrics:{}},hash:'a'.repeat(64)}]};
    const invoke=w.__TAURI__.core.invoke;w.editorHarness.locateAttempts=0;
    w.__TAURI__.core.invoke=async(command:string,args:any)=>{
      if(command!=='external_document_locate')return invoke(command,args);
      w.editorHarness.locateAttempts++;w.editorHarness.lastLocateArgs=args;
      if(w.editorHarness.locateAttempts===1)return {cancelled:true};
      if(w.editorHarness.locateAttempts===2)throw new Error('请选择名为“待定位作品.docx”的原文件。');
      const updated={...document,local_path:'C:\\创作\\待定位作品.docx',file_available:true,can_open:true};w.editorHarness.externalDocuments=[updated];return {cancelled:false,document:updated};
    };
  });
  await page.locator('#reload-documents').click();await page.getByRole('button',{name:'查看记录 待定位作品.docx',exact:true}).click();
  const locate=page.locator('#external-locate-file');await expect(locate).toBeVisible();await expect(page.locator('#external-actions > li')).toHaveCount(1);
  await locate.click();await expect(locate).toBeEnabled();await expect(page.locator('#external-file-status')).toContainText('文件位置未记录');await expect(page.locator('#external-open-file')).toBeHidden();
  await locate.click();await expect(page.locator('#message')).toContainText('待定位作品.docx');await expect(locate).toBeEnabled();await expect(page.locator('#external-actions > li')).toHaveCount(1);
  await locate.click();await expect(locate).toBeHidden();await expect(page.locator('#external-open-file')).toBeEnabled();await expect(page.locator('#external-actions > li')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as any).editorHarness.lastLocateArgs)).toEqual({id:'legacy-location'});
  await page.locator('#external-open-file').click();await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.openedExternalIds)).toEqual(['legacy-location']);
});

test('moved originals can be located and picker failures restore controls without changing history',async({page})=>{
  await desktop(page);await page.evaluate(()=>{
    const w=window as any;w.editorHarness.externalDocuments=[{id:'moved-location',title:'搬移演示.pptx',source:'powerpoint',started_at:'2026-11-01T08:00:00Z',event_count:0,last_elapsed_ms:null,local_path:'C:\\旧目录\\搬移演示.pptx',file_available:false,can_open:false,recent_order:1,demo:false}];
    const invoke=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(command:string,args:any)=>command==='external_document_locate'?Promise.reject(new Error('文件选择暂未完成，请重试。')):invoke(command,args);
  });
  await page.locator('#reload-documents').click();await page.getByRole('button',{name:'查看记录 搬移演示.pptx',exact:true}).click();await expect(page.locator('#external-file-status')).toContainText('请确认文件仍在原位置');
  await page.locator('#external-locate-file').click();await expect(page.locator('#message')).toContainText('文件选择暂未完成');await expect(page.locator('#external-locate-file')).toBeEnabled();await expect(page.locator('#external-open-file')).toBeDisabled();await expect(page.locator('#external-empty')).toBeVisible();
});

test('wide dark editor keeps two compact command rows and unclipped navigation icons',async({page},info)=>{
  await page.setViewportSize({width:1919,height:1023});
  await page.addInitScript(()=>{localStorage.setItem('workproof.appearance','dark');});
  await desktop(page);const body=await create(page);await body.fill('让正文成为工作区的中心。工具随时可用，写作始终清楚。');
  await page.locator('#save-document').click();await expect(page.locator('#save-state')).toHaveText('已保存到本机');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('body')).toHaveClass(/compact-nav/);
  await expect.poll(()=>page.evaluate(()=>{
    const head=document.querySelector('.doc-head')!.getBoundingClientRect(),chrome=document.querySelector('.writing-chrome')!.getBoundingClientRect();
    const mode=document.querySelector('.doc-head .document-kind')!.getBoundingClientRect(),tabs=document.querySelector('.doc-head .document-tabs')!.getBoundingClientRect();
    return head.height+chrome.height<=112&&Math.abs(chrome.top-head.bottom)<=1&&mode.top>=head.top&&mode.bottom<=head.bottom&&tabs.top>=head.top&&tabs.bottom<=head.bottom&&Math.abs((mode.top+mode.height/2)-(tabs.top+tabs.height/2))<=4;
  })).toBe(true);
  await expect.poll(()=>page.locator('#document-workspace').evaluate(element=>{
    const frame=element.getBoundingClientRect(),canvas=element.querySelector('.editor-canvas')!.getBoundingClientRect();
    return canvas.width*canvas.height/(frame.width*frame.height);
  })).toBeGreaterThanOrEqual(.7);
  const rail=await page.locator('.workspace-nav').evaluate(element=>{
    const bounds=element.getBoundingClientRect();
    return {overflow:element.scrollWidth>element.clientWidth,buttons:[...element.querySelectorAll('.nav-item')].map(button=>{
      const rect=button.getBoundingClientRect(),icon=button.querySelector('.wp-icon svg')!.getBoundingClientRect();
      return {width:rect.width,insideRail:rect.left>=bounds.left&&rect.right<=bounds.right,iconVisible:icon.width>=18&&icon.height>=18&&icon.left>=rect.left&&icon.right<=rect.right&&icon.top>=rect.top&&icon.bottom<=rect.bottom};
    })};
  });
  expect(rail.overflow).toBe(false);expect(rail.buttons.length).toBeGreaterThan(0);
  for(const button of rail.buttons){expect(button.width).toBe(44);expect(button.insideRail).toBe(true);expect(button.iconVisible).toBe(true);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('editor-two-rows-1919-dark.png')});
});


test('action character counts preserve Unicode and paragraph semantics through edits and document changes',async({page})=>{
  await desktop(page);const body=await create(page);
  // Start from a known persisted Unicode document so browser-specific IME
  // insertion behavior cannot change the paragraph separators under test.
  await page.evaluate(()=>{const docs=JSON.parse(localStorage.getItem('test.editor.documents')!);const doc=Object.values(docs)[0] as any;doc.content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'甲😀'}]},{type:'paragraph',content:[{type:'text',text:'乙𠮷'}]}]};localStorage.setItem('test.editor.documents',JSON.stringify(docs));});
  await page.reload();await page.getByRole('button',{name:'继续编辑 未命名文档'}).click();
  await expect(body.locator('p')).toHaveText(['甲😀','乙𠮷']);await body.click();
  await body.press('ArrowLeft');await page.locator('#save-document').click();
  const first=await page.evaluate(()=>(window as any).editorHarness.saves.flatMap((s:any)=>s.actions));
  // Tiptap getText uses two newlines between paragraphs for command records;
  // existing text-delta records use one. Emoji count as code points in both.
  expect(first.filter((a:any)=>a.kind==='keyboard'&&a.detail?.key==='ArrowLeft').at(-1)?.chars).toBe(6);
  await body.press('Control+End');await body.pressSequentially('x');await expect(body.locator('p')).toHaveText(['甲😀','乙𠮷x']);await body.press('ArrowRight');await page.locator('#save-document').click();
  const edited=await page.evaluate(()=>(window as any).editorHarness.saves.flatMap((s:any)=>s.actions));
  expect(edited.filter((a:any)=>a.kind==='keyboard'&&a.detail?.key==='ArrowRight').at(-1)?.chars).toBe(7);
  expect(edited.filter((a:any)=>a.kind==='edit').at(-1)?.chars).toBe(6);
  await page.locator('.workspace-nav').getByRole('button',{name:'我的文档',exact:true}).click();await create(page);
  await expect(page.locator('#new-document')).toBeEnabled();await body.click();
  await body.press('ArrowRight');await page.locator('#save-document').click();
  const secondId=await page.evaluate(()=>(window as any).editorHarness.saves.at(-1).id);
  const fresh=await page.evaluate(id=>(window as any).editorHarness.saves.filter((s:any)=>s.id===id).flatMap((s:any)=>s.actions),secondId);
  expect(fresh.filter((a:any)=>a.kind==='keyboard'&&a.detail?.key==='ArrowRight').at(-1)?.chars).toBe(0);
});
test('workspace commands create a recorded template and remain keyboard accessible',async({page},info)=>{
  await desktop(page);
  await page.keyboard.press('Control+k');
  const palette=page.getByRole('dialog',{name:'快捷命令',exact:true});
  await expect(palette).toBeVisible();
  await page.screenshot({path:info.outputPath('workspace-command-center-light.png')});
  const search=palette.getByRole('searchbox',{name:'搜索功能或文档'});
  await search.fill('找不到的命令xyz');await expect(palette.getByText('没有找到。试试“新建”“查找”或文档名称。')).toBeVisible();
  await search.fill('会议记录');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await selectKind(page,'word');
  await expect(palette).not.toBeVisible();await expect(page.getByRole('textbox',{name:'文档名称'})).toHaveValue('会议记录');
  await expect(page.getByRole('textbox',{name:'文档正文'})).toContainText('讨论要点');
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.saves.flatMap((s:any)=>s.actions).some((a:any)=>a.kind==='import'&&a.detail?.source==='builtin-template'&&a.detail?.template_id==='meeting'))).toBe(true);
  await page.keyboard.press('Control+k');await search.fill('返回我的文档');await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view','library');
  await page.keyboard.press('Control+k');await search.fill('继续编辑 会议记录');await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox',{name:'文档正文'})).toContainText('讨论要点');
});

test('document statistics count Unicode characters and return focus without changing content',async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('workproof.appearance','dark'));
  await desktop(page);const body=await create(page);await body.click();await page.keyboard.insertText('中文 hello world 😀');
  await expect(body).toHaveText('中文 hello world 😀');
  await page.getByRole('button',{name:'查看文档统计',exact:true}).click();
  const stats=page.getByRole('dialog',{name:'文档统计',exact:true});await expect(stats).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:info.outputPath('workspace-statistics-dark.png')});
  for(const [label,count] of [['字符（含空白）','17'],['非空白字符','14'],['汉字','2'],['英文词','2'],['文字段落（含标题）','1']]){
    await expect(stats.locator('dl > div').filter({has:page.getByText(label,{exact:true})}).locator('dd')).toHaveText(count);
  }
  await page.keyboard.press('Escape');await expect(stats).not.toBeVisible();
  await expect(page.getByRole('button',{name:'查看文档统计',exact:true})).toBeFocused();await expect(body).toHaveText('中文 hello world 😀');
});

test('library sorting persists and source search reports the matching count',async({page})=>{
  await desktop(page);await create(page);await page.getByRole('textbox',{name:'文档名称'}).fill('Alpha 2');await page.locator('#back-library').click();
  await create(page);await page.getByRole('textbox',{name:'文档名称'}).fill('Beta 1');await page.locator('#back-library').click();
  await selectChoice(page,'#library-sort','title');
  await expect(page.locator('#document-list .document-row strong')).toHaveText(['Alpha 2','Beta 1']);
  await page.reload();await expect(page.locator('#library-sort')).toHaveValue('title');await expect(page.locator('[data-native-select=library-sort] [slot=control]')).toContainText('按名称排序');
  await page.locator('#document-search input').fill('Beta');
  await expect(page.locator('#library-summary')).toHaveText('我的文档 · 1 份，本分组共 2 份');
  await expect(page.locator('#document-list .document-row strong')).toHaveText(['Beta 1']);
});

test('a save failure prevents a template from replacing the current document',async({page})=>{
  await desktop(page);const body=await create(page);
  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(command:string,args:any)=>command==='editor_save'?Promise.reject(new Error('磁盘不可写')):invoke(command,args);});
  await body.fill('必须保留的未保存内容');await body.press('End');await page.keyboard.press('Control+k');
  await page.getByRole('searchbox',{name:'搜索功能或文档'}).fill('新建阅读笔记');await page.keyboard.press('Enter');await selectKind(page,'markdown');
  await expect(body).toHaveText('必须保留的未保存内容');
  await expect.poll(()=>page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('test.editor.documents')||'{}')).length)).toBe(1);
  await expect(page.locator('#save-state')).toHaveAttribute('data-state','error');
});

test('an unchanged catalog refresh preserves the document button during a click',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('刷新时仍可继续编辑');
  await page.locator('#back-library').click();
  const open=page.getByRole('button',{name:'继续编辑 未命名文档',exact:true});
  const original=await open.elementHandle();
  const box=await open.boundingBox();if(!box)throw new Error('Document action is not visible');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.evaluate(async()=>{
    document.getElementById('reload-documents')!.click();
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  });
  expect(await original!.evaluate(element=>element.isConnected)).toBe(true);
  await page.mouse.up();
  await expect(page.getByRole('textbox',{name:'文档正文'})).toContainText('刷新时仍可继续编辑');
});

test('process replay pages the complete history, seeks real snapshots and locates paste actions safely',async({page})=>{
  await desktop(page);await create(page);await page.locator('#back-library').click();
  await page.evaluate(()=>{
    const docs=JSON.parse(localStorage.getItem('test.editor.documents')||'{}'),doc:any=Object.values(docs)[0];
    doc.revision=130;doc.title='回放示例';doc.versions=[];doc.snapshots={};doc.actions=[];
    const unsafe='<script>window.replayInjected=true</script>';
    for(let revision=0;revision<=130;revision++){
      const text=revision===67?unsafe:`保存内容 ${revision}`;
      const content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]};
      doc.snapshots[revision]=content;doc.versions.unshift({revision,saved:doc.created+revision*10000,count:1});
      const base={elapsed_ms:revision*10000,inserted:0,deleted:0,chars:text.length,steps:[],selection:{},detail:null};
      doc.actions.unshift({revision,action:{...base,kind:revision===67?'paste':'copy'}});
      if(revision===67)doc.actions.unshift({revision,action:{...base,kind:'edit',elapsed_ms:revision*10000+1,inserted:300,steps:[{slice:{content:[{type:'text',text:unsafe}]}}]}});
    }
    doc.content=doc.snapshots[130];localStorage.setItem('test.editor.documents',JSON.stringify(docs));
  });
  await page.reload();await page.getByRole('button',{name:'继续编辑 回放示例',exact:true}).click();
  await page.locator('#tab-process').click();await page.locator('#open-process-replay').click();
  const replay=page.getByRole('dialog',{name:'回放示例'});
  await expect(replay.locator('.replay-paper')).toContainText('保存内容 130');
  expect((await page.evaluate(()=>(window as any).editorHarness.historyRequests)).length).toBeGreaterThan(1);
  expect((await page.evaluate(()=>(window as any).editorHarness.frameRequests)).length).toBe(1);
  await replay.getByRole('button',{name:'版本 68 · 1 次粘贴',exact:true}).click();
  await expect(replay.locator('.replay-paper')).toHaveText('<script>window.replayInjected=true</script>');
  await replay.getByRole('button',{name:'查看粘贴与修改线索',exact:true}).click();
  await expect(replay.locator('.replay-activity')).toContainText('大段粘贴');
  expect(await page.evaluate(()=>(window as any).replayInjected)).toBeUndefined();
  await expect(replay.locator('script')).toHaveCount(0);
  await replay.getByRole('button',{name:'收起分析侧栏',exact:true}).click();await expect(replay.locator('.replay-inspector')).toHaveAttribute('inert','');
  await replay.getByRole('button',{name:'展开分析侧栏',exact:true}).click();
  await expect(replay.locator('.replay-seek')).not.toHaveAttribute('role','button');
  await replay.getByRole('slider',{name:'回放进度'}).focus();await page.keyboard.press('Home');
  await expect(replay.locator('.replay-paper')).toHaveText('保存内容 0');
  await replay.getByRole('button',{name:'下一个保存版本',exact:true}).click();await expect(replay.locator('.replay-paper')).toHaveText('保存内容 1');
  await selectChoice(page,'.process-replay select[aria-label="回放速度"]','4');
  await replay.getByRole('button',{name:'播放保存过程',exact:true}).click();await expect(replay.getByRole('button',{name:'暂停回放',exact:true})).toHaveAttribute('aria-pressed','true');
  await replay.getByRole('button',{name:'暂停回放',exact:true}).click();
  await page.screenshot({path:test.info().outputPath('process-replay.png')});
  await page.keyboard.press('Escape');await expect(replay).toHaveCount(0);await expect(page.locator('#open-process-replay')).toBeFocused();
});

test('process replay shows frame failures, closes cleanly and fits a narrow desktop window',async({page})=>{
  await desktop(page);await create(page);await page.locator('#tab-process').click();
  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(command:string,args:any)=>command==='editor_replay_frame'?Promise.reject(new Error('版本暂时无法读取')):invoke(command,args);});
  await page.setViewportSize({width:480,height:720});await page.locator('#open-process-replay').click();
  const replay=page.locator('#process-replay');await expect(replay.locator('.replay-paper')).toContainText('版本暂时无法读取');
  expect(await replay.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  await replay.getByRole('button',{name:'关闭过程回放',exact:true}).click();await expect(replay).toHaveCount(0);
  await expect(page.locator('#document-workspace')).toBeVisible();
});

test('archive restores saved content and permanent deletion requires confirmation',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('归档和回收站都保留这段正文');
  await page.locator('#back-library').click();
  await page.getByRole('button',{name:'归档 未命名文档',exact:true}).click();
  await expect(page.getByRole('button',{name:'继续编辑 未命名文档',exact:true})).toHaveCount(0);
  await selectChoice(page,'#library-state-filter','archived');
  await expect(page.getByRole('button',{name:'继续编辑 未命名文档',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'删除 未命名文档',exact:true})).toBeVisible();
  await page.reload();await selectChoice(page,'#library-state-filter','archived');
  await page.getByRole('button',{name:'恢复到我的文档 未命名文档',exact:true}).click();
  await selectChoice(page,'#library-state-filter','active');
  await page.getByRole('button',{name:'继续编辑 未命名文档',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'文档正文'})).toContainText('归档和回收站都保留这段正文');
  await page.locator('#back-library').click();await page.getByRole('button',{name:'删除 未命名文档',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('button',{name:'继续编辑 未命名文档',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'删除 未命名文档',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'永久删除',exact:true}).click();
  await expect(page.getByRole('button',{name:'继续编辑 未命名文档',exact:true})).toHaveCount(0);await page.reload();await expect(page.locator('#document-list .document-row')).toHaveCount(0);
});

test('external Markdown opens as a new editable copy and grouped sessions archive together',async({page})=>{
  await desktop(page);await page.evaluate(()=>{
    const w=window as any,base={title:'外部笔记.md',source:'vscode',started_at:'2026-11-01T08:00:00Z',event_count:1,last_elapsed_ms:0,file_available:true,can_open:true,demo:false,local_path:'C:/作品/外部笔记.md'};
    w.editorHarness.externalDocuments=[{...base,id:'copy-new',recent_order:2},{...base,id:'copy-old',recent_order:1}];
    const invoke=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(command:string,args:any)=>command==='external_document_read'?Promise.resolve({name:'外部笔记.md',bytes:[...new TextEncoder().encode('# 原文件标题\n\n从外部软件读取的正文')]}):invoke(command,args);
  });
  await page.locator('#reload-documents').click();
  await page.getByRole('button',{name:'在内置编辑器打开副本 外部笔记.md',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'文档正文'})).toContainText('从外部软件读取的正文');
  await expect(page.locator('#import-markdown')).toBeEnabled();
  await page.locator('#back-library').click();
  await page.getByRole('button',{name:'归档 外部笔记.md',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看记录 外部笔记.md',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('library.states')||'{}'))).toMatchObject({'external:copy-new':'archived','external:copy-old':'archived'});
  await selectChoice(page,'#library-state-filter','archived');
  await page.getByRole('button',{name:'恢复到我的文档 外部笔记.md',exact:true}).click();
  await selectChoice(page,'#library-state-filter','active');
  await expect(page.getByRole('button',{name:'查看记录 外部笔记.md',exact:true})).toBeVisible();
});

test('desktop chrome suppresses browser menus and text selection while the editor remains editable',async({page})=>{
  await desktop(page);
  await page.evaluate(()=>{document.addEventListener('contextmenu',event=>{(window as any).contextMenuSuppressed=event.defaultPrevented;});});
  await page.locator('#library-summary').click({button:'right'});
  expect(await page.evaluate(()=>(window as any).contextMenuSuppressed)).toBe(true);
  expect(await page.locator('#library-summary').evaluate(node=>getComputedStyle(node).userSelect)).toBe('none');
  const body=await create(page);await body.fill('编辑器仍可选择和复制文字');
  await body.press('ControlOrMeta+a');expect(await page.evaluate(()=>getSelection()?.toString().trim())).toBe('编辑器仍可选择和复制文字');
  await body.pressSequentially('可以替换所选内容');await expect(body).toHaveText('可以替换所选内容');
});

test('folding the toolbar hides its tabs and commands while keeping a header expand button',async({page})=>{
  await desktop(page);await create(page);await ensureRibbonOpen(page);
  await page.locator('#toggle-ribbon').click();await expect(page.locator('#editor-tools')).toHaveAttribute('aria-hidden','true');
  await expect.poll(()=>page.locator('#editor-tools').evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(2);
  await expect(page.locator('.doc-actions #toggle-ribbon')).toBeVisible();
  await page.locator('#toggle-ribbon').click();await expect(page.locator('#toolbar-home')).toBeVisible();await expect(page.getByRole('button',{name:'加粗',exact:true})).toBeVisible();
  await page.locator('#toggle-ribbon').click();await page.getByRole('textbox',{name:'文档正文'}).press('ControlOrMeta+f');await expect(page.locator('#find-text')).toBeFocused();await expect(page.locator('#find-panel')).toBeVisible();
});

test('preparing the recording service dims and blocks the home page until ready',async({page})=>{
  await desktop(page);await page.evaluate(()=>{(window as any).editorHarness.engineStatus={ready:false};});
  await expect(page.locator('#engine-loading')).toBeVisible();await expect(page.locator('main')).toHaveAttribute('inert','');
  expect(await page.locator('main').evaluate(node=>Number(getComputedStyle(node).opacity))).toBeLessThan(1);
  await expect(page.locator('#engine-loading fluent-progress-bar')).toBeVisible();
  await page.evaluate(()=>{(window as any).editorHarness.engineStatus={ready:true};});
  await expect(page.locator('#engine-loading')).toBeHidden();await expect(page.locator('main')).not.toHaveAttribute('inert','');
});

test('native metadata reads local file properties and clears them when the artifact changes',async({page})=>{
  await desktop(page);await page.getByRole('button',{name:'文件核验',exact:true}).click();await page.locator('#verify').click();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
  const text=Buffer.from('prompt\0editable <script>fixture</script>'),data=Buffer.concat([Buffer.from('tEXt'),text]);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(text.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  const image=Buffer.concat([png.subarray(0,33),length,data,checksum,png.subarray(33)]);
  await page.getByLabel('1 · 最终作品',{exact:true}).setInputFiles({name:'properties.png',mimeType:'image/png',buffer:image});
  await page.getByRole('button',{name:'查看元数据',exact:true}).click();
  const panel=page.getByRole('region',{name:'文件元数据',exact:true});await panel.getByRole('button',{name:'检查文件属性',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('editable <script>fixture</script>');await expect(panel.locator('script')).toHaveCount(0);
  await page.getByLabel('1 · 最终作品',{exact:true}).setInputFiles({name:'new.md',mimeType:'text/markdown',buffer:Buffer.from('new artifact')});
  await expect(panel.getByText('editable <script>fixture</script>',{exact:true})).toHaveCount(0);
});


test('paginated Word paper is centered inside its shell at wide and compact widths',async({page},testInfo)=>{
  await desktop(page);await create(page);
  for(const width of [1280,1000]){
    await page.setViewportSize({width,height:800});
    await expect.poll(()=>page.locator('.editor-paper>.tiptap.rm-with-pagination').evaluate(node=>{
      const inner=node.getBoundingClientRect(),outer=node.parentElement!.getBoundingClientRect();
      return Math.abs((inner.left-outer.left)-(outer.right-inner.right))<2;
    })).toBe(true);
    await page.screenshot({path:testInfo.outputPath('centered-word-'+width+'.png')});
  }
});

test('external files default to their associated software and an explicit preference imports a copy',async({page})=>{
  await desktop(page);await page.evaluate(()=>{
    const w=window as any;w.editorHarness.externalDocuments=[{id:'open-policy',title:'打开方式.md',source:'vscode',started_at:'2026-11-01T08:00:00Z',event_count:1,last_elapsed_ms:0,file_available:true,can_open:true,demo:false,local_path:'C:/作品/打开方式.md'}];
    const invoke=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(command:string,args:any)=>{if(command==='external_document_read'){w.editorHarness.externalReads=(w.editorHarness.externalReads||0)+1;return Promise.resolve({name:'打开方式.md',bytes:[...new TextEncoder().encode('# 保留原件\n\n副本中的正文')]});}return invoke(command,args);};
  });
  await page.locator('#reload-documents').click();await page.getByRole('button',{name:'打开文件 打开方式.md',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).editorHarness.openedExternalIds)).toEqual(['open-policy']);expect(await page.evaluate(()=>(window as any).editorHarness.externalReads||0)).toBe(0);
  await expect(page.locator('body')).toHaveAttribute('data-view','library');
  await page.getByRole('button',{name:'设置',exact:true}).click();await selectChoice(page,'#external-opening','internal');
  expect(await page.evaluate(()=>localStorage.getItem('workproof.external-opening'))).toBe('internal');
  await page.getByRole('button',{name:'我的文档',exact:true}).first().click();await page.getByRole('button',{name:'打开文件 打开方式.md',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'文档正文'})).toContainText('副本中的正文');
  expect(await page.evaluate(()=>(window as any).editorHarness.externalReads)).toBe(1);
  await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.locator('#external-opening')).toHaveValue('internal');
});


test('all app dialogs share rounded surfaces and finish closing before close handlers run',async({page})=>{
  await desktop(page);await page.getByRole('button',{name:'新建文档',exact:true}).click();
  const dialog=page.locator('#document-kind-dialog');await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(node=>getComputedStyle(node).borderTopLeftRadius)).toBe('12px');
  const result=await dialog.evaluate(async(node:any)=>{
    let closed=false;node.addEventListener('close',()=>{closed=true;},{once:true});
    const pending=(window as any).workproofCloseDialog(node,'cancel');
    const during={open:node.open,closing:node.dataset.dialogClosing,closed};await pending;
    return {during,open:node.open,value:node.returnValue};
  });
  expect(result).toMatchObject({during:{open:true,closing:'true',closed:false},open:false,value:'cancel'});
  await page.getByRole('button',{name:'新建文档',exact:true}).click();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await page.evaluate(()=>document.documentElement.dataset.reduceMotion='true');
  // Reopening a dialog with reduced motion must not reuse an already-resolved
  // close promise and leave the native modal permanently open.
  for(let i=0;i<2;i++){
    await page.getByRole('button',{name:'新建文档',exact:true}).click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  }
});


test('writing zoom and complete statistics remain reachable with the ribbon folded',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('中文 English words😀');
  if(await page.locator('#toggle-ribbon').getAttribute('aria-expanded')==='true')await page.locator('#toggle-ribbon').click();
  await expect(page.getByRole('group',{name:'编辑器缩放',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'放大编辑页面',exact:true}).click();await expect(page.locator('#writing-zoom')).toHaveValue('1.1');await expect(body).toHaveText('中文 English words😀');
  await page.getByRole('button',{name:'缩小编辑页面',exact:true}).click();await expect(page.locator('#writing-zoom')).toHaveValue('1');
  await page.getByRole('button',{name:'查看文档统计',exact:true}).click();const stats=page.getByRole('dialog',{name:'文档统计',exact:true});await expect(stats).toContainText('汉字');await expect(stats).toContainText('英文词');await expect(stats).toContainText('文字段落');await expect(stats.locator('.statistics-values>div').filter({hasText:'字符（含空白）'}).locator('dd')).toHaveText('18');
});
