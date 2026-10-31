import {test,expect} from '@playwright/test';

// Host API simulations verify add-in logic only. These are not licensed Word/WPS runtime tests.
for(const variant of ['word','wps','wps-alias','wps-factory'] as const){
  const host=variant==='word'?'word':'wps';
  test(`${variant} adapter discovers host, keeps text private and exports its bound file`,async({page})=>{
    const requests:{route:string;body:any}[]=[];
    let revoked=false;
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
      if(revoked&&req.headers()['authorization']){await route.fulfill({status:403,headers,contentType:'application/json',body:JSON.stringify({error:'PAIRING_REQUIRED'})});return;}
      const result=path==='/v1/pairing'?{ticket:'host-api-fixture'}:path.includes('/pairing/')?{approved:true,token:'simulated-origin-grant'}:path==='/v1/sessions'?{session_id:'simulated-session'}:path.endsWith('/events')?{next_seq:100}:path.endsWith('/export')?{test_fixture:true}:{error:'unexpected route'};
      await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto('/office/index.html');
    await expect(page.locator('#host')).toContainText(host==='word'?'Microsoft Word':'WPS 文字');
    await page.getByRole('button',{name:'开始记录当前文档'}).click();
    await expect(page.locator('#status')).toContainText('记录中');
    await page.evaluate(()=>{(window as any).hostFixture.text+=' additional private content';});
    await expect.poll(()=>requests.some(r=>r.route.endsWith('/events')&&r.body?.events.some((e:any)=>e.kind==='edit'))).toBe(true);
    const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
    await page.getByRole('button',{name:'导出交付件与证书'}).click();
    await expect(page.locator('#status')).toContainText('已下载交付件和证书');
    await expect.poll(()=>downloads.length).toBe(2);expect(downloads).toEqual(['draft.docx','draft.docx.wproof']);
    const all=JSON.stringify(requests);expect(all).not.toContain('private draft text');expect(all).not.toContain('additional private content');
    expect(requests.find(r=>r.route==='/v1/sessions')?.body.source).toBe(host);
    expect(requests.find(r=>r.route.endsWith('/export'))?.body.artifact_hash).toMatch(/^[0-9a-f]{64}$/);
    revoked=true;
    await page.evaluate(()=>{(window as any).hostFixture.text+=' after revocation';});
    await expect(page.locator('#status')).toContainText('连接已撤销或过期');
    await expect(page.getByRole('button',{name:'继续记录'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'导出交付件与证书'})).toBeDisabled();
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
      await expect(page.locator('#status')).toContainText('活动文档已改变');
      await expect(page.getByRole('button',{name:'导出交付件与证书'})).toBeDisabled();
    }else{
      await page.getByRole('button',{name:'导出交付件与证书'}).click();
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
