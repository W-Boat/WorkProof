import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const origin=process.env.WORKPROOF_PUBLIC_ORIGIN;
let publicUrl;
if(origin){
  publicUrl=new URL(origin);
  if(publicUrl.protocol!=='https:'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||publicUrl.pathname!=='/')throw new Error('Word add-in requires a plain HTTPS institution origin');
}
const out=path.join(root,'dist');await mkdir(out,{recursive:true});
await build({entryPoints:[path.join(root,'src/addin.ts')],bundle:true,platform:'browser',target:'es2022',outfile:path.join(out,'addin.js')});
await copyFile(path.join(root,'index.html'),path.join(out,'index.html'));
const wpsBuild=path.join(root,'wps/wps-addon-build');
await mkdir(wpsBuild,{recursive:true});
await mkdir(path.join(out,'wps'),{recursive:true});
for(const name of ['main.js','ribbon.xml']){
  await copyFile(path.join(root,'wps',name),path.join(wpsBuild,name));
  await copyFile(path.join(root,'wps',name),path.join(out,'wps',name));
}
const entry='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>WorkProof WPS Ribbon</title><script src="main.js"></script></html>';
await writeFile(path.join(wpsBuild,'index.html'),entry);
await writeFile(path.join(out,'wps/index.html'),entry);
const ribbonScript=await readFile(path.join(root,'wps/main.js'),'utf8');
for(const [mode,type] of [['wps-presentation','wpp'],['wps-spreadsheets','et']]){
  const directory=path.join(out,mode);
  await mkdir(directory,{recursive:true});
  await copyFile(path.join(root,'wps/ribbon.xml'),path.join(directory,'ribbon.xml'));
  await writeFile(path.join(directory,'main.js'),ribbonScript.replace('?host=wps',`?host=${mode}`));
  await writeFile(path.join(directory,'index.html'),entry);
  await writeFile(path.join(directory,'package.json'),JSON.stringify({name:mode,version:'0.2.0',private:true,addonType:type},null,2));
}
if(origin){
  const xmlEscape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const base=xmlEscape(publicUrl.origin);
  await writeFile(path.join(out,'manifest-word.xml'),`<?xml version="1.0" encoding="UTF-8"?><OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp"><Id>9ebd5d58-80c3-4868-8dd5-c3f3c53d7942</Id><Version>0.2.0.0</Version><ProviderName>WorkProof</ProviderName><DefaultLocale>zh-CN</DefaultLocale><DisplayName DefaultValue="WorkProof · 开源证人"/><Description DefaultValue="在本机记录创作过程并导出可核验证书"/><Hosts><Host Name="Document"/></Hosts><DefaultSettings><SourceLocation DefaultValue="${base}/office/index.html"/></DefaultSettings><Permissions>ReadWriteDocument</Permissions></OfficeApp>`);
}else await rm(path.join(out,'manifest-word.xml'),{force:true});
