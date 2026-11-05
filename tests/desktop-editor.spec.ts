import {test,expect,Page} from '@playwright/test';
import fs from 'node:fs';

// Browser tests exercise the real bundled Tiptap. Only native storage IPC is a
// fixture; engine editor::tests cover actual SQLite and Ed25519 separately.
async function desktop(page:Page){
  await page.route('**/desktop-status/**',route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)!;
    const type:Record<string,string>={'index.html':'text/html','word-worker.js':'application/javascript','components.js':'application/javascript','theme.css':'text/css','native-editor.css':'text/css','brand.png':'image/png'};
    return type[name]?route.fulfill({contentType:type[name],body:fs.readFileSync('apps/desktop/ui/'+name)}):route.abort();
  });
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    const w=window as any;
    const read=()=>JSON.parse(localStorage.getItem('test.editor.documents')||'{}');
    const write=(docs:any)=>localStorage.setItem('test.editor.documents',JSON.stringify(docs));
    w.editorHarness={failNext:false,saves:[],exports:0};
    w.__TAURI__={core:{invoke:async(command:string,args:any)=>{
      const docs=read();
      if(command==='engine_status')return {ready:true,sessions:0,events:0};
      if(command==='pending_adapters'||command==='adapter_connections')return [];
      if(command==='editor_list')return Object.values(docs);
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
      if(command==='window_action'){w.editorHarness.closed=true;return null;}
      if(command==='verifier_url')return 'http://127.0.0.1:4173/embedded-test/';
      throw new Error('Unexpected IPC '+command);
    }}};
  });
  await page.goto('/desktop-status/index.html');
  await expect(page.getByRole('button',{name:'新建文档',exact:true})).toBeVisible();
}
async function create(page:Page){await page.getByRole('button',{name:'新建文档',exact:true}).click();await expect(page.getByRole('textbox',{name:'文档正文'})).toBeVisible();return page.getByRole('textbox',{name:'文档正文'});}

test('real Tiptap edits and formats persist and reopen with independent navigation',async({page},info)=>{
  await desktop(page);const body=await create(page);
  await page.getByLabel('文档名称',{exact:true}).fill('学术写作记录');
  await body.fill('这是一份写作笔记。');await body.press('End');await body.pressSequentially(' hello world');await body.press('Enter');await body.pressSequentially('second paragraph');await body.press('Backspace');
  await body.press('Control+a');await page.getByRole('button',{name:'加粗',exact:true}).click();
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
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('button',{name:'重做',exact:true})).toBeEnabled();await page.getByRole('button',{name:'重做',exact:true}).click();
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
  expect(await page.locator('.workspace-nav .glyph').first().evaluate(n=>getComputedStyle(n).fontStyle)).toBe('normal');
  for(const width of [1280,960,420,360]){await page.setViewportSize({width,height:780});if(width<640&&!await page.locator('body').evaluate(n=>n.classList.contains('compact-nav')))await page.locator('#collapse-nav').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.setViewportSize({width:1280,height:800});await page.screenshot({path:info.outputPath('fluent-settings-dark.png')});
});

test('verification loads inside the shell without exposing native commands to that frame',async({page})=>{
  await desktop(page);await page.route('**/embedded-test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>核验页测试夹具</h1>'}));
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
  await page.getByRole('button',{name:'插入表格',exact:true}).click();await expect(body.locator('table')).toHaveCount(1);await page.getByRole('button',{name:'删除表格',exact:true}).click();
  await page.getByRole('button',{name:'分页符',exact:true}).click();await expect(body.locator('[data-page-break]')).toHaveCount(1);
  await body.press('ArrowDown');await page.getByRole('button',{name:'代码块',exact:true}).click();await expect(body.locator('pre')).toHaveCount(1);
  await body.press('ArrowLeft');await page.locator('#save-document').click();
  const kinds=await page.evaluate(()=>(window as any).editorHarness.saves.flatMap((s:any)=>s.actions).map((a:any)=>a.kind));expect(kinds).toEqual(expect.arrayContaining(['keyboard','selection','format']));
});
