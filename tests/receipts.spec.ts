import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

test('real Rust receipt is verified locally only after independent key trust',async({page},info)=>{
  const temporary=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(temporary,'workproof-browser-receipt-'));
  const receipt=info.outputPath('synthetic-receipt.json'),publicFile=info.outputPath('synthetic-public.hex'),wrongFile=info.outputPath('wrong-public.hex');
  fs.mkdirSync(path.dirname(receipt),{recursive:true});
  try{
    const keys=crypto.generateKeyPairSync('ed25519'),privateFile=path.join(directory,'private.hex');
    fs.writeFileSync(privateFile,keys.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('hex'),{mode:0o600});
    fs.writeFileSync(publicFile,keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'));
    fs.writeFileSync(wrongFile,crypto.generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'));
    execFileSync(path.resolve('target/debug/workproof-receipt'),['issue',path.resolve('apps/verifier/public/demo/essay.md.wproof'),receipt,'browser-test','86400',privateFile],{timeout:15000});
  }finally{expect(path.dirname(fs.realpathSync(directory))).toBe(temporary);expect(path.basename(directory)).toMatch(/^workproof-browser-receipt-/);fs.rmSync(directory,{recursive:true,force:true});}
  const external:string[]=[];page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173')&&!request.url().startsWith('blob:'))external.push(request.url());});
  await page.goto('/');await page.getByRole('button',{name:'先体验一份演示证据'}).click();await expect(page.getByText('证据核验通过',{exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'核验页面'}).getByRole('button',{name:'辅助检查',exact:true}).click();await page.getByRole('navigation',{name:'选择辅助检查'}).getByRole('button',{name:'机构回执',exact:true}).click();
  const panel=page.getByRole('region',{name:'检查机构接收回执',exact:true});await panel.getByText('核对签发者与接收回执（可选）',{exact:true}).click();
  await panel.getByLabel('接收回执（.json）').setInputFiles(receipt);await panel.getByLabel('独立取得的签发公钥（.hex）').setInputFiles(publicFile);await panel.getByLabel('签发者标识',{exact:true}).fill('browser-test');
  const submit=panel.getByRole('button',{name:'检查接收回执',exact:true});await expect(submit).toBeDisabled();await panel.getByRole('checkbox').check();await submit.click();
  await expect(panel.getByText('接收回执与当前证据一致',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'证据信任状态'})).toContainText('未认证');
  await panel.getByLabel('独立取得的签发公钥（.hex）').setInputFiles(wrongFile);await expect(panel.getByRole('checkbox')).not.toBeChecked();await expect(panel.getByRole('status')).toHaveCount(0);await panel.getByRole('checkbox').check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByLabel('独立取得的签发公钥（.hex）').setInputFiles(publicFile);await panel.getByLabel('签发者标识',{exact:true}).fill('untrusted-name');await panel.getByRole('checkbox').check();await submit.click();await expect(panel.getByRole('alert')).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(external).toEqual([]);
});
