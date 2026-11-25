const fs = require('node:fs');
const path = require('node:path');
const {buildSync} = require('esbuild');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'apps/desktop/ui/mroffice');
const assets = path.dirname(require.resolve('mroffice-assets/package.json', {
  paths: [path.join(root, 'apps/desktop')],
}));

buildSync({
  entryPoints: {app: path.join(root, 'apps/desktop/frontend/mroffice/app.jsx')},
  outdir: output,
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'media/[name]-[hash]',
  bundle: true,
  splitting: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  legalComments: 'eof',
  loader: {'.png': 'file', '.svg': 'file', '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.wasm': 'file'},
});

fs.cpSync(assets, path.join(output, 'assets'), {recursive: true});
for (const name of ['core', 'docs', 'sheets', 'slides', 'pdf', 'ink', 'code']) {
  const pkg = path.dirname(require.resolve('mroffice-' + name + '/package.json', {
    paths: [path.join(root, 'apps/desktop')],
  }));
  const noticeDir = path.join(output, 'notices', name);
  fs.mkdirSync(noticeDir, {recursive: true});
  for (const filename of ['LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md']) {
    fs.copyFileSync(path.join(pkg, filename), path.join(noticeDir, filename));
  }
}
