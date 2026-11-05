// Stage the canonical web design tokens and the original ImageGen brand asset.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const [source,destination] of [
  ['services/institution/scaffold-vue/src/styles/tokens.css','apps/desktop/ui/theme.css'],
  ['assets/brand/workproof-icon.png','apps/desktop/ui/brand.png'],
])fs.copyFileSync(path.join(root,source),path.join(root,destination));
// Compile on Actions only; this script is never invoked as a local dev server.
require('esbuild').buildSync({
  entryPoints:[path.join(root,'apps/desktop/frontend/components.js')],
  outfile:path.join(root,'apps/desktop/ui/components.js'),
  bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,
  legalComments:'eof',
});
require('esbuild').buildSync({entryPoints:[path.join(root,'apps/desktop/frontend/word-worker.js')],outfile:path.join(root,'apps/desktop/ui/word-worker.js'),bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
fs.copyFileSync(path.join(root,'apps/desktop/frontend/vendor/FOLIO-LICENSE.txt'),path.join(root,'apps/desktop/ui/FOLIO-LICENSE.txt'));
// Preserve notices from the installed runtime dependency graph in every bundle.
const crypto=require('node:crypto'),seen=new Set(),inventory=[];
const noticeRoot=path.join(root,'apps/desktop/ui/notices');fs.mkdirSync(noticeRoot,{recursive:true});
function dependency(name,from=root){let cursor=from;while(cursor.startsWith(root)){const dir=path.join(cursor,'node_modules',name);if(fs.existsSync(path.join(dir,'package.json')))return dir;const next=path.dirname(cursor);if(next===cursor)break;cursor=next;}return null;}
function notices(name,from){const dir=dependency(name,from);if(!dir||seen.has(dir))return;seen.add(dir);const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));const files=[];
  for(const file of fs.readdirSync(dir))if(/^(licen[sc]e|copying|notice)(\.|$)/i.test(file)&&fs.statSync(path.join(dir,file)).isFile()){
    const bytes=fs.readFileSync(path.join(dir,file)),destination=(pkg.name+'-'+pkg.version+'-'+file).replace(/[^a-zA-Z0-9._-]/g,'_');fs.writeFileSync(path.join(noticeRoot,destination),bytes);files.push({path:destination,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  inventory.push({name:pkg.name,version:pkg.version,license:pkg.license||null,files});
  for(const dep of Object.keys(pkg.dependencies||{}))notices(dep,dir);
  for(const dep of Object.keys(pkg.peerDependencies||{}))if(!pkg.peerDependenciesMeta?.[dep]?.optional)notices(dep,dir);
}
for(const name of Object.keys(JSON.parse(fs.readFileSync(path.join(root,'apps/desktop/package.json'),'utf8')).dependencies))notices(name,root);
fs.writeFileSync(path.join(noticeRoot,'index.json'),JSON.stringify({packages:inventory,missing_license_files:inventory.filter(p=>!p.files.length).map(p=>p.name+'@'+p.version)},null,2));
