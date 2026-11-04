// Stage the canonical web design tokens and the original ImageGen brand asset.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const [source,destination] of [
  ['services/institution/scaffold-vue/src/styles/tokens.css','apps/desktop/ui/theme.css'],
  ['assets/brand/workproof-icon.png','apps/desktop/ui/brand.png'],
])fs.copyFileSync(path.join(root,source),path.join(root,destination));
