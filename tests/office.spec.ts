import {test,expect} from '@playwright/test';

// Host API simulations verify add-in logic only. These are not licensed Word/WPS runtime tests.
for(const host of ['word','wps'] as const){
  test(`${host} adapter discovers host, keeps text private and exports its bound file`,async({page})=>{
    const requests:{route:string;body:any}[]=[];
    await page.addInitScript(({host})=>{
      const state={text:'private draft text',bytes:[80,75,3,4,1,2,3,4]};
      (window as any).hostFixture=state;
      if(host==='wps'){
        const doc={Name:'draft.docx',FullName:'C:\\private\\draft.docx',Path:'C:\\private',Content:{get Text(){return state.text;}},Paragraphs:{Count:1},Save(){}};
        (window as any).Application={ActiveDocument:doc,FileSystem:{readAsBinaryString:()=>String.fromCharCode(...state.bytes)}};
      }else{
        const file={size:state.bytes.length,sliceCount:1,getSliceAsync(_index:number,done:any){done({status:'succeeded',value:{data:state.bytes}});},closeAsync(done:any){done({status:'succeeded'});}};
        (window as any).Office={onReady:async()=>({host:'Word'}),context:{host:'Word',requirements:{isSetSupported:()=>true},document:{url:'https://institution.example/draft.docx',getFileAsync(_format:string,_options:any,done:any){done({status:'succeeded',value:file});}}}};
        (window as any).Word={run:async(fn:any)=>fn({document:{body:{get text(){return state.text;},load(){},paragraphs:{items:[{}],load(){}}}},sync:async()=>{}})};
      }
    },{host});
    const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
    await page.route('http://127.0.0.1:43127/**',async route=>{
      const req=route.request();
      if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
      const path=new URL(req.url()).pathname,body=req.postDataJSON();requests.push({route:path,body});
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
  });
}
