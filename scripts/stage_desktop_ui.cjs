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
