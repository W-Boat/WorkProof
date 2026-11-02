// Actions-only: actual exported Next page, native-signed files and real Wasm worker.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('@playwright/test');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const root=path.resolve('apps/verifier/out'),fixtures=path.resolve('.ci-browser-pdf');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),requests=[];
    await context.route('**/*',route=>{
      const req=route.request();requests.push({url:req.url(),method:req.method()});
      if(!req.url().startsWith(origin+'/')||req.method()!=='GET')return route.abort();
      return route.continue();
    });
    const page=await context.newPage();await page.goto(origin);
    const panel=page.getByRole('region',{name:'检查作品内嵌的创作证书'});
    await panel.getByText('作品中已经包含证书？从这里检查',{exact:true}).click();
    await panel.getByLabel('1. 选择带证书的作品',{exact:true}).setInputFiles(path.join(fixtures,'selected.pdf'));
    await panel.getByLabel('2. 选择你信任的 CA 文件',{exact:true}).setInputFiles(path.join(fixtures,'synthetic-ca.pem'));
    const button=panel.getByRole('button',{name:'3. 开始本地检查',exact:true});assert.equal(await button.isDisabled(),true);
    await panel.getByRole('checkbox').check();await button.click();
    await panel.getByText('签名、作品匹配与已披露记录通过检查',{exact:true}).waitFor({timeout:90000});
    assert((await panel.innerText()).includes('选择性披露'));
    await panel.getByLabel('2. 选择你信任的 CA 文件',{exact:true}).setInputFiles(path.join(fixtures,'wrong-ca.pem'));
    assert.equal(await panel.getByRole('checkbox').isChecked(),false);
    assert.equal(await panel.getByText('签名、作品匹配与已披露记录通过检查',{exact:true}).count(),0);
    await panel.getByRole('checkbox').check();await button.click();
    await panel.getByText('所选 CA 无法确认这份签名，请向签发方核对可信来源。',{exact:true}).waitFor({timeout:90000});
    assert(requests.every(r=>r.method==='GET'&&r.url.startsWith(origin+'/')));
    console.log('PASS exported user page: real PDF Wasm verification, explicit trust consent, stale-result reset, wrong-root refusal and local GET resources only');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
