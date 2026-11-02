/** Stage only the public browser runtime; never copy signing fixtures or keys. */
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source=path.dirname(fileURLToPath(import.meta.url));
const destination=path.resolve(source,'../../apps/verifier/public/c2pa');
const allowed=['client.mjs','worker.mjs','pkg/workproof_c2pa_wasm.js','pkg/workproof_c2pa_wasm_bg.wasm'];
const files=[];
for(const name of allowed){
  const data=await readFile(path.join(source,name));
  if(name.endsWith('.wasm')&&!data.subarray(0,4).equals(Buffer.from([0,97,115,109])))throw Error('Invalid Wasm module');
  await mkdir(path.dirname(path.join(destination,name)),{recursive:true});
  await writeFile(path.join(destination,name),data);
  files.push({name,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});
}
const repository=path.resolve(source,'../..');
async function copyNotice(from,name){
  const data=await readFile(from);
  await mkdir(path.dirname(path.join(destination,name)),{recursive:true});
  await writeFile(path.join(destination,name),data);
  files.push({name,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});
}
async function notices(folder,relative=''){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const next=path.join(folder,entry.name),name=path.posix.join(relative,entry.name);
    if(entry.isDirectory())await notices(next,name);
    else if(entry.isFile())await copyNotice(next,path.posix.join('third-party',name));
    else throw Error('Unsupported notice file type');
  }
}
await copyNotice(path.join(repository,'LICENSE'),'LICENSE');
await copyNotice(path.join(source,'Cargo.lock'),'Cargo.lock');
await notices(path.join(repository,'.ci-c2pa-wasm-notices'));
await writeFile(path.join(destination,'BUILD-INFO.json'),JSON.stringify({source_commit:process.env.GITHUB_SHA??null,build_run:process.env.GITHUB_RUN_ID??null,files,signing_credentials_included:false},null,2));
console.log('Staged allowlisted browser runtime:',files.map(file=>file.name).join(', '));
