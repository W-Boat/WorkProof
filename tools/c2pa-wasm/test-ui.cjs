// Actions-only: actual exported Next page, native-signed files and real Wasm worker.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('@playwright/test');
const {spawn}=require('node:child_process');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const root=path.resolve(process.env.WORKPROOF_TEST_WEB_ROOT||'apps/verifier/out'),fixtures=path.resolve(process.env.WORKPROOF_TEST_EMBEDDED_FIXTURES||'.ci-browser-pdf');
const embeddedAsset=process.env.WORKPROOF_TEST_EMBEDDED_ASSET||'selected.pdf';
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));
});
(async()=>{
  const engine=process.env.WORKPROOF_TEST_WEB_ENGINE;
  let child;
  if(engine){
    child=spawn(path.resolve(engine),['serve-web',root],{stdio:'ignore'});
    for(let attempt=0;;attempt++){
      assert.equal(child.exitCode,null,'Native static server exited');
      try{const response=await fetch('http://127.0.0.1:4173/c2pa/BUILD-INFO.json');if(response.ok)break;}catch{}
      assert(attempt<100,'Native static server did not become ready');await new Promise(resolve=>setTimeout(resolve,100));
    }
  }else await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=engine?'http://127.0.0.1:4173':`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),requests=[];
    await context.route('**/*',route=>{
      const req=route.request();requests.push({url:req.url(),method:req.method()});
      if(!req.url().startsWith(origin+'/')||req.method()!=='GET')return route.abort();
      return route.continue();
    });
    const page=await context.newPage();await page.goto(origin);
    const demo=path.join(root,'demo');
    await page.getByRole('button',{name:'先体验一份演示证据'}).click();
    await page.getByText('证据核验通过',{exact:true}).waitFor({timeout:30000});
    await page.getByLabel('选择最终作品',{exact:true}).setInputFiles(path.join(demo,'structure-demo.txt'));
    await page.getByLabel('选择 .wproof 证书',{exact:true}).setInputFiles(path.join(demo,'structure-demo.txt.wproof'));
    await page.getByRole('button',{name:'开始本地核验',exact:true}).click();
    await page.getByText('证据核验通过',{exact:true}).waitFor({timeout:30000});
    await page.getByText('收到 .wgraph 结构文件？查看对象和图层怎样变化',{exact:true}).click();
    await page.getByLabel('选择 .wgraph 结构文件',{exact:true}).setInputFiles(path.join(demo,'structure-demo.wgraph'));
    await page.getByRole('button',{name:'核验并查看结构',exact:true}).click();
    await page.getByText('结构与证书中的记录一致',{exact:true}).waitFor({timeout:30000});
    await page.getByRole('button',{name:'打开关系图',exact:true}).click();
    const graph=page.getByLabel('已核验的结构关系图',{exact:true});
    await graph.locator('.react-flow__edge[data-id="1-3"]').waitFor();
    await page.getByLabel('选择结构记录',{exact:true}).selectOption('1');
    await graph.locator('.react-flow__edge[data-id="2-3"]').waitFor();
    assert.equal(await graph.locator('.react-flow__edge[data-id="1-3"]').count(),0);
    const panel=page.getByRole('region',{name:'检查作品内嵌的创作证书'});
    await panel.getByText('作品中已经包含证书？从这里检查',{exact:true}).click();
    await panel.getByLabel('1. 选择带证书的作品',{exact:true}).setInputFiles(path.join(fixtures,embeddedAsset));
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
    console.log('PASS exported user page: ordinary certificate Wasm, authenticated structure snapshots and React Flow edges, real embedded '+path.extname(embeddedAsset)+' Wasm verification, explicit trust consent, stale-result reset, wrong-root refusal and local GET resources only');
  }finally{await browser.close();if(child){child.kill();await new Promise(resolve=>child.once('exit',resolve));}else server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
