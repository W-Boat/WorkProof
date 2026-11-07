import {test,expect,Page} from '@playwright/test';
import fs from 'node:fs';

// Browser tests exercise the real bundled Tiptap. Only native storage IPC is a
// fixture; engine editor::tests cover actual SQLite and Ed25519 separately.
async function desktop(page:Page){
  await page.route('**/desktop-status/**',route=>{
    const asset=new URL(route.request().url()).pathname.slice('/desktop-status/'.length);
    const name=asset.split('/').at(-1)!;
    const type:Record<string,string>={'index.html':'text/html','word-worker.js':'application/javascript','components.js':'application/javascript','markdown-source-runtime.js':'application/javascript','theme.css':'text/css','native-editor.css':'text/css','brand.png':'image/png'};
    const headers=name==='index.html'?{'Content-Security-Policy':JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8')).app.security.csp}:{};
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
      if(command==='engine_status')return {ready:true,sessions:0,events:0,...(w.editorHarness.engineStatus||{})};
      if(command==='pending_adapters'||command==='adapter_connections')return [];
      if(command==='editor_list')return Object.values(docs);
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
        const doc={id,title:args.title,created:now,modified:now,revision:0,content:{type:'doc',content:[{type:'paragraph'}]},actions:[],versions:[{revision:0,saved:now,count:0}],snapshots:{0:{type:'doc',content:[{type:'paragraph'}]}},event_count:1};docs[id]=doc;write(docs);return doc;
      }
      if(command==='editor_load')return docs[args.id];
      if(command==='editor_version')return docs[args.id].snapshots[args.revision];
      if(command==='editor_save'){
        w.editorHarness.saves.push(args.input);
        if(w.editorHarness.failNext){w.editorHarness.failNext=false;throw new Error('磁盘暂时无法写入，请重试。');}
        const input=args.input,doc=docs[input.id];
        if(input.expected_revision!==doc.revision)throw new Error('版本冲突');
        doc.revision++;doc.title=input.title;doc.content=input.content;doc.modified=Date.now();doc.event_count+=input.actions.length+1;
        doc.actions=input.actions.map((action:any)=>({action,revision:doc.revision})).reverse().concat(doc.actions).slice(0,300);
        doc.versions.unshift({revision:doc.revision,saved:Date.now(),count:input.actions.length});doc.snapshots[doc.revision]=input.content;write(docs);return {revision:doc.revision};
      }
      if(command==='editor_export'){w.editorHarness.exports++;return {cancelled:true};}
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
async function create(page:Page){await page.getByRole('button',{name:'新建文档',exact:true}).click();await expect(page.getByRole('textbox',{name:'文档正文'})).toBeVisible();return page.getByRole('textbox',{name:'文档正文'});}
async function ensureRibbonOpen(page:Page){
  await expect(page.locator('#write-panel')).toHaveAttribute('data-panes-initialized','true');
  // Selecting a tool tab explicitly expands its page even if automatic layout
  // changes between the preceding observation and this user interaction.
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
  const body=await create(page);await body.fill('正文编辑无需源码组件');expect(requests).toEqual([]);
  await page.locator('[data-mode=markdown]').click();await expect(body).toBeVisible();expect(requests).toEqual([]);
  await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toBeVisible();expect(requests).toHaveLength(1);
  await page.locator('#toggle-source').click();await expect(body).toBeVisible();await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toBeVisible();expect(requests).toHaveLength(1);
});

test('switching to Word cancels a pending source open and reopening uses the latest document',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('等待加载时的原稿');await page.locator('[data-mode=markdown]').click();
  const delayed=await delayMarkdownRuntime(page);
  await page.locator('#toggle-source').click();await delayed.requestStarted;
  await expect(page.locator('#toggle-source')).toHaveAttribute('aria-busy','true');await expect(body).toBeVisible();
  await page.locator('[data-mode=word]').click();
  await body.focus();await body.press('ControlOrMeta+a');await body.press('Backspace');
  await expect(body).toHaveText('');await page.keyboard.insertText('加载期间更新后的正文');
  await expect(body).toHaveText('加载期间更新后的正文');
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/desktop-status/markdown-source-runtime.js'));
  delayed.release();await loaded;
  await page.evaluate(async()=>{await import(new URL('markdown-source-runtime.js',document.baseURI).href);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
  await expect(page.locator('#markdown-source-panel')).toBeHidden();await expect(page.locator('#markdown-source .cm-content')).toHaveCount(0);await expect(body).toHaveText('加载期间更新后的正文');
  await page.locator('[data-mode=markdown]').click();await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toHaveText('加载期间更新后的正文');
});

test('tray quit saves while a source runtime is pending and prevents its late view from opening',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('退出前保留的正文');await page.locator('[data-mode=markdown]').click();
  const delayed=await delayMarkdownRuntime(page);
  await page.locator('#toggle-source').click();await delayed.requestStarted;
  await page.evaluate(()=>{(window as any).editorHarness.listeners['workproof-quit-requested']();});
  await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.windowActions)).toEqual(['quit']);
  expect(await page.evaluate(()=>(window as any).editorHarness.saves.at(-1).content.content[0].content[0].text)).toBe('退出前保留的正文');
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/desktop-status/markdown-source-runtime.js'));
  delayed.release();await loaded;
  await page.evaluate(async()=>{await import(new URL('markdown-source-runtime.js',document.baseURI).href);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
  await expect(page.locator('#markdown-source .cm-content')).toHaveCount(0);await expect(page.locator('#markdown-source-panel')).toBeHidden();await expect(page.locator('main')).toHaveAttribute('inert','');
});

test('a delayed source request cannot replace a different document opened from the library',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('第一份文档的正文');
  const delayed=await delayMarkdownRuntime(page);await page.locator('#toggle-source').click();await delayed.requestStarted;
  await page.locator('#back-library').click();await create(page);await body.fill('第二份文档保留自己的内容');
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/desktop-status/markdown-source-runtime.js'));
  delayed.release();await loaded;
  await page.evaluate(async()=>{await import(new URL('markdown-source-runtime.js',document.baseURI).href);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
  await expect(body).toHaveText('第二份文档保留自己的内容');await expect(page.locator('#markdown-source .cm-content')).toHaveCount(0);await expect(page.locator('#toggle-source')).toBeEnabled();
});

test('a failed source entry request preserves text and can be retried without reloading the app',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('网络失败也保留正文');
  let attempts=0;
  await page.route('**/desktop-status/markdown-source-runtime.js*',route=>++attempts===1?route.abort('failed'):route.fallback());
  await page.locator('#toggle-source').click();await expect(page.locator('#message')).toContainText('源码编辑器暂未加载');await expect(page.locator('#toggle-source')).toBeEnabled();await expect(body).toHaveText('网络失败也保留正文');
  await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source .cm-content')).toHaveText('网络失败也保留正文');expect(attempts).toBe(2);
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
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('fluent-radio[value=dark]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('#reduce-motion').click();await expect(page.locator('html')).toHaveAttribute('data-reduce-motion','true');
  const sizes=await page.locator('.window-controls button').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));expect(sizes).toEqual([{w:46,h:36},{w:46,h:36},{w:46,h:36}]);
  expect(await page.locator('.workspace-nav .wp-icon svg').first().evaluate(n=>getComputedStyle(n).transform)).toBe('none');
  for(const width of [1280,960,420,360]){await page.setViewportSize({width,height:780});if(width<640&&!await page.locator('body').evaluate(n=>n.classList.contains('compact-nav')))await page.locator('#collapse-nav').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.setViewportSize({width:1280,height:800});await page.screenshot({path:info.outputPath('fluent-settings-dark.png')});
});

test('verification loads inside the shell without exposing native commands to that frame',async({page})=>{
  await desktop(page);await page.route('**/embedded-test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>核验页测试夹具</h1>'}));
  await page.getByRole('button',{name:'文件核验',exact:true}).click();await page.getByRole('button',{name:'在 WorkProof 内核验作品',exact:true}).click();
  await expect(page.frameLocator('#verifier-frame').getByRole('heading')).toHaveText('核验页测试夹具');await expect(page.locator('.workspace-nav')).toBeVisible();
  expect(await page.frameLocator('#verifier-frame').locator('body').evaluate(()=>typeof (window as any).__TAURI__)).toBe('undefined');
});

