import {test,expect} from '@playwright/test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
function chunk(kind:string,body:Buffer){
  const data=Buffer.concat([Buffer.from(kind),body]);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(body.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,data,checksum]);
}
test('optional PNG metadata stays local and distinguishes hints from conclusions',async({page})=>{
  const external:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4173'))external.push(r.url());});
  await page.goto('/');const panel=page.getByRole('region',{name:'进一步检查 AI 线索',exact:true});await panel.locator('summary').click();
  const scan=panel.getByRole('button',{name:'检查所选作品的元数据',exact:true});await expect(scan).toBeDisabled();
  const image=Buffer.concat([png.subarray(0,-12),chunk('tEXt',Buffer.from('prompt\0<script>alert(1)</script> test')),chunk('zTXt',Buffer.from('hidden\0\0not inflated')),png.subarray(-12)]);
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'metadata.png',mimeType:'image/png',buffer:image});await scan.click();
  await expect(panel.getByRole('status')).toContainText('发现可能与生成流程有关的字段');await expect(panel.getByRole('status')).toContainText('<script>alert(1)</script>');await expect(panel.getByRole('status')).toContainText('1 项');await expect(panel.locator('script')).toHaveCount(0);
  const malformed=Buffer.concat([png.subarray(0,-12),chunk('iTXt',Buffer.from([120,0,0,0,0,0,255])),chunk('tEXt',Buffer.from('Software\0ordinary editor')),png.subarray(-12)]);
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'invalid-utf8.png',mimeType:'image/png',buffer:malformed});await scan.click();await expect(panel.getByRole('status')).toContainText('ordinary editor');await expect(panel.getByRole('status')).toContainText('1 项');await expect(panel.getByRole('status')).toContainText('不能据此判断没有使用 AI');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'clean.png',mimeType:'image/png',buffer:png});await expect(panel.getByRole('status')).toHaveCount(0);await scan.click();await expect(panel.getByRole('status')).toContainText('不能据此判断没有使用 AI');
  await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'not.png',mimeType:'image/png',buffer:Buffer.from('not PNG')});await scan.click();await expect(panel.getByRole('alert')).toContainText('目前只支持 PNG');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(external).toEqual([]);
});
