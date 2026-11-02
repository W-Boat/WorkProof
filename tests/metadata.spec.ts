import {test,expect} from '@playwright/test';
import {deflateRawSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
function chunk(kind:string,body:Buffer){
  const data=Buffer.concat([Buffer.from(kind),body]);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(body.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,data,checksum]);
}

function jpegSegment(marker:number,body:Buffer){
  const header=Buffer.alloc(4);header[0]=255;header[1]=marker;header.writeUInt16BE(body.length+2,2);return Buffer.concat([header,body]);
}
function jpegExif(little=true,comment=Buffer.from('ASCII\0\0\0a fixture comment\0')){
  const software=Buffer.from('Adobe Photoshop\0'),tiff=Buffer.alloc(56+software.length+comment.length);
  const u16=(at:number,value:number)=>little?tiff.writeUInt16LE(value,at):tiff.writeUInt16BE(value,at);
  const u32=(at:number,value:number)=>little?tiff.writeUInt32LE(value,at):tiff.writeUInt32BE(value,at);
  tiff.write(little?'II':'MM');u16(2,42);u32(4,8);u16(8,2);
  u16(10,305);u16(12,2);u32(14,software.length);u32(18,56);
  u16(22,0x8769);u16(24,4);u32(26,1);u32(30,38);
  u16(38,1);u16(40,0x9286);u16(42,7);u32(44,comment.length);u32(48,56+software.length);
  software.copy(tiff,56);comment.copy(tiff,56+software.length);
  return Buffer.concat([Buffer.from('Exif\0\0'),tiff]);
}

test('JPEG EXIF and simple XMP stay local and remain editable clues',async({page})=>{
  const external:string[]=[];page.on('request',r=>{if(new URL(r.url()).origin!=='http://127.0.0.1:4173')external.push(r.url());});
  await page.goto('/');
  // Use the browser's actual JPEG encoder, then add synthetic metadata segments.
  const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;return c.toDataURL('image/jpeg').split(',')[1];});
  const image=Buffer.from(encoded,'base64'),panel=page.getByRole('region',{name:'进一步检查 AI 线索',exact:true});await panel.locator('summary').click();
  const xmp=(text:string)=>jpegSegment(225,Buffer.from('http://ns.adobe.com/xap/1.0/\0'+text));
  const xml='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:tool="https://example.org/editable" tool:prompt="&lt;script&gt;fixture&lt;/script&gt;"><tool:workflow>editable workflow</tool:workflow></rdf:Description></rdf:RDF></x:xmpmeta>';
  async function scan(segments:Buffer[]){
    await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'properties.jpg',mimeType:'image/jpeg',buffer:Buffer.concat([image.subarray(0,2),...segments,image.subarray(2)])});
    await panel.getByRole('button',{name:'检查所选作品的元数据',exact:true}).click();
  }
  await scan([jpegSegment(225,jpegExif())]);
  await expect(panel.getByRole('status')).toContainText('图片文件头属性（JPEG）');await expect(panel.getByRole('status')).toContainText('Adobe Photoshop');
  await expect(panel.getByRole('status')).toContainText('a fixture comment');await expect(panel.getByRole('status')).toContainText('不能据此判断没有使用 AI');
  await scan([jpegSegment(225,jpegExif()),xmp(xml)]);
  await expect(panel.getByRole('status')).toContainText('发现可能与生成流程有关');await expect(panel.getByRole('status')).toContainText('<script>fixture</script>');
  await expect(panel.getByRole('status')).toContainText('editable workflow');await expect(panel.locator('script')).toHaveCount(0);
  const unicode=Buffer.concat([Buffer.from('UNICODE\0'),Buffer.from([255,254]),Buffer.from('中文注释\0','utf16le')]);
  await scan([jpegSegment(225,jpegExif(false,unicode)),jpegSegment(254,Buffer.from('ordinary comment'))]);
  await expect(panel.getByRole('status')).toContainText('中文注释');await expect(panel.getByRole('status')).toContainText('ordinary comment');
  await expect(panel.getByRole('status')).toContainText('不能据此判断没有使用 AI');
  const badExif=jpegExif();badExif.writeUInt32LE(0xffffff00,24); // out-of-bounds Software value offset
  const badXml='<!DOCTYPE x [<!ENTITY private SYSTEM "https://example.com/private">]>'+xml;
  await scan([jpegSegment(225,badExif),xmp(badXml),jpegSegment(254,Buffer.from('safe comment'))]);
  await expect(panel.getByRole('status')).toContainText('safe comment');await expect(panel.getByRole('status')).toContainText('2 项');
  await expect(panel.getByRole('status')).not.toContainText('Adobe Photoshop');
  const nested=xml.replace('<tool:workflow>editable workflow</tool:workflow>','<tool:workflow><rdf:Bag><rdf:li>PRIVATE_NESTED_TEXT</rdf:li></rdf:Bag></tool:workflow>');
  await scan([xmp(nested)]);await expect(panel.getByRole('status')).not.toContainText('PRIVATE_NESTED_TEXT');await expect(panel.getByRole('status')).toContainText('1 项');
  await scan([xmp('<not-xmp/>')]);await expect(panel.getByRole('status')).toContainText('1 项');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(external).toEqual([]);
});

