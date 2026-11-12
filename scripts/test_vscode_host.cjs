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
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert(['linux','win32','darwin'].includes(process.platform));
  assert(['x64','arm64'].includes(process.arch));
  const platform=process.platform,modifier=platform==='darwin'?'Meta':'Control';
  const updateTarget=platform==='win32'?'win32-x64-archive':platform==='darwin'?(process.arch==='arm64'?'darwin-arm64':'darwin'):'linux-x64';
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'workproof-vscode-host-'));
  const evidence=path.resolve('test-results/vscode-host');await fs.mkdir(evidence,{recursive:true});
  const engine=path.resolve(process.argv[2]);
  const vsix=path.resolve(process.argv[3]);
  const manifest=JSON.parse(await fs.readFile('apps/extension/package.json','utf8'));
  const extensionId=`${manifest.publisher}.${manifest.name}@${manifest.version}`;
  const vsixDigest=createHash('sha256').update(await fs.readFile(vsix)).digest('hex');
  let recorder,code,browser,page;
  try{
    const metadata=await fetch(`https://update.code.visualstudio.com/api/update/${updateTarget}/stable/latest`);assert(metadata.ok);
    const release=await metadata.json();assert.match(release.sha256hash,/^[a-f0-9]{64}$/i);
    assert.equal(new URL(release.url).protocol,'https:');
    const download=await fetch(release.url);assert(download.ok);
    const archive=Buffer.from(await download.arrayBuffer());
    assert.equal(createHash('sha256').update(archive).digest('hex'),release.sha256hash.toLowerCase());
    const archivePath=path.join(temporary,platform==='linux'?'vscode.tar.gz':'vscode.zip');await fs.writeFile(archivePath,archive);
    let installation,executable;
    if(platform==='linux'){
      execFileSync('tar',['-xzf',archivePath,'-C',temporary]);installation=path.join(temporary,'VSCode-linux-x64');executable=path.join(installation,'code');
    }else if(platform==='win32'){
      installation=path.join(temporary,'vscode');await fs.mkdir(installation);
      // Static PowerShell program, literal paths from process environment. No
      // cmd.exe argument interpolation and no modification of an installed host.
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:WORKPROOF_HOST_ARCHIVE -DestinationPath $env:WORKPROOF_HOST_DEST -ErrorAction Stop'],{env:{...process.env,WORKPROOF_HOST_ARCHIVE:archivePath,WORKPROOF_HOST_DEST:installation},windowsHide:true,timeout:120000});
      executable=path.join(installation,'Code.exe');
    }else{
      execFileSync('/usr/bin/ditto',['-xk',archivePath,temporary]);installation=path.join(temporary,'Visual Studio Code.app','Contents');executable=path.join(installation,'MacOS','Electron');
    }
    await fs.access(executable);
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
    // Match Microsoft's code.cmd on Windows: invoke the packaged CLI with
    // ELECTRON_RUN_AS_NODE, without shelling out through a batch file.
    const cli=platform==='win32'?executable:path.join(installation,platform==='darwin'?'Resources/app/bin':'bin','code');
    const cliPrefix=platform==='win32'?[path.join(installation,'resources','app','out','cli.js')]:[];
    const cliEnvironment=platform==='win32'?{...environment,ELECTRON_RUN_AS_NODE:'1',VSCODE_DEV:''}:environment;
    execFileSync(cli,[...cliPrefix,...common,'--install-extension',vsix,'--force'],{env:cliEnvironment,stdio:'pipe',windowsHide:true,timeout:60000});
    const installed=execFileSync(cli,[...cliPrefix,...common,'--list-extensions','--show-versions'],{env:cliEnvironment,encoding:'utf8',windowsHide:true,timeout:60000});
    assert(installed.trim().split(/\r?\n/).includes(extensionId),'Expected the exact WorkProof extension version');
    const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    code=spawn(executable,[...common,'--disable-gpu','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--locale=en',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',workspace,file],{env:environment,stdio:'ignore'});
    browser=await until(()=>chromium.connectOverCDP('http://127.0.0.1:'+port),'VS Code workbench CDP');
    page=await until(async()=>{const p=browser.contexts().flatMap(context=>context.pages()).find(p=>p.url().includes('workbench'));assert(p);return p;},'Workbench window');
    page.setDefaultTimeout(30000);
    await page.locator('.monaco-workbench').waitFor();
    async function command(title){
      await page.keyboard.press(modifier+'+Shift+P');
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
    await page.locator('.monaco-editor').first().click();await page.keyboard.press(platform==='darwin'?'Meta+ArrowDown':'Control+End');
    await page.keyboard.insertText('Observed edit in the actual editor.\n');
    await command('WorkProof: 暂停 / 继续记录');
    await until(async()=>assert((await status.allTextContents()).join('').includes('已暂停')),'Paused state');
    await page.locator('.monaco-editor').first().click();await page.keyboard.press(platform==='darwin'?'Meta+ArrowDown':'Control+End');
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
    assert.equal(createHash('sha256').update(await fs.readFile(vsix)).digest('hex'),vsixDigest);
    await page.screenshot({path:path.join(evidence,'paused-export.png')});
    await fs.writeFile(path.join(evidence,'acceptance.json'),JSON.stringify({
      source_commit:process.env.GITHUB_SHA,platform,architecture:process.arch,update_target:updateTarget,vscode_version:release.productVersion,vscode_commit:release.version,
      extension:{id:extensionId,file:path.basename(vsix),sha256:vsixDigest},
      archive_sha256:release.sha256hash,scope:`Official stable VS Code on ${platform}/${process.arch}; installed VSIX in a disposable profile; actual UI confirmation, editor, pause and simple save dialog; real Rust verification and tamper refusal. No mocked VS Code APIs. Only the exact host version recorded here, not all historical versions.`,checks:['official archive SHA-256','exact installed VSIX version','user confirmation','real editor change','pause persists through export','paused content absent from records','original file independently verifies','modified file rejected','VSIX bytes unchanged'],
    },null,2));
    console.log('PASS: actual VS Code installed VSIX, editor events, paused export and independent Rust verification');
  }finally{
    if(page)await page.screenshot({path:path.join(evidence,'last-ui.png')}).catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    for(const child of [code,recorder])if(child&&child.exitCode===null){
      if(platform==='win32'){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:10000});}catch{}}
      else child.kill('SIGTERM');
    }
    // Only the newly-created test directory; no real user profile is used.
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep+'workproof-vscode-host-'));
    assert.notEqual(path.resolve(temporary),path.resolve(os.tmpdir()));
    await fs.rm(temporary,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
