// CI only: bundle self-authored code; Adobe runtime modules remain host-provided.
import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url)),out=path.join(root,'dist');
await mkdir(out,{recursive:true});
await build({entryPoints:[path.join(root,'src/panel.cjs')],bundle:true,platform:'browser',format:'cjs',target:'es2018',external:['photoshop','uxp','fs'],outfile:path.join(out,'main.js')});
for(const name of ['manifest.json','index.html','panel.css','README.md'])await copyFile(path.join(root,name),path.join(out,name));
await copyFile(path.join(root,'../../LICENSE'),path.join(out,'LICENSE'));
// Preserve the bundled hashing library's actual license without bundling Adobe SDK code.
const notice=path.join(root,'../../node_modules/@noble/hashes/LICENSE');
await copyFile(notice,path.join(out,'NOBLE-HASHES-LICENSE'));
