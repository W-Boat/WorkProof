import {test,expect} from '@playwright/test';

for(const source of ['wps-presentation','wps-spreadsheets'] as const){
  test(source+' records same-size changes, keeps contents private and binds export',async({page})=>{
    const requests:{path:string;body:any}[]=[];
    const presentation=source==='wps-presentation';
    const name=presentation?'draft.pptx':'draft.xlsx';
    await page.addInitScript(({presentation,name})=>{
      const state={text:'PRIVATE-CONTENT',position:10,switched:false};
      (window as any).structureFixture=state;
      const shape={Type:1,Left:10,Top:10,Width:100,Height:30,Rotation:0,HasTextFrame:true,
        TextFrame:{TextRange:{get Text(){return state.text;}}}};
      Object.defineProperty(shape,'Left',{get:()=>state.position});
      const range={Rows:{Count:1},Columns:{Count:1},Row:1,Column:1,get Formula(){return [[state.text]];}};
      const document={Name:name,Path:'C:\\private',get FullName(){return 'C:\\private\\'+(state.switched?'other-':'')+name;},
        Saved:true,Save(){},
        Slides:{Count:1,Item:()=>({Shapes:{Count:1,Item:()=>shape}})},
        Worksheets:{Count:1,Item:()=>({Name:'Sheet1',UsedRange:range})}};
      (window as any).Application={[presentation?'ActivePresentation':'ActiveWorkbook']:document,
        FileSystem:{readAsBinaryString:()=>String.fromCharCode(80,75,3,4,8,9)}};
    },{presentation,name});
    await page.route('http://127.0.0.1:43127/**',async route=>{
      const request=route.request();
      const headers={'access-control-allow-origin':'http://127.0.0.1:4173',
        'access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
      if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
      const path=new URL(request.url()).pathname;
      requests.push({path,body:request.postDataJSON()});
      const result=path==='/v1/pairing'?{ticket:'structure-fixture'}:path.includes('/pairing/')?{approved:true,token:'fixture-grant'}:
        path==='/v1/sessions'?{session_id:'fixture-session'}:path.endsWith('/events')?{next_seq:100}:path.endsWith('/export')?{fixture:true}:{};
      await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto('/office/index.html?host='+source);
    await expect(page.locator('#host')).toHaveText(presentation?'WPS 演示':'WPS 表格');
    await page.locator('#start').click();
    await expect(page.locator('#status')).toContainText('记录中');
    await page.evaluate(()=>{const state=(window as any).structureFixture;state.text='PRIVATE-CHANGED';state.position=30;});
    await expect.poll(()=>requests.some(r=>r.body?.events?.some((e:any)=>e.kind==='edit'))).toBe(true);
    const edit=requests.flatMap(r=>r.body?.events??[]).find(e=>e.kind==='edit');
    expect(edit.checkpoint).toMatch(/^[0-9a-f]{64}$/);
    expect(edit.inserted).toBe(0);expect(edit.deleted).toBe(0);
    expect(edit.metrics).toEqual(presentation?{slides:1,shapes:1}:{sheets:1,used_cells:1});
    expect(JSON.stringify(requests)).not.toContain('PRIVATE-');
    expect(requests.find(r=>r.path==='/v1/sessions')?.body.source).toBe(source);
    await page.locator('#export').click();
    await expect(page.locator('#delivery')).toBeVisible();
    await expect(page.locator('#save-artifact')).toHaveAttribute('download',name);
    expect(requests.find(r=>r.path.endsWith('/export'))?.body.artifact_hash).toMatch(/^[0-9a-f]{64}$/);
    await page.evaluate(()=>{(window as any).structureFixture.switched=true;});
    await expect(page.locator('#status')).toContainText('切换到另一份文档');
    await expect(page.locator('#export')).toBeDisabled();
  });
}

// Host API simulations verify add-in logic only. These are not licensed Word/WPS runtime tests.
for(const variant of ['word','wps','wps-alias','wps-factory'] as const){
  const host=variant==='word'?'word':'wps';
  test(`${variant} adapter discovers host, keeps text private and exports its bound file`,async({page})=>{
    const requests:{route:string;body:any}[]=[];
    let revoked=false;
    let releasePairing!:()=>void,releaseExport!:()=>void;
    const pairingGate=new Promise<void>(resolve=>{releasePairing=resolve;}),exportGate=new Promise<void>(resolve=>{releaseExport=resolve;});
    await page.addInitScript(({host,variant})=>{
      const state={text:'private draft text',bytes:[80,75,3,4,1,2,3,4]};
      (window as any).hostFixture=state;
      if(host==='wps'){
        const doc={Name:'draft.docx',FullName:'C:\\private\\draft.docx',Path:'C:\\private',Content:{get Text(){return state.text;}},Paragraphs:{Count:1},Save(){}};
        const application={ActiveDocument:doc,FileSystem:{readAsBinaryString:()=>String.fromCharCode(...state.bytes)}};
        if(variant==='wps-alias')(window as any).wps=application;
        else if(variant==='wps-factory')(window as any).wps={WpsApplication:()=>application};
        else (window as any).Application=application;
      }else{
        const file={size:state.bytes.length,sliceCount:1,getSliceAsync(_index:number,done:any){done({status:'succeeded',value:{data:state.bytes}});},closeAsync(done:any){done({status:'succeeded'});}};
        (window as any).Office={onReady:async()=>({host:'Word'}),context:{host:'Word',requirements:{isSetSupported:()=>true},document:{url:'https://institution.example/draft.docx',getFileAsync(_format:string,_options:any,done:any){done({status:'succeeded',value:file});}}}};
        (window as any).Word={run:async(fn:any)=>fn({document:{body:{get text(){return state.text;},load(){},paragraphs:{items:[{}],load(){}}}},sync:async()=>{}})};
      }
    },{host,variant});
    const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
    await page.route('http://127.0.0.1:43127/**',async route=>{
      const req=route.request();
      if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
      const path=new URL(req.url()).pathname,body=req.postDataJSON();requests.push({route:path,body});
      if(path==='/v1/pairing')await pairingGate;
      if(path.endsWith('/export'))await exportGate;
      if(revoked&&req.headers()['authorization']){await route.fulfill({status:403,headers,contentType:'application/json',body:JSON.stringify({error:'PAIRING_REQUIRED'})});return;}
      const result=path==='/v1/pairing'?{ticket:'host-api-fixture'}:path.includes('/pairing/')?{approved:true,token:'simulated-origin-grant'}:path==='/v1/sessions'?{session_id:'simulated-session'}:path.endsWith('/events')?{next_seq:100}:path.endsWith('/export')?{test_fixture:true}:{error:'unexpected route'};
      await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto('/office/index.html');
    await expect(page.locator('#host')).toContainText(host==='word'?'Microsoft Word':'WPS 文字');
    await page.getByRole('button',{name:'开始记录当前文档'}).click();
    await expect(page.getByRole('button',{name:'开始记录当前文档'})).toBeDisabled();
    await page.evaluate(()=>document.getElementById('start')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    await expect.poll(()=>requests.filter(request=>request.route==='/v1/pairing').length).toBe(1);
    releasePairing();
    await expect(page.locator('#status')).toContainText('记录中');
    await page.evaluate(()=>{(window as any).hostFixture.text+=' additional private content';});
    await expect.poll(()=>requests.some(r=>r.route.endsWith('/events')&&r.body?.events.some((e:any)=>e.kind==='edit'))).toBe(true);
    const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
    await page.getByRole('button',{name:'导出作品和证书'}).click();
    await expect.poll(()=>requests.filter(request=>request.route.endsWith('/export')).length).toBe(1);
    await expect(page.getByRole('button',{name:'暂停记录'})).toBeDisabled();
    await page.evaluate(()=>document.getElementById('export')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    expect(requests.filter(request=>request.route.endsWith('/export'))).toHaveLength(1);releaseExport();
    await expect(page.locator('#status')).toContainText('交付文件已准备');
    expect(downloads).toEqual([]);
    await page.getByRole('link',{name:'保存作品',exact:true}).click();
    await page.getByRole('link',{name:'保存证书',exact:true}).click();
    await expect.poll(()=>downloads.length).toBe(2);expect(downloads).toEqual(['draft.docx','draft.docx.wproof']);
    const all=JSON.stringify(requests);expect(all).not.toContain('private draft text');expect(all).not.toContain('additional private content');
    expect(requests.find(r=>r.route==='/v1/sessions')?.body.source).toBe(host);
    expect(requests.find(r=>r.route.endsWith('/export'))?.body.artifact_hash).toMatch(/^[0-9a-f]{64}$/);
    revoked=true;
    await page.evaluate(()=>{(window as any).hostFixture.text+=' after revocation';});
    await expect(page.locator('#status')).toContainText('连接已撤销或过期');
    await expect(page.getByRole('button',{name:'继续记录'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'导出作品和证书'})).toBeDisabled();
  });
}

for(const failure of ['unsaved','save-denied','empty-bytes','unicode-bytes','renamed','switched-document'] as const){
  test(`wps refuses unsafe delivery: ${failure}`,async({page})=>{
    let exports=0;
    const downloads:string[]=[];
    page.on('download',download=>downloads.push(download.suggestedFilename()));
    await page.addInitScript(({failure})=>{
      const state={identity:'C:\\private\\draft.docx',path:'C:\\private',saved:true};
      const doc={Name:'draft.docx',get FullName(){return state.identity;},get Path(){return state.path;},get Saved(){return state.saved;},Content:{Text:'secret body'},Paragraphs:{Count:1},Save(){
        if(failure==='save-denied')state.saved=false;
        if(failure==='renamed')state.identity='C:\\private\\renamed.docx';
      }};
      (window as any).hostFixture=state;
      (window as any).wps={ActiveDocument:doc,FileSystem:{readAsBinaryString:()=>failure==='empty-bytes'?'':failure==='unicode-bytes'?'\u4e2d':'PK\u0003\u0004'}};
    },{failure});
    const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
    await page.route('http://127.0.0.1:43127/**',async route=>{
      if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/export'))exports++;
      const result=path==='/v1/pairing'?{ticket:'fixture'}:path.includes('/pairing/')?{approved:true,token:'fixture-grant'}:path==='/v1/sessions'?{session_id:'fixture-session'}:{next_seq:10};
      await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto('/office/index.html?host=wps');
    await expect(page.locator('#host')).toContainText('WPS');
    await page.getByRole('button',{name:'开始记录当前文档'}).click();
    await expect(page.locator('#status')).toContainText('记录中');
    if(failure==='unsaved')await page.evaluate(()=>{(window as any).hostFixture.path='';});
    if(failure==='switched-document'){
      await page.getByRole('button',{name:'暂停记录'}).click();
      await expect(page.locator('#status')).toContainText('已暂停');
      await page.evaluate(()=>{(window as any).hostFixture.identity='C:\\private\\other.docx';});
      await page.getByRole('button',{name:'继续记录'}).click();
      await expect(page.locator('#status')).toContainText('你已切换到另一份文档');
      await expect(page.getByRole('button',{name:'导出作品和证书'})).toBeDisabled();
    }else{
      await page.getByRole('button',{name:'导出作品和证书'}).click();
      const messages={'unsaved':'请先保存','save-denied':'保存未完成','empty-bytes':'有效交付文件','unicode-bytes':'不是二进制字节','renamed':'路径发生变化'};
      await expect(page.locator('#status')).toContainText(messages[failure]);
    }
    expect(exports).toBe(0);expect(downloads).toEqual([]);
  });
}

test('unsupported WPS host fails locally without loading the Microsoft runtime',async({page})=>{
  const external:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).hostname==='appsforoffice.microsoft.com')external.push(request.url());});
  await page.goto('/office/index.html?host=wps');
  await expect(page.locator('#status')).toContainText('当前 WPS 未提供可用的文档接口');
  await expect(page.getByRole('button',{name:'开始记录当前文档'})).toBeDisabled();
  expect(external).toEqual([]);
});

test('local pause stops sampling while collector writes fail and resumes after recovery',async({page})=>{
  await page.addInitScript(()=>{
    const state={text:'initial private text',reads:0};(window as any).pauseFixture=state;
    (window as any).wps={ActiveDocument:{Name:'draft.docx',FullName:'C:/draft.docx',Content:{get Text(){state.reads++;return state.text;}},Paragraphs:{Count:1}}};
  });
  let offline=false;const events:any[]=[];
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
  await page.route('http://127.0.0.1:43127/**',async route=>{
    const request=route.request();if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    const path=new URL(request.url()).pathname;
    if(path.endsWith('/events')&&offline){await route.fulfill({status:503,headers,json:{error:'OFFLINE_FIXTURE'}});return;}
    if(path.endsWith('/events'))events.push(...request.postDataJSON().events);
    await route.fulfill({status:200,headers,json:path==='/v1/pairing'?{ticket:'fixture'}:path.includes('/pairing/')?{approved:true,token:'grant'}:path==='/v1/sessions'?{session_id:'session'}:{next_seq:events.length}});
  });
  await page.goto('/office/index.html?host=wps');await page.getByRole('button',{name:'开始记录当前文档'}).click();await expect(page.locator('#status')).toContainText('记录中');
  offline=true;await page.evaluate(()=>{(window as any).pauseFixture.text+=' unsent changes';});
  await expect(page.locator('#status')).toContainText('记录服务没有完成');
  await page.getByRole('button',{name:'暂停记录',exact:true}).click();await expect(page.locator('#status')).toContainText('已暂停本机采样');
  await expect(page.getByRole('button',{name:'继续记录',exact:true})).toBeEnabled();
  const reads=await page.evaluate(()=>(window as any).pauseFixture.reads);
  await page.waitForTimeout(2200);expect(await page.evaluate(()=>(window as any).pauseFixture.reads)).toBe(reads);
  offline=false;await page.getByRole('button',{name:'继续记录',exact:true}).click();await expect(page.locator('#status')).toContainText('记录中');
  const kinds=events.map(event=>event.kind);expect(kinds).toContain('pause');expect(kinds).toContain('gap');expect(kinds.indexOf('pause')).toBeLessThan(kinds.indexOf('resume'));
});

test('cancel pairing ignores a late approval and creates no session',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(AbortSignal,'any',{value:undefined,configurable:true});Object.defineProperty(AbortSignal,'timeout',{value:undefined,configurable:true});
    (window as any).wps={ActiveDocument:{Name:'draft.docx',FullName:'C:/draft.docx',Content:{Text:'private text'},Paragraphs:{Count:1}}};
  });
  let polls=0,sessions=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
  await page.route('http://127.0.0.1:43127/**',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    const path=new URL(route.request().url()).pathname;if(path.includes('/pairing/')){polls++;await gate;}if(path==='/v1/sessions')sessions++;
    await route.fulfill({status:200,headers,json:path==='/v1/pairing'?{ticket:'fixture'}:{approved:true,token:'late-grant'}}).catch(()=>{});
  });
  await page.goto('/office/index.html?host=wps');await page.getByRole('button',{name:'开始记录当前文档'}).click();await expect.poll(()=>polls).toBe(1);
  await page.getByRole('button',{name:'取消连接',exact:true}).click();await expect(page.locator('#status')).toContainText('已取消连接');
  await expect(page.getByRole('button',{name:'开始记录当前文档'})).toBeEnabled();release();await page.waitForTimeout(200);expect(sessions).toBe(0);
});

test('pause does not wait for a hung host snapshot and ignores its late response',async({page})=>{
  await page.addInitScript(()=>{
    const state={hold:false,waiting:false,text:'initial text',release:()=>{}};(window as any).hungHost=state;
    (window as any).Office={onReady:async()=>{},context:{host:'Word',document:{url:'https://example.org/draft.docx'}}};
    (window as any).Word={run:async(fn:any)=>{
      const text=state.text;
      if(state.hold){state.waiting=true;await new Promise<void>(resolve=>{state.release=resolve;});}
      return fn({document:{body:{text,load(){},paragraphs:{items:[{}],load(){}}}},sync:async()=>{}});
    }};
  });
  const events:any[]=[];const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
  await page.route('http://127.0.0.1:43127/**',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/events'))events.push(...route.request().postDataJSON().events);
    await route.fulfill({status:200,headers,json:path==='/v1/pairing'?{ticket:'fixture'}:path.includes('/pairing/')?{approved:true,token:'grant'}:path==='/v1/sessions'?{session_id:'session'}:{next_seq:events.length}});
  });
  await page.goto('/office/index.html');await page.getByRole('button',{name:'开始记录当前文档'}).click();await expect(page.locator('#status')).toContainText('记录中');
  await page.evaluate(()=>{(window as any).hungHost.text='old pending sample';(window as any).hungHost.hold=true;});
  await expect.poll(()=>page.evaluate(()=>(window as any).hungHost.waiting)).toBe(true);
  await page.getByRole('button',{name:'暂停记录',exact:true}).click();
  await expect(page.getByRole('button',{name:'继续记录',exact:true})).toBeEnabled({timeout:3000});
  expect(events.some(event=>event.kind==='pause')).toBe(true);
  await page.evaluate(()=>{(window as any).hungHost.hold=false;(window as any).hungHost.text='fresh resume snapshot';});
  await page.getByRole('button',{name:'继续记录',exact:true}).click();await expect(page.locator('#status')).toContainText('记录中');
  await page.evaluate(()=>(window as any).hungHost.release());await page.waitForTimeout(100);
  expect(events.some(event=>event.kind==='edit')).toBe(false);
});