test('JPEG malformed segment bounds and repeated metadata have explicit limits',async({page})=>{
  await page.goto('/');const panel=page.getByRole('region',{name:'进一步检查 AI 线索',exact:true});await panel.locator('summary').click();
  async function scan(buffer:Buffer){
    await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'bounded.jpg',mimeType:'image/jpeg',buffer});await panel.getByRole('button',{name:'检查所选作品的元数据',exact:true}).click();
  }
  for(const buffer of [Buffer.from([255,216,255,225,255,255,0]),Buffer.from([255,216,255,225,0,1]),Buffer.from([255,216,255,218,0,2])]){
    await scan(buffer);await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByRole('status')).toHaveCount(0);
  }
  // This fixture exercises only header parsing, not JPEG image validity.
  const comment=jpegSegment(254,Buffer.from('bounded comment'));
  await scan(Buffer.concat([Buffer.from([255,216]),...Array(35).fill(comment),Buffer.from([255,217])]));
  await expect(panel.getByRole('status')).toContainText('3 项');await expect(panel.getByRole('status').getByText('bounded comment',{exact:true})).toHaveCount(32);
  await scan(Buffer.concat([Buffer.from([255,216]),...Array(4097).fill(jpegSegment(224,Buffer.alloc(0))),Buffer.from([255,217])]));
  await expect(panel.getByRole('alert')).toContainText('数据段过多');await expect(panel.getByRole('status')).toHaveCount(0);
});
test('optional PNG metadata stays local and distinguishes hints from conclusions',async({page})=>{
  const external:string[]=[];page.on('request',r=>{if(new URL(r.url()).origin!=='http://127.0.0.1:4173')external.push(r.url());});
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

function docx(parts:[string,string][],compressed=true,descriptor=false,documentPart='word/document.xml'){
  const files:[string,string][]=[['[Content_Types].xml','<Types/>'],[documentPart,'<document/>'],...parts];
  const locals:Buffer[]=[],directory:Buffer[]=[];let offset=0;
  for(const [name,text] of files){
    const bytes=Buffer.from(text),body=compressed?deflateRawSync(bytes):bytes,filename=Buffer.from(name);let crc=0xffffffff;
    for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(compressed?8:0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(compressed?8:0,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    const trailer=Buffer.alloc(descriptor?16:0);
    if(descriptor){local.writeUInt16LE(8,6);central.writeUInt16LE(8,8);local.fill(0,14,26);trailer.writeUInt32LE(0x08074b50);trailer.writeUInt32LE(crc,4);trailer.writeUInt32LE(body.length,8);trailer.writeUInt32LE(bytes.length,12);}
    locals.push(local,filename,body,trailer);directory.push(central,filename);offset+=local.length+filename.length+body.length+trailer.length;
  }
  const index=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,index,end]);
}

test('PPTX properties use the same bounded local scanner without reading slide text',async({page})=>{
  const external:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).origin!=='http://127.0.0.1:4173')external.push(request.url());});
  await page.goto('/');
  const panel=page.getByRole('region',{name:'进一步检查 AI 线索',exact:true});await panel.locator('summary').click();
  const app='<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft PowerPoint</Application></Properties>';
  const custom='<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="workflow"><vt:lpwstr>editable source clue</vt:lpwstr></property></Properties>';
  async function scan(parts:[string,string][]){
    await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'presentation.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:docx(parts,true,false,'ppt/presentation.xml')});
    await panel.getByRole('button',{name:'检查所选作品的元数据',exact:true}).click();
  }
  await scan([['docProps/app.xml',app],['ppt/slides/slide1.xml','<slide>PRIVATE_SLIDE_TEXT</slide>']]);
  await expect(panel.getByRole('status')).toContainText('演示文稿属性（PPTX）');
  await expect(panel.getByRole('status')).toContainText('Microsoft PowerPoint');
  await expect(panel.getByRole('status')).toContainText('不能据此判断没有使用 AI');
  await expect(panel.getByRole('status')).not.toContainText('PRIVATE_SLIDE_TEXT');
  await scan([['docProps/custom.xml',custom]]);
  await expect(panel.getByRole('status')).toContainText('发现可能与生成流程有关');
  for(const parts of [[['word/document.xml','<document/>']],[['ppt/vbaProject.bin','macro']]] as [string,string][][]){
    await scan(parts);await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('status')).toHaveCount(0);
  }
  expect(external).toEqual([]);
});
test('DOCX properties remain local, distinguish editable hints and reject hostile containers',async({page})=>{
  const external:string[]=[];page.on('request',request=>{if(new URL(request.url()).origin!=='http://127.0.0.1:4173')external.push(request.url());});
  await page.goto('/');const panel=page.getByRole('region',{name:'进一步检查 AI 线索',exact:true});await panel.locator('summary').click();
  const scan=panel.getByRole('button',{name:'检查所选作品的元数据',exact:true});
  const app='<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WPS Office</Application></Properties>';
  const custom='<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="prompt"><vt:lpwstr>&lt;script&gt;example&lt;/script&gt;</vt:lpwstr></property></Properties>';
  const upload=async(buffer:Buffer)=>{await page.getByLabel('选择最终作品',{exact:true}).setInputFiles({name:'properties.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer});await scan.click();};
  await upload(docx([['docProps/app.xml',app]]));await expect(panel.getByRole('status')).toContainText('WPS Office');await expect(panel.getByRole('status')).toContainText('不能据此判断没有使用 AI');
  await upload(docx([['docProps/custom.xml',custom]]));await expect(panel.getByRole('status')).toContainText('发现可能与生成流程有关');await expect(panel.getByRole('status')).toContainText('<script>example</script>');await expect(panel.locator('script')).toHaveCount(0);
  for(const parts of [
    [['docProps/app.xml','<!DOCTYPE x [<!ENTITY y SYSTEM "https://example.com/secret">]>'+app]],
    [['word/vbaProject.bin','macro']],
    [['docProps/app.xml',app],['docProps/app.xml',app]],
    [['docProps/app.xml','<Properties>broken']],
  ] as [string,string][][]){await upload(docx(parts));await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByRole('status')).toHaveCount(0);}
  await upload(docx([['docProps/app.xml',app]],false));await expect(panel.getByRole('status')).toContainText('WPS Office');
  await upload(docx([['docProps/app.xml',app]],true,true));await expect(panel.getByRole('status')).toContainText('WPS Office');
  const corrupt=(change:(data:Buffer,central:number,local:number)=>void,descriptor=false)=>{
    const data=docx([['docProps/app.xml',app]],true,descriptor);let central=data.readUInt32LE(data.length-6);
    while(data.subarray(central+46,central+46+data.readUInt16LE(central+28)).toString()!=='docProps/app.xml')central+=46+data.readUInt16LE(central+28)+data.readUInt16LE(central+30)+data.readUInt16LE(central+32);
    change(data,central,data.readUInt32LE(central+42));return data;
  };
  const malformed=[
    corrupt((data,c,l)=>data.writeUInt32LE(123,l+14)), // local CRC disagrees
    corrupt((data,c,l)=>{data.writeUInt32LE(123,l+14);data.writeUInt32LE(123,c+16);}), // actual CRC disagrees
    corrupt((data,c,l)=>{data.writeUInt32LE(1,l+22);data.writeUInt32LE(1,c+24);}), // inflated output exceeds declaration
    corrupt((data,c,l)=>data.writeUInt32LE(123,l+30+data.readUInt16LE(l+26)+data.readUInt16LE(l+28)+data.readUInt32LE(c+20)+4),true), // descriptor CRC
    corrupt(data=>{data.writeUInt16LE(2,data.length-14);data.writeUInt16LE(2,data.length-12);}), // forged EOCD item count
    corrupt((data,c)=>data.writeUInt32LE(129*1024*1024,c+24)), // total declared expansion
  ];
  for(const data of malformed){await upload(data);await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByRole('status')).toHaveCount(0);}
  await upload(docx([['docProps/app.xml',randomBytes(196610).toString('base64')]]));await expect(panel.getByRole('status')).toContainText('1 项'); // expanded size, low compression ratio
  await upload(docx([['docProps/app.xml','x'.repeat(100000)]]));await expect(panel.getByRole('status')).toContainText('1 项'); // compression ratio
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(external).toEqual([]);
});
