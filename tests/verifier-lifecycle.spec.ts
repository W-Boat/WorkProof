import {test,expect} from '@playwright/test';

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
