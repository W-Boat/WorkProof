import {test,expect} from '@playwright/test';

const fixture='apps/verifier/public/demo/';
async function verifyBulk(page:import('@playwright/test').Page,certificate='behavior-bulk.txt.wproof'){
  await page.goto('/');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles(fixture+'behavior-bulk.txt');
  await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles(fixture+certificate);
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
}

test('real signed bulk insertion produces a readable warning and locates the original event',async({page},info)=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).copiedBehaviorShare=text;}}});});
  await verifyBulk(page);await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'编辑过程提醒',exact:true});
  await expect(panel.getByText('短时间写入了大段文字',{exact:true})).toBeVisible();
  await expect(panel).toContainText('粘贴、导入已有文稿');await expect(panel).toContainText('无法判定内容由人或 AI 创作');
  await expect(page.locator('#verification-result')).toContainText('编辑过程有待复核提醒');
  expect(await panel.evaluate(element=>!!(element.compareDocumentPosition(document.querySelector('.export-row')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.certificate-behavior')).toContainText('项过程提醒');
  await page.getByRole('button',{name:'复制指纹与核验说明',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).copiedBehaviorShare)).toContain('项过程提醒');
  await panel.getByRole('button',{name:'定位提醒 1',exact:true}).click();
  await expect.poll(()=>page.getByRole('slider',{name:'浏览事件',exact:true}).inputValue()).not.toBe('0');
  await page.getByRole('checkbox',{name:'写入速率',exact:true}).check();
  await expect(page.locator('.behavior-chart-markers')).toContainText('提醒 1');
  await page.screenshot({path:info.outputPath('bulk-editing-warning.png'),fullPage:true});
});

test('selective records explain insufficient scope without a reassuring behavior verdict',async({page})=>{
  await verifyBulk(page,'behavior-bulk.txt.selected.wproof');await expect(page.getByText('部分证据核验通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'编辑过程提醒',exact:true});
  await expect(panel).toContainText('只看到了部分记录');
  await expect(panel).not.toContainText('按当前规则暂未发现');await expect(page.getByRole('slider',{name:'浏览事件'})).toHaveCount(0);
});

test('an unmatched file cannot display trusted editing warnings or a clean behavior verdict',async({page})=>{
  await page.goto('/');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'behavior-bulk.txt',mimeType:'text/plain',buffer:Buffer.from('changed artifact')});
  await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles(fixture+'behavior-bulk.txt.wproof');
  await page.getByRole('button',{name:'开始本地核验',exact:true}).click();await expect(page.getByText('证据核验未通过',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'编辑过程提醒',exact:true});
  await expect(panel).toContainText('当前无法评估编辑过程');await expect(panel).not.toContainText('按当前规则暂未发现');
  await expect(panel.locator('.behavior-signals')).toHaveCount(0);await expect(page.locator('.timeline-panel')).toHaveCount(0);
});
