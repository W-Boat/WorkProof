import {test,expect} from '@playwright/test';

const appearance={type:'workproof:appearance',theme:'dark',reduceMotion:true};

test('embedding query and self messages cannot hide standalone navigation',async({page})=>{
  await page.goto('/?embedded=1&parentOrigin=http%3A%2F%2F127.0.0.1%3A4173');
  await page.evaluate(value=>window.postMessage(value,window.location.origin),appearance);
  await expect(page.locator('.wp-rail')).toBeVisible();
  await expect(page.locator('.wp-stage')).not.toHaveClass(/wp-embedded/);
});

test('validated parent appearance integrates the embedded verifier without losing controls',async({page},testInfo)=>{
  await page.route('**/embedding-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><iframe title="核验工作台" style="width:100%;height:900px;border:0"></iframe><script>window.addEventListener("message",event=>{if(event.data&&event.data.type==="workproof:verifier-ready")window.verifierReady=true;});const f=document.querySelector("iframe");f.src="/?embedded=1&parentOrigin="+encodeURIComponent(location.origin);</script></body></html>'}));
  await page.goto('/embedding-fixture');
  const verifier=page.frameLocator('iframe');
  await expect.poll(()=>page.evaluate(()=>(window as any).verifierReady)).toBe(true);
  await expect(verifier.locator('.wp-rail')).toBeVisible();
  await page.evaluate(value=>{
    const iframe=document.querySelector('iframe')!;
    iframe.contentWindow!.postMessage(value,window.location.origin);
  },appearance);
  await expect(verifier.locator('.wp-stage')).toHaveClass(/wp-embedded/);
  await expect(verifier.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(verifier.locator('html')).toHaveAttribute('data-workproof-motion','reduced');
  await expect(verifier.locator('.wp-rail')).toBeHidden();
  await expect(verifier.locator('.wp-topbar')).toBeHidden();
  await expect(verifier.getByRole('button',{name:'开始本地核验'})).toBeVisible();
  await expect(verifier.getByRole('button',{name:'先体验一份演示证据'})).toBeVisible();
  const overflow=await verifier.locator('html').evaluate(node=>node.scrollWidth>node.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({path:testInfo.outputPath('embedded-verifier-dark.png'),fullPage:true});
  await page.evaluate(()=>document.querySelector('iframe')!.contentWindow!.postMessage({type:'workproof:appearance',theme:'light',reduceMotion:false},window.location.origin));
  await expect(verifier.locator('html')).toHaveAttribute('data-theme','light');
  await expect(verifier.locator('html')).toHaveAttribute('data-workproof-motion','full');
  await page.screenshot({path:testInfo.outputPath('embedded-verifier-light.png'),fullPage:true});
});

test('untrusted requested parent origin leaves the standalone shell visible',async({page})=>{
  await page.route('**/embedding-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><iframe src="/?embedded=1&amp;parentOrigin=https%3A%2F%2Funtrusted.example"></iframe>'}));
  await page.goto('/embedding-fixture');
  const verifier=page.frameLocator('iframe');
  await expect(verifier.locator('.wp-rail')).toBeVisible();
  await page.evaluate(value=>document.querySelector('iframe')!.contentWindow!.postMessage(value,window.location.origin),appearance);
  await expect(verifier.locator('.wp-stage')).not.toHaveClass(/wp-embedded/);
});
