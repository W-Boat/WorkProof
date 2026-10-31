import {build} from 'esbuild';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(root,'dist');await mkdir(out,{recursive:true});
await build({entryPoints:[path.join(root,'src/addin.ts')],bundle:true,platform:'browser',target:'es2022',outfile:path.join(out,'addin.js')});
await copyFile(path.join(root,'index.html'),path.join(out,'index.html'));
const origin=process.env.WORKPROOF_PUBLIC_ORIGIN;
if(origin){
  const url=new URL(origin);if(url.protocol!=='https:')throw new Error('Word add-in requires an HTTPS institution origin');
  const xmlEscape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const base=xmlEscape(url.origin);
  await writeFile(path.join(out,'manifest-word.xml'),`<?xml version="1.0" encoding="UTF-8"?><OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp"><Id>9ebd5d58-80c3-4868-8dd5-c3f3c53d7942</Id><Version>0.2.0.0</Version><ProviderName>WorkProof</ProviderName><DefaultLocale>zh-CN</DefaultLocale><DisplayName DefaultValue="WorkProof · 开源证人"/><Description DefaultValue="在本机记录创作过程并导出可核验证书"/><Hosts><Host Name="Document"/></Hosts><DefaultSettings><SourceLocation DefaultValue="${base}/office/index.html"/></DefaultSettings><Permissions>ReadWriteDocument</Permissions></OfficeApp>`);
}
