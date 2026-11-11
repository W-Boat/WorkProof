import {test,expect} from '@playwright/test';

const appearance={type:'workproof:appearance',theme:'dark',reduceMotion:true};

test('embedding query and self messages cannot hide standalone navigation',async({page})=>{
  await page.goto('/?embedded=1&parentOrigin=http%3A%2F%2F127.0.0.1%3A4173');
  await page.evaluate(value=>window.postMessage(value,window.location.origin),appearance);
  await expect(page.locator('.wp-rail')).toBeVisible();
  await expect(page.locator('.wp-stage')).not.toHaveClass(/wp-embedded|wp-fluent/);
});

test('validated parent appearance integrates the embedded verifier without losing controls',async({page},testInfo)=>{
  test.setTimeout(45000);
  await page.route('**/embedding-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><iframe title="核验工作台" style="width:100%;height:900px;border:0"></iframe><script>window.addEventListener("message",event=>{if(event.data&&event.data.type==="workproof:verifier-ready")window.verifierReady=true;});const f=document.querySelector("iframe");f.src="/?embedded=1&parentOrigin="+encodeURIComponent(location.origin);</script></body></html>'}));
  await page.goto('/embedding-fixture');
  const verifier=page.frameLocator('iframe');
  await expect.poll(()=>page.evaluate(()=>(window as any).verifierReady)).toBe(true);
  await expect(verifier.locator('.wp-rail')).toBeVisible();
  await page.evaluate(value=>{
    const iframe=document.querySelector('iframe')!;
    iframe.contentWindow!.postMessage(value,window.location.origin);
  },appearance);
  await expect(verifier.locator('.wp-stage')).toHaveClass(/wp-fluent wp-embedded/);
  const primary=verifier.getByRole('button',{name:'开始本地核验'});
  await expect(primary).toHaveAttribute('appearance','primary');
  expect(await primary.evaluate(element=>element.localName)).toBe('fluent-button');
  await expect(verifier.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(verifier.locator('html')).toHaveAttribute('data-workproof-motion','reduced');
  await expect(verifier.locator('.wp-rail')).toBeHidden();
  await expect(verifier.locator('.wp-topbar')).toBeHidden();
  await expect(verifier.getByRole('button',{name:'开始本地核验'})).toBeVisible();
  await expect(verifier.getByRole('button',{name:'先体验一份演示证据'})).toBeVisible();
  await expect(verifier.locator('.verify-actions .action-label')).toBeVisible();
  const fileCard=verifier.locator('.uploads .fluent-upload').first();
  expect(await fileCard.evaluate(card=>{
    const icon=card.querySelector('.upload-icon')!.getBoundingClientRect();
    const text=card.querySelector('.upload-copy')!.getBoundingClientRect();
    return text.left>=icon.right&&Math.abs((text.top+text.bottom)-(icon.top+icon.bottom))<=4;
  })).toBe(true);
  const overflow=await verifier.locator('html').evaluate(node=>node.scrollWidth>node.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({path:testInfo.outputPath('embedded-verifier-dark.png'),fullPage:true});
  await page.evaluate(()=>document.querySelector('iframe')!.contentWindow!.postMessage({type:'workproof:appearance',theme:'light',reduceMotion:false},window.location.origin));
  await expect(verifier.locator('html')).toHaveAttribute('data-theme','light');
  await expect(verifier.locator('html')).toHaveAttribute('data-workproof-motion','full');
  await page.screenshot({path:testInfo.outputPath('embedded-verifier-light.png'),fullPage:true});
  await verifier.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect(verifier.locator('#verification-result')).toContainText('证据核验通过');
  const chartSelector=verifier.getByRole('combobox',{name:'选择统计图'});
  const names=['操作频次','新增与删除','文档长度','累计新增','单次写入散点','操作构成','操作热图','写入间隔箱线图','操作矩形树图','新增量直方图'];
  for(const name of names){
    await chartSelector.click();
    await expect(chartSelector).toHaveAttribute('aria-expanded','true');
    await expect(verifier.locator('.verification-charts fluent-option')).toHaveCount(10);
    await verifier.getByRole('option',{name,exact:true}).click();
    await expect(chartSelector).toHaveAttribute('aria-expanded','false');
    await expect(chartSelector).toContainText(name);
    await expect(verifier.getByRole('img',{name:new RegExp(`^${name}，`)}).locator('canvas')).toBeVisible();
  }
  await verifier.getByRole('button',{name:'查看图表数据'}).click();
  await expect(verifier.getByRole('table',{name:'新增量直方图 · 图表数据'})).toBeVisible();
  await expect(verifier.getByRole('columnheader',{name:'单次新增字符数'})).toBeVisible();
  await verifier.getByRole('button',{name:'查看图表',exact:true}).click();
  const filter=verifier.getByRole('group',{name:'筛选检验项'});
  await filter.getByRole('button',{name:/^需复核/}).click();
  await expect(verifier.locator('.behavior-report tbody tr[data-review=false]')).toHaveCount(0);
  await verifier.locator('.verification-charts').scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('embedded-verifier-charts.png')});

  const uploads=verifier.locator('.uploads .fluent-upload');
  for(const [index,name] of ['behavior-bulk.txt','behavior-bulk.txt.wproof'].entries()){
    await uploads.nth(index).evaluate(async (element,filename)=>{
      const response=await fetch('/demo/'+filename);
      if(!response.ok)throw new Error('Missing signed fixture '+filename);
      const dataTransfer=new DataTransfer();
      dataTransfer.items.add(new File([await response.blob()],filename));
      element.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));
    },name);
    await expect(uploads.nth(index)).toContainText(name);
  }
  await primary.click();
  await expect(verifier.locator('#verification-result')).toContainText('编辑过程有待复核提醒');
  const sheet=verifier.getByRole('region',{name:'编辑过程检验单',exact:true});
  await sheet.getByRole('button',{name:/^需复核/}).click();
  await expect(sheet.getByRole('row').filter({has:verifier.getByRole('rowheader',{name:'单次最大新增',exact:true})})).toContainText('↑');
  await expect(sheet.getByRole('columnheader',{name:'实测'})).toBeVisible();
  await verifier.getByRole('button',{name:'查看原始核验详情'}).click();
  await expect(verifier.locator('.fluent-raw-verification')).toBeVisible();
  await sheet.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('embedded-verifier-diagnosis.png')});
  await expect(verifier.locator('fluent-slider[aria-label="浏览事件"]')).toBeVisible();
  const changes=verifier.getByRole('checkbox',{name:'新增与删除',exact:true});
  await expect(changes).toHaveAttribute('aria-checked','true');
  await changes.click();
  await expect(changes).toHaveAttribute('aria-checked','false');
});

test('untrusted requested parent origin leaves the standalone shell visible',async({page})=>{
  await page.route('**/embedding-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><iframe src="/?embedded=1&amp;parentOrigin=https%3A%2F%2Funtrusted.example"></iframe>'}));
  await page.goto('/embedding-fixture');
  const verifier=page.frameLocator('iframe');
  await expect(verifier.locator('.wp-rail')).toBeVisible();
  await page.evaluate(value=>document.querySelector('iframe')!.contentWindow!.postMessage(value,window.location.origin),appearance);
  await expect(verifier.locator('.wp-stage')).not.toHaveClass(/wp-embedded|wp-fluent/);
});