test('offline Word module exports real DOCX and imports it through the existing converter',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('离线 Word 转换测试');
  await page.evaluate(()=>{const w=window as any,original=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(c:string,a:any)=>{if(c==='editor_export')w.wordBytes=a.docx;return original(c,a);};});
  await page.getByLabel('导出格式').selectOption('docx');await page.locator('#export-document').click();
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
  await page.locator('#toggle-inspector').click();
  await expect(workspace).toHaveAttribute('data-inspector-open','true');
  await expect(workspace).toHaveClass(/pane-overlay-open/);
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  await page.setViewportSize({width:1600,height:900});
  await expect(workspace).toHaveAttribute('data-inspector-open','true');
  await page.locator('#toggle-inspector').click();
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  await page.reload();
  await page.getByRole('button',{name:'继续编辑 未命名文档'}).click();
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  const ribbonBeforeFocus=await workspace.getAttribute('data-ribbon-open');
  await page.locator('#focus-writing').click();
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
  if(await page.locator('#write-panel').getAttribute('data-inspector-open')!=='true')await page.locator('#toggle-inspector').click();
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

test('Markdown source keeps exact source in saved document and mode switching preserves rich content',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill('模式切换保留正文');
  await page.locator('[data-mode=markdown]').click();await expect(body).toContainText('模式切换保留正文');
  await page.locator('#toggle-source').click();const source=page.locator('#markdown-source .cm-content');await expect(source).toBeVisible();
  await source.fill('# 标题\n\n保留   源码空格');await page.locator('#save-document').click();
  const saved=await page.evaluate(()=>(window as any).editorHarness.saves.at(-1).content);
  expect(saved.attrs.markdownSource).toBe('# 标题\n\n保留   源码空格');
  await page.locator('[data-mode=word]').click();await expect(body.locator('h1')).toHaveText('标题');
  await page.locator('[data-mode=markdown]').click();await page.locator('#toggle-source').click();await expect(source).toContainText('保留   源码空格');
  await page.locator('[data-mode=word]').click();await body.click();await body.press('ControlOrMeta+a');await ensureRibbonOpen(page);await page.getByRole('button',{name:'下划线',exact:true}).click();
  await page.locator('[data-mode=markdown]').click();await expect(body.locator('u')).toHaveText(['标题','保留   源码空格']);
  await page.locator('#toggle-source').click();await expect(page.locator('#markdown-source-panel')).toBeVisible();
  await page.locator('#toggle-source').click();await expect(body.locator('u')).toHaveText(['标题','保留   源码空格']);
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

test('Markdown uses continuous layout and restores Word pagination preference without changing the document',async({page})=>{
  await desktop(page);const body=await create(page);await body.fill(Array.from({length:80},(_,i)=>`第 ${i+1} 行连续写作内容。`).join('\n'));
  await page.locator('#save-document').click();
  const original=await page.evaluate(()=>JSON.stringify((window as any).editorHarness.saves.at(-1).content));
  await ensureRibbonOpen(page);await page.locator('[data-ribbon=layout]').click();const pagination=page.locator('[data-command=pages]');
  await pagination.click();await expect(pagination).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-mode=markdown]').click();await expect(body).toHaveAttribute('rm-pagination-disabled','');await expect(pagination).toBeDisabled();
  await page.locator('[data-mode=word]').click();await expect(body).toHaveAttribute('rm-pagination-disabled','');await expect(pagination).toBeEnabled();
  await pagination.click();await expect(pagination).toHaveAttribute('aria-pressed','true');await expect(body).not.toHaveAttribute('rm-pagination-disabled','');
  await page.locator('[data-mode=markdown]').click();await expect(body).toHaveAttribute('rm-pagination-disabled','');
  await expect(body.locator('[data-rm-pagination]')).toHaveCount(0);
  await page.locator('[data-mode=word]').click();await expect(body).not.toHaveAttribute('rm-pagination-disabled','');
  await page.locator('#save-document').click();
  expect(await page.evaluate(()=>JSON.stringify((window as any).editorHarness.saves.at(-1).content))).toBe(original);
  await page.locator('[data-mode=markdown]').click();await page.locator('.workspace-nav [data-view=library]').click();await page.locator('#new-document').click();
  await expect(body).toHaveAttribute('rm-pagination-disabled','');
  await page.locator('[data-mode=word]').click();await expect(body).not.toHaveAttribute('rm-pagination-disabled','');
});

test('lossless Markdown tables tasks and embedded images remain editable and export their exact source',async({page})=>{
  await desktop(page);
  const text='# 可编辑 Markdown\n\n| 项目 | 状态 |\n| --- | --- |\n| 表格正文 | 完成 |\n\n- [ ] 待办事项\n- [x] 已完成事项\n\n![小图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yoAAAAAASUVORK5CYII=)';
  await page.locator('#markdown-file').setInputFiles({name:'无损编辑.md',mimeType:'text/markdown',buffer:Buffer.from(text)});
  const body=page.locator('#tiptap-editor .tiptap');await expect(body.locator('table')).toHaveCount(1);await expect(body.getByRole('checkbox')).toHaveCount(2);await expect(body.locator('img')).toHaveCount(1);
  await expect.poll(()=>body.locator('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.locator('#toggle-source').click();const source=page.locator('#markdown-source .cm-content');await expect(source).toBeVisible();await expect(source).toContainText('待办事项');
  await source.press('ControlOrMeta+End');await source.press('Enter');await source.pressSequentially('源码继续编辑');await page.locator('#toggle-source').click();await expect(body).toContainText('源码继续编辑');
  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI__.core.invoke;w.__TAURI__.core.invoke=(command:string,args:any)=>{if(command==='editor_export')w.exportedMarkdown=args.markdown;return invoke(command,args);};});
  await page.locator('#export-format').selectOption('markdown');await page.locator('#export-document').click();await expect.poll(()=>page.evaluate(()=>(window as any).exportedMarkdown)).toBe(text+'\n源码继续编辑');
});

test('closing freezes Markdown and waits for durable save before issuing the native close',async({page})=>{
  await desktop(page);const body=await create(page);
  await page.locator('[data-mode=markdown]').click();await page.locator('#toggle-source').click();
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
  await page.locator('#font-size').selectOption('18pt');await body.press('End');await page.locator('#font-size').selectOption('12pt');await body.pressSequentially('小号文字');
  await body.press('ControlOrMeta+a');await expect(page.locator('#font-size')).toHaveValue('__mixed');await expect(page.locator('#font-size option:checked')).toHaveText('多种格式');
  await body.press('ControlOrMeta+a');await body.press('ArrowLeft');await body.press('ArrowRight');await expect(page.locator('#font-size')).toHaveValue('18pt');
  await body.press('ControlOrMeta+a');await body.press('ArrowRight');await expect(page.locator('#font-size')).toHaveValue('12pt');
});

test('link dialog inserts edits validates and removes links while preserving their visible text',async({page})=>{
  await desktop(page);const body=await create(page);await body.click();await body.pressSequentially('需要链接的正文');await body.press('ControlOrMeta+a');await body.press('ControlOrMeta+k');
  await expect(page.locator('#link-dialog')).toBeVisible();await page.locator('#link-url').fill('https://example.com/first');await page.locator('#link-confirm').click();await expect(body).toBeFocused();
  await expect(body.locator('a')).toHaveAttribute('href','https://example.com/first');await expect(body.locator('a')).toHaveText('需要链接的正文');
  await body.locator('a').click({position:{x:5,y:5}});await body.press('ControlOrMeta+k');await expect(page.locator('#link-url')).toHaveValue('https://example.com/first');
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
  await page.locator('#navigation-mode').selectOption('auto');await page.setViewportSize({width:1280,height:820});
  await expect(page.locator('body')).not.toHaveClass(/compact-nav/);
  await page.locator('#navigation-mode').selectOption('closed');await page.reload();
  await expect(page.locator('body')).toHaveClass(/compact-nav/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('icon command tooltips explain their action and shortcut for keyboard users',async({page})=>{
  await desktop(page);await create(page);await page.locator('#save-document').focus();
  const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();await expect(tooltip).toContainText('保存');await expect(tooltip).toContainText('Ctrl+S');
  await expect(page.locator('#save-document')).toHaveAttribute('aria-describedby','workproof-command-tooltip');
  await page.keyboard.press('Escape');await expect(tooltip).toBeHidden();
});

test('embedded verification receives desktop appearance when theme and motion change',async({page})=>{
  await desktop(page);await page.route('**/embedded-test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>核验页测试夹具</h1><script>addEventListener("message",event=>{if(event.source===parent&&event.data.type==="workproof:appearance"){document.documentElement.dataset.theme=event.data.theme;document.documentElement.dataset.motion=String(event.data.reduceMotion);}});parent.postMessage({type:"workproof:verifier-ready"},"*");</script>'}));
  await page.getByRole('button',{name:'文件核验',exact:true}).click();await page.locator('#verify').click();
  const child=page.frameLocator('#verifier-frame').locator('html');await expect(child).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('fluent-radio[value=dark]').click();
  await expect(child).toHaveAttribute('data-theme','dark');await page.locator('#reduce-motion').click();await expect(child).toHaveAttribute('data-motion','true');
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
  await page.locator('#library-source-filter').selectOption('word');await expect(page.locator('#document-list .document-row')).toHaveCount(1);await expect(page.locator('#document-list')).toContainText('Word');
  await page.getByRole('button',{name:'查看记录 同名创作',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-view','external-document');
  await expect(page.locator('#external-actions > li')).toHaveCount(200);await expect(page.locator('#external-document-title')).toHaveText('同名创作');await expect(page.locator('#external-document-summary')).toContainText('205 条记录');
  await page.locator('#external-load-more').click();await expect(page.locator('#external-actions > li')).toHaveCount(205);await expect(page.locator('#external-load-more')).toBeHidden();
  await page.locator('#external-open-file').click();await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.openedExternalIds.length)).toBe(1);
  await page.locator('#external-back-library').click();await page.locator('#library-source-filter').selectOption('editor');await expect(page.getByRole('button',{name:'继续编辑 同名创作',exact:true})).toBeVisible();
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
  await page.locator('#library-source-filter').selectOption('word');await expect(page.locator('#document-list .document-row')).toHaveCount(3);await expect(page.getByRole('button',{name:'查看记录 未绑定的同名文件',exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'查看记录 多次记录.docx',exact:true}).click();await expect(page.locator('#external-session-select')).toHaveValue('known-new');await expect(page.locator('#external-session-select option')).toHaveCount(2);
  await page.locator('#external-session-select').selectOption('known-old');await expect(page.locator('#external-actions > li')).toHaveCount(1);await page.locator('#external-open-file').click();await expect.poll(()=>page.evaluate(()=>(window as any).editorHarness.openedExternalIds)).toEqual(['known-old']);
  await page.locator('#external-back-library').click();await page.locator('#library-source-filter').selectOption('vscode');await page.getByRole('button',{name:'查看记录 代码.py',exact:true}).click();await expect(page.locator('#external-open-file')).toBeDisabled();await expect(page.locator('#external-file-status')).toContainText('请在原应用中打开此文件');
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
  await page.locator('[data-pane-preference=ribbon]').selectOption('open');await page.locator('[data-pane-preference=outline]').selectOption('closed');await page.locator('[data-pane-preference=inspector]').selectOption('open');
  await page.getByRole('button',{name:'我的文档',exact:true}).click();await page.getByRole('button',{name:'继续编辑 未命名文档',exact:true}).click();
  const workspace=page.locator('#write-panel');
  await expect(workspace).toHaveAttribute('data-ribbon-open','true');await expect(workspace).toHaveAttribute('data-outline-open','false');await expect(workspace).toHaveAttribute('data-inspector-open','true');
  const before=await page.evaluate(()=>({compact:document.body.classList.contains('compact-nav'),preferences:['ribbon','outline','inspector'].map(name=>localStorage.getItem(`workproof.pane.${name}`))}));
  await page.locator('#focus-writing').click();await expect(page.locator('body')).toHaveClass(/simple-writing/);await expect(page.locator('#exit-simple-writing')).toBeVisible();
  await expect(page.locator('.workspace-nav')).toHaveAttribute('inert','');await expect(page.locator('.doc-head')).toHaveAttribute('inert','');
  await expect.poll(()=>page.locator('.editor-canvas').evaluate(element=>{const rectangle=element.getBoundingClientRect();return rectangle.width*rectangle.height/(innerWidth*innerHeight);})).toBeGreaterThanOrEqual(.7);
  await page.screenshot({path:info.outputPath('typora-simple-dark.png')});
  await page.keyboard.press('Escape');await expect(page.locator('body')).not.toHaveClass(/simple-writing/);await expect(page.locator('#exit-simple-writing')).toBeHidden();
  await expect(workspace).toHaveAttribute('data-ribbon-open','true');await expect(workspace).toHaveAttribute('data-outline-open','false');await expect(workspace).toHaveAttribute('data-inspector-open','true');
  await expect(page.locator('.workspace-nav')).not.toHaveAttribute('inert','');await expect(page.locator('.doc-head')).not.toHaveAttribute('inert','');await expect(body).toHaveText('精简模式让正文成为视线的中心。');
  expect(await page.evaluate(()=>({compact:document.body.classList.contains('compact-nav'),preferences:['ribbon','outline','inspector'].map(name=>localStorage.getItem(`workproof.pane.${name}`))}))).toEqual(before);
  await page.locator('#focus-writing').click();await page.locator('#exit-simple-writing').click();await expect(page.locator('body')).not.toHaveClass(/simple-writing/);
});

test('leaving the editor exits simple writing and releases navigation controls',async({page})=>{
  await desktop(page);await create(page);await page.locator('#focus-writing').click();await expect(page.locator('body')).toHaveClass(/simple-writing/);
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
    const mode=document.querySelector('.doc-head .mode-switch')!.getBoundingClientRect(),tabs=document.querySelector('.doc-head .document-tabs')!.getBoundingClientRect();
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
