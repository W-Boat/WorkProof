import {md5} from '@noble/hashes/legacy.js';
import type {Result} from './evidence';
import {REPORT_READER,REPORT_STYLE} from './report-shell';

export type ReportPackage={
  schema:'workproof-report/1';exported_at:string;result:Result;
  application:unknown;metadata:unknown;auxiliary_text:string;
  certificate:{name:string;type:string;base64:string};
  artifact:{name:string;type:string;bytes:number};
};
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
export function base64(bytes:Uint8Array){const parts:string[]=[];for(let offset=0;offset<bytes.length;offset+=49152)parts.push(btoa(String.fromCharCode(...bytes.subarray(offset,offset+49152))));return parts.join('');}
const check=(signal?:AbortSignal)=>{if(signal?.aborted)throw new Error('已取消生成报告。');};

export async function createEncryptedReport(input:{result:Result;artifact:File;proof:File;metadata?:unknown;application?:unknown;auxiliaryText?:string},password:string,signal?:AbortSignal){
  if(Array.from(password).length<8||password.length>1024)throw new Error('请设置至少 8 个字符的密码。');
  if(!crypto.subtle)throw new Error('当前环境不支持本机加密，请使用完整客户端或 HTTPS 页面。');
  if(input.proof.size>32*1024*1024)throw new Error('证书超过本次报告封装范围（最多 32 MB）。');
  check(signal);
  const model:ReportPackage={schema:'workproof-report/1',exported_at:new Date().toISOString(),result:input.result,application:input.application??null,metadata:input.metadata??{status:'not_run'},auxiliary_text:input.auxiliaryText??'',certificate:{name:input.proof.name,type:input.proof.type||'application/json',base64:base64(new Uint8Array(await input.proof.arrayBuffer()))},artifact:{name:input.artifact.name,type:input.artifact.type||'application/octet-stream',bytes:input.artifact.size}};
  check(signal);const plain=new TextEncoder().encode(JSON.stringify(model));
  if(plain.byteLength>80*1024*1024)throw new Error('完整报告超过 80 MB，本次无法生成；不会截断记录。');
  const runtime=await fetch(new URL('report-viewer.js',document.baseURI),{signal});
  if(!runtime.ok)throw new Error('离线报告组件未能加载，请确认安装包完整。');
  const viewer=new Uint8Array(await runtime.arrayBuffer());if(viewer.byteLength>8*1024*1024)throw new Error('离线报告组件超出预期大小。');
  const viewerHash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',viewer)));
  check(signal);const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},material,{name:'AES-GCM',length:256},false,['encrypt']);
  check(signal);const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('workproof-encrypted-report/1:'+viewerHash)},key,plain);check(signal);
  const envelope={schema:'workproof-encrypted-report/1',kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:base64(salt),iv:base64(iv),ciphertext:base64(new Uint8Array(ciphertext)),viewer:base64(viewer),viewer_sha256:viewerHash};
  const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>WorkProof 加密核验报告</title><style>'+REPORT_STYLE+'</style></head><body><main class="unlock"><p>WorkProof</p><h1>加密核验报告</h1><p>输入报告提供者单独告知你的密码。解密在本机进行，不上传文件。</p><form id="unlock-form"><label for="report-password">报告密码</label><input id="report-password" type="password" autocomplete="off" required><button type="submit">打开报告</button></form><p id="unlock-status" role="status"></p><p class="note">HTML 的 MD5 与 SHA-256 在配套校验文件中。密码不保存在报告里。</p></main><script type="application/json" id="report-envelope">'+JSON.stringify(envelope)+'</script><script>'+REPORT_READER+'</script></body></html>';
  const bytes=new TextEncoder().encode(html);if(bytes.byteLength>128*1024*1024)throw new Error('加密 HTML 超过 128 MB，无法保存；报告没有截断。');
  const sha256=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));check(signal);
  return {html,md5:hex(md5(bytes)),sha256,bytes:bytes.length,model};
}
