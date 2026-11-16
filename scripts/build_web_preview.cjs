const path=require('node:path');
const {buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'apps/desktop/frontend');
const output=path.join(root,'apps/verifier/public');
for(const entry of ['document-preview.js','word-worker.js']){
  buildSync({entryPoints:[path.join(source,entry)],outfile:path.join(output,entry),bundle:true,
    format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'inline'});
}
