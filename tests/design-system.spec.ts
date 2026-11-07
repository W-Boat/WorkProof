import {test,expect} from '@playwright/test';

test('shared institution controls, theme preference and mobile layout remain usable',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'证据核验',exact:true})).toBeVisible();
  const primary=page.getByRole('button',{name:'开始本地核验'});
  await expect(primary).toHaveClass(/btn-primary/);
  const colors=await primary.evaluate(element=>{const probe=document.createElement('span');probe.style.color='var(--blue)';element.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {background:getComputedStyle(element).backgroundColor,expected};});
  expect(colors.background).toBe(colors.expected);
  expect(await page.locator('.rail-brand img').evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true);
  await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/unified-light-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'切换为深色主题'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold.appearance')!).theme)).toBe('dark');
  await page.screenshot({path:'test-results/unified-dark-desktop.png',fullPage:true});
  for(const width of [390,768,1280]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await expect(page.getByRole('button',{name:'查看核验结果',exact:true})).toBeVisible();
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/unified-dark-mobile.png',fullPage:true});
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'切换为浅色主题'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('raw details retain keyboard focus and do not leave an overlay after Escape',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();
  await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const trigger=page.getByRole('button',{name:'查看原始核验详情'});
  await trigger.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'原始核验详情'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();
  await expect(page.locator('.wp-dialog-overlay')).toHaveCount(0);
  await page.getByRole('button',{name:'保存证书图片'}).focus();
  await expect(page.getByRole('button',{name:'保存证书图片'})).toBeFocused();
});
