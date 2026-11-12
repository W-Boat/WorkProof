// Used by the regular CI build. No downloads or model execution.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let notices='WorkProof report viewer\n'+fs.readFileSync(path.join(root,'LICENSE'),'utf8')+'\n';
notices+='\nIPTC source-type descriptions\n'+fs.readFileSync(path.join(root,'apps/verifier/public/notices/iptc-newscodes.txt'),'utf8')+'\n';
for(const name of ['echarts','zrender']){
  let directory=path.dirname(require.resolve(name,{paths:[path.join(root,'apps/verifier'),root]}));
  while(true){const file=path.join(directory,'package.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).name===name)break;const parent=path.dirname(directory);if(parent===directory)throw new Error('Missing report dependency metadata: '+name);directory=parent;}
  const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
  const files=fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isFile()&&/^(LICENSE|NOTICE|COPYING)/i.test(entry.name));
  if(!files.length)throw new Error('Missing report dependency license: '+name);
  notices+='\n'+name+' '+pkg.version+'\n';for(const file of files)notices+=file.name+'\n'+fs.readFileSync(path.join(directory,file.name),'utf8')+'\n';
}
require('esbuild').buildSync({entryPoints:[path.join(root,'apps/verifier/lib/report-viewer.ts')],outfile:path.join(root,'apps/verifier/public/report-viewer.js'),bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,charset:'ascii',legalComments:'inline',banner:{js:'window.WORKPROOF_REPORT_NOTICES='+JSON.stringify(notices).replace(/</g,'\\u003c')+';'}});
