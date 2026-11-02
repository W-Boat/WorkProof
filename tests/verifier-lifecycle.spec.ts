import {test,expect} from '@playwright/test';

test('explicit demo clears an unrelated recipient fingerprint and runs real verification',async({page})=>{
  await page.goto('/');
  await page.getByText('收到证书指纹？核对是否为同一张证书（可选）',{exact:true}).click();
  await page.getByLabel('发送者提供的完整证书指纹',{exact:true}).fill('f'.repeat(64));
  await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await expect(page.getByLabel('发送者提供的完整证书指纹',{exact:true})).toHaveValue('');
});

test('a late demo response cannot replace a newly selected real file',async({page})=>{
  let release!:()=>void,arrived!:()=>void,delivered!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const requested=new Promise<void>(resolve=>arrived=resolve);
  const finished=new Promise<void>(resolve=>delivered=resolve);
  await page.route('**/demo/essay.md',async route=>{
    const response=await route.fetch();arrived();await gate;
    try{await route.fulfill({response});}catch{/* The obsolete request may already be aborted. */}
    finally{delivered();}
  });
  await page.goto('/');
  await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await requested;
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'my-current-file.md',mimeType:'text/plain',buffer:Buffer.from('user selected file')});
  release();await finished;
  await expect(page.getByRole('region',{name:'核验作品与证书'}).getByText('my-current-file.md',{exact:true})).toBeVisible();
  await expect(page.getByText('下一步：选择配套证书',{exact:true})).toBeVisible();
  await expect(page.getByText('证据核验通过',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'开始本地核验',exact:true})).toBeDisabled();
});

test('cancelled worker cannot restore its real Wasm success after a file replacement',async({page})=>{
  await page.addInitScript(()=>{
    const state=window as unknown as {holdProofResult:boolean;heldReportValid?:boolean;releaseProofResult?:()=>void};
    state.holdProofResult=true;
    const NativeWorker=window.Worker;
    // The real module worker still hashes the file and runs Rust Wasm. Only its
    // final delivery is delayed, to exercise a callback queued before cancellation.
    window.Worker=class extends NativeWorker{
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);
        this.addEventListener('message',event=>{
          if(!state.holdProofResult||event.data?.type!=='result')return;
          event.stopImmediatePropagation();
          const report=event.data;
          state.heldReportValid=report.report?.valid===true;
          state.releaseProofResult=()=>{
            state.holdProofResult=false;
            this.onmessage?.call(this,new MessageEvent('message',{data:report}));
            this.onerror?.call(this,new ErrorEvent('error',{message:'Delayed old worker error'}));
            this.onmessageerror?.call(this,new MessageEvent('messageerror'));
          };
        });
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await page.waitForFunction(()=>typeof (window as unknown as {releaseProofResult?:()=>void}).releaseProofResult==='function');
  expect(await page.evaluate(()=>(window as unknown as {heldReportValid:boolean}).heldReportValid)).toBe(true);
  await expect(page.getByText('证据核验通过',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'取消核验',exact:true}).click();
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'replaced.md',mimeType:'text/plain',buffer:Buffer.from('replacement is not the signed artifact')});
  await page.evaluate(()=>(window as unknown as {releaseProofResult:()=>void}).releaseProofResult());
  await expect(page.getByText('证据核验通过',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'核验作品与证书'}).getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
  await expect(page.getByText('证据核验未通过',{exact:true})).toBeVisible();
  await expect(page.getByText('作品与证书不匹配。请向提供者索取与这份证书对应的原始作品。',{exact:true})).toBeVisible();
  await expect(page.getByText('证据核验通过',{exact:true})).toHaveCount(0);
});
