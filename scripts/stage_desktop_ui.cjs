// Stage the canonical web design tokens and the original ImageGen brand asset.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const [source,destination] of [
  ['services/institution/scaffold-vue/src/styles/tokens.css','apps/desktop/ui/theme.css'],
  ['assets/brand/workproof-icon.png','apps/desktop/ui/brand.png'],
])fs.copyFileSync(path.join(root,source),path.join(root,destination));
// Compile on Actions only; this script is never invoked as a local dev server.
// Remove only this build's generated chunk files in CI. Source UI files and
// unrelated output folders are outside this cleanup.
const chunkDirectory=path.join(root,'apps/desktop/ui/chunks');
if(process.env.GITHUB_ACTIONS==='true'&&fs.existsSync(chunkDirectory)){
  for(const entry of fs.readdirSync(chunkDirectory,{withFileTypes:true})){
    if(entry.isFile()&&/^[A-Za-z0-9_-]+\.js$/.test(entry.name))fs.unlinkSync(path.join(chunkDirectory,entry.name));
  }
}
const uiBuild=require('esbuild').buildSync({
  entryPoints:[path.join(root,'apps/desktop/frontend/components.js'),path.join(root,'apps/desktop/frontend/markdown-source-runtime.js')],
  outdir:path.join(root,'apps/desktop/ui'),chunkNames:'chunks/[name]-[hash]',
  bundle:true,splitting:true,metafile:true,format:'esm',platform:'browser',target:['es2022'],minify:true,
  legalComments:'eof',loader:{'.svg':'text'},
});
// Check actual compiled static imports. The document controller is loaded by
// startup as well, so include its static closure without following lazy edges.
const outputs=uiBuild.metafile.outputs,visited=new Set();
function assertSourceEditorDeferred(outputName){
  if(visited.has(outputName))return;visited.add(outputName);
  const output=outputs[outputName];if(!output)return;
  for(const input of Object.keys(output.inputs)){
    if(/(?:^|[\\/])node_modules[\\/](?:@codemirror|@lezer|codemirror)(?:[\\/]|$)/.test(input))throw new Error('CodeMirror was loaded by the initial desktop shell: '+input);
  }
  for(const imported of output.imports){
    if(imported.external||imported.kind==='dynamic-import')continue;
    const dependency=outputs[imported.path]?imported.path:Object.keys(outputs).find(name=>path.resolve(name)===path.resolve(path.dirname(outputName),imported.path));
    if(!dependency)throw new Error('Cannot inspect a desktop static chunk: '+imported.path);
    assertSourceEditorDeferred(dependency);
  }
}
for(const [name,output] of Object.entries(outputs)){
  if(output.entryPoint&&/(?:^|[\\/])(?:components|editor|status|pane-layout)\.js$/.test(output.entryPoint))assertSourceEditorDeferred(name);
}
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
