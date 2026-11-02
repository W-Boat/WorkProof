/* Actions-only real VS Code UI acceptance. No mocked VS Code APIs. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const net=require('node:net');
const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(action,description){
  const end=Date.now()+60000;let last;
  while(Date.now()<end){try{return await action();}catch(error){last=error;await sleep(300);}}
  throw new Error(description+': '+String(last));
}
async function main(){
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'workproof-vscode-host-'));
  const evidence=path.resolve('test-results/vscode-host');await fs.mkdir(evidence,{recursive:true});
  const engine=path.resolve(process.argv[2]);
  const vsix=path.resolve(process.argv[3]);
  let recorder,code,browser,page;
  try{
    const metadata=await fetch('https://update.code.visualstudio.com/api/update/linux-x64/stable/latest');assert(metadata.ok);
    const release=await metadata.json();assert.match(release.sha256hash,/^[a-f0-9]{64}$/i);
    assert.equal(new URL(release.url).protocol,'https:');
    const download=await fetch(release.url);assert(download.ok);
    const archive=Buffer.from(await download.arrayBuffer());
    assert.equal(createHash('sha256').update(archive).digest('hex'),release.sha256hash.toLowerCase());
    const archivePath=path.join(temporary,'vscode.tar.gz');await fs.writeFile(archivePath,archive);
    execFileSync('tar',['-xzf',archivePath,'-C',temporary]);
    const installation=path.join(temporary,'VSCode-linux-x64');
    const userData=path.join(temporary,'user'),extensions=path.join(temporary,'extensions'),workspace=path.join(temporary,'workspace'),data=path.join(temporary,'engine');
    await fs.mkdir(path.join(userData,'User'),{recursive:true});await fs.mkdir(workspace);await fs.mkdir(data);
    await fs.writeFile(path.join(userData,'User','settings.json'),JSON.stringify({
      'files.simpleDialog.enable':true,'window.dialogStyle':'custom','workbench.startupEditor':'none',
      'security.workspace.trust.enabled':false,'telemetry.telemetryLevel':'off','update.mode':'none',
      'extensions.autoUpdate':false,'editor.accessibilitySupport':'on','window.restoreWindows':'none',
    }));
    const file=path.join(workspace,'draft.md'),proof=file+'.wproof';await fs.writeFile(file,'# Real host fixture\n');
    const environment={...process.env,WORKPROOF_DATA_DIR:data};
    recorder=spawn(engine,[],{env:environment,stdio:'ignore'});
    await until(async()=>{assert.equal(recorder.exitCode,null);await fs.access(path.join(data,'connection.json'));},'Engine readiness');
    // The disposable CI profile has no desktop keyring; do not require or modify
    // a user's OS credential service. This profile is never uploaded.
    const common=['--no-sandbox','--password-store=basic','--user-data-dir',userData,'--extensions-dir',extensions];
    execFileSync(path.join(installation,'bin','code'),[...common,'--install-extension',vsix,'--force'],{env:environment,stdio:'pipe',timeout:60000});
    const installed=execFileSync(path.join(installation,'bin','code'),[...common,'--list-extensions'],{env:environment,encoding:'utf8',timeout:60000});
    assert(installed.includes('workproof-local.workproof-vscode'));
    const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    code=spawn(path.join(installation,'code'),[...common,'--disable-gpu','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--locale=en',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',workspace,file],{env:environment,stdio:'ignore'});
    browser=await until(()=>chromium.connectOverCDP('http://127.0.0.1:'+port),'VS Code workbench CDP');
    page=await until(async()=>{const p=browser.contexts().flatMap(context=>context.pages()).find(p=>p.url().includes('workbench'));assert(p);return p;},'Workbench window');
    page.setDefaultTimeout(30000);
    await page.locator('.monaco-workbench').waitFor();
    async function command(title){
      await page.keyboard.press('Control+Shift+P');
      const input=page.locator('.quick-input-widget input').filter({visible:true});
      await input.fill('>'+title);
      await page.locator('.quick-input-list .monaco-list-row').filter({hasText:title}).first().waitFor();
      await page.keyboard.press('Enter');
      await page.locator('.quick-input-list .monaco-list-row').filter({hasText:title}).first().waitFor({state:'hidden'});
    }
    const status=page.locator('.statusbar-item').filter({hasText:'WorkProof'});
    await status.first().waitFor();
    await command('WorkProof: 记录当前文件');
    await page.getByRole('button',{name:'开始记录',exact:true}).click();
    await until(async()=>assert((await status.allTextContents()).join('').includes('记录中')),'Recording state');
    await page.locator('.monaco-editor').first().click();await page.keyboard.press('Control+End');
    await page.keyboard.insertText('Observed edit in the actual editor.\n');
    await command('WorkProof: 暂停 / 继续记录');
    await until(async()=>assert((await status.allTextContents()).join('').includes('已暂停')),'Paused state');
    await page.locator('.monaco-editor').first().click();await page.keyboard.press('Control+End');
    await page.keyboard.insertText('PRIVATE_PAUSED_FIXTURE\n');
    await command('WorkProof: 导出过程证书');
    const save=page.locator('.quick-input-widget input').filter({visible:true});await save.waitFor();
    await save.fill(proof);await page.keyboard.press('Enter');
    await until(()=>fs.access(proof),'Exported proof file');
    assert((await status.allTextContents()).join('').includes('已暂停'));
    const certificate=JSON.parse(await fs.readFile(proof,'utf8'));
    const events=certificate.records.map(record=>record.event);
    assert(events.some(event=>event.kind==='edit'&&event.inserted>0));
    assert(events.some(event=>event.kind==='pause'));assert(events.some(event=>event.kind==='gap'));
    assert.equal(events.at(-1).kind,'save');assert.equal(certificate.manifest.demo,false);
    assert(!JSON.stringify(certificate).includes('PRIVATE_PAUSED_FIXTURE'));
    execFileSync(engine,['verify',file,proof],{stdio:'pipe',timeout:30000});
    await fs.appendFile(file,'tampered');let refused=false;
    try{execFileSync(engine,['verify',file,proof],{stdio:'pipe',timeout:30000});}catch(error){assert.equal(error.status,2);refused=true;}
    assert(refused);
    await page.screenshot({path:path.join(evidence,'paused-export.png')});
    await fs.writeFile(path.join(evidence,'acceptance.json'),JSON.stringify({
      source_commit:process.env.GITHUB_SHA,vscode_version:release.productVersion,vscode_commit:release.version,
      archive_sha256:release.sha256hash,scope:'Official Linux stable VS Code; installed VSIX; actual UI confirmation, editor, pause and simple save dialog; real Rust verification and tamper refusal. No mocked VS Code APIs. Not Windows/macOS or all historical versions.',
    },null,2));
    console.log('PASS: actual VS Code installed VSIX, editor events, paused export and independent Rust verification');
  }finally{
    if(page)await page.screenshot({path:path.join(evidence,'last-ui.png')}).catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    for(const child of [code,recorder])if(child&&child.exitCode===null)child.kill('SIGTERM');
    // Only the newly-created test directory; no real user profile is used.
    assert(temporary.startsWith(path.join(os.tmpdir(),'workproof-vscode-host-')));
    await fs.rm(temporary,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
