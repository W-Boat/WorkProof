import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import {dataDirectory} from './location';

type Event = {seq:number;elapsed_ms:number;kind:string;inserted:number;deleted:number;chars:number;checkpoint:string;metrics?:Record<string,number>};
type Session = {id:string;uri:string;next:number;elapsed:number;pending:Event[];paused:boolean;chars:number};
type Pair = {port:number;token:string};
let ctx:vscode.ExtensionContext, session:Session|undefined, pair:Pair|undefined;
let baseline=performance.now(), elapsedBase=0, sending:Promise<void>|undefined, timer:ReturnType<typeof setInterval>;
let status:vscode.StatusBarItem, fault='';
let actionBusy=false;
const hex=(b:Uint8Array)=>Buffer.from(b).toString('hex');
const elapsed=()=>Math.floor(elapsedBase+performance.now()-baseline);
function paint(){if(!status)return;status.text=session?`$(shield) WorkProof · ${fault?'连接中断':session.paused?'已暂停':'记录中'}`:'$(shield) WorkProof';status.tooltip=fault||'点击选择记录操作；不保存文本内容';status.show();}
async function persist(){await ctx.workspaceState.update('workproof.session',session);}
async function autoPair(){
  const dir=dataDirectory();
  const value=JSON.parse(await fs.readFile(path.join(dir,'connection.json'),'utf8')) as Pair;
  if(value.port!==43127||!/^[0-9a-f]{64}$/.test(value.token))throw new Error('本地引擎连接信息无效，请重新打开 WorkProof。');
  pair=value;await ctx.secrets.store('workproof.pair',JSON.stringify(value));
}
async function api<T>(route:string,body?:unknown):Promise<T>{
  if(!pair)await autoPair();
  const request=()=>fetch(`http://127.0.0.1:${pair!.port}${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${pair!.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  let response=await request();
  if(response.status===401){await autoPair();response=await request();}
  const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result as T;
}
function enqueue(kind:string,inserted=0,deleted=0,checkpoint='',metrics?:Record<string,number>){
  if(!session)return;
  // Stop collecting on overflow. Retain the queued prefix and disclose the gap.
  if(session.pending.length>=2048){session.paused=true;fault='离线队列已满，已暂停。恢复后会记录采集缺口。';paint();return;}
  session.pending.push({seq:session.next++,elapsed_ms:elapsed(),kind,inserted,deleted,chars:session.chars,checkpoint,...(metrics&&Object.keys(metrics).length?{metrics}:{})});session.elapsed=elapsed();paint();
}
async function flush(){
  if(sending)return sending;
  sending=(async()=>{while(session&&session.pending.length){const current=session;const batch=current.pending.slice(0,128);await api(`/v1/sessions/${current.id}/events`,{events:batch});if(session!==current)return;current.pending.splice(0,batch.length);await persist();}fault='';paint();})();
  try{await sending;}catch(error){fault=String(error);paint();throw error;}finally{sending=undefined;}
}
async function safe(action:()=>Promise<unknown>){
  if(actionBusy){void vscode.window.showInformationMessage('上一步还在处理，请稍后再试。');return;}
  actionBusy=true;
  try{await action();}catch(e){void vscode.window.showErrorMessage(`WorkProof: ${e instanceof Error?e.message:String(e)}`);}finally{actionBusy=false;}
}
async function pairEngine(){
  const defaultFile=path.join(dataDirectory(),'connection.json');
  let file=defaultFile;
  try{await fs.access(file);}catch{const choice=await vscode.window.showOpenDialog({canSelectMany:false,filters:{'引擎配对文件':['json']},openLabel:'选择 connection.json'});if(!choice)return;file=choice[0].fsPath;}
  const value=JSON.parse(await fs.readFile(file,'utf8')) as Pair;
  if(value.port!==43127||!/^[0-9a-f]{64}$/.test(value.token))throw new Error('配对文件无效。');
  pair=value;await api('/v1/status');await ctx.secrets.store('workproof.pair',JSON.stringify(value));
  void vscode.window.showInformationMessage('WorkProof 已配对，仅连接本机引擎。');
}
async function start(){
  if(session)throw new Error('当前已有记录，请先导出或停止。');
  if(vscode.env.remoteName)throw new Error('首版仅支持本地 VS Code 文件。');
  const doc=vscode.window.activeTextEditor?.document;
  if(!doc||doc.uri.scheme!=='file')throw new Error('请打开已保存的本地文本文件。');
  if(!vscode.workspace.isTrusted)throw new Error('请先信任当前工作区。');
  const yes=await vscode.window.showInformationMessage(`仅为「${path.basename(doc.fileName)}」记录增删量、撤销和保存。不保存文字；不判断是否使用 AI。`,'开始记录');if(!yes)return;
  if(!pair)await autoPair();
  const result=await api<{session_id:string}>('/v1/sessions',{file_name:path.basename(doc.fileName),started_at:new Date().toISOString(),source:'vscode'});
  baseline=performance.now();elapsedBase=0;session={id:result.session_id,uri:doc.uri.toString(),next:0,elapsed:0,pending:[],paused:false,chars:doc.getText().length};enqueue('start');await persist();await flush();
}
async function toggle(){if(!session)throw new Error('没有正在记录的文件。');if(session.paused){await flush();session.paused=false;enqueue('gap');enqueue('resume');}else{enqueue('pause');session.paused=true;}await persist();paint();await flush();}
async function exportProof(){
  if(!session)throw new Error('没有正在记录的文件。');
  const current=session;const doc=await vscode.workspace.openTextDocument(vscode.Uri.parse(current.uri));
  if(!await doc.save())throw new Error('文件未保存。');
  const version=doc.version;
  const bytes=await fs.readFile(doc.uri.fsPath);
  if(doc.isDirty||doc.version!==version)throw new Error('文件在读取期间发生变化，请重试。');
  const fingerprint=hex(blake3(bytes));
  // Exporting while paused is an explicit snapshot, not a resumption of collection.
  // Reserve room for both the disclosed gap and the final byte-bound checkpoint.
  if(current.pending.length>(current.paused?2046:2047))throw new Error('还有操作尚未保存，请恢复本机服务后重试导出。');
  current.chars=doc.getText().length;
  if(current.paused)enqueue('gap');
  enqueue('save',0,0,fingerprint);await persist();await flush();
  if(doc.isDirty||doc.version!==version||session!==current)throw new Error('导出期间有新的编辑，请重试。');
  const proof=await api(`/v1/sessions/${current.id}/export`,{artifact_hash:fingerprint,artifact_bytes:bytes.length});
  const second=await fs.readFile(doc.uri.fsPath);
  if(doc.isDirty||doc.version!==version||hex(blake3(second))!==fingerprint)throw new Error('文件在导出期间发生变化，请重试。');
  const target=await vscode.window.showSaveDialog({defaultUri:vscode.Uri.file(doc.uri.fsPath+'.wproof'),filters:{WorkProof:['wproof']}});if(!target)return;
  await fs.writeFile(target.fsPath,JSON.stringify(proof,null,2));void vscode.window.showInformationMessage('已导出过程证书。请将当前作品文件与 .wproof 一起交付。');
}
async function stop(){if(!session)return;const yes=await vscode.window.showWarningMessage('停止后可开始新记录。未导出的证书不会自动保存。','停止记录');if(!yes)return;enqueue('stop');await persist();await flush();session=undefined;await persist();paint();}
export async function activate(context:vscode.ExtensionContext){
  ctx=context;const saved=await ctx.secrets.get('workproof.pair');if(saved){try{pair=JSON.parse(saved);}catch{}}
  session=ctx.workspaceState.get<Session>('workproof.session');
  if(session){elapsedBase=session.elapsed;baseline=performance.now();session.paused=true;enqueue('gap');await persist();}
  status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,10);status.command='workproof.menu';ctx.subscriptions.push(status);
  for(const [name,fn] of Object.entries({pair:pairEngine,start,pause:toggle,export:exportProof,stop}))ctx.subscriptions.push(vscode.commands.registerCommand(`workproof.${name}`,()=>safe(fn)));
  ctx.subscriptions.push(vscode.commands.registerCommand('workproof.menu',async()=>{const item=await vscode.window.showQuickPick([{label:'记录当前文件',id:'start'},{label:'暂停 / 继续',id:'pause'},{label:'导出过程证书',id:'export'},{label:'配对本地引擎',id:'pair'},{label:'停止记录',id:'stop'}]);if(item)await vscode.commands.executeCommand(`workproof.${item.id}`);}));
  ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e=>{
    if(!session||session.paused||e.document.uri.toString()!==session.uri||!e.contentChanges.length)return;
    session.chars=e.document.getText().length;
    const kind=e.reason===vscode.TextDocumentChangeReason.Undo?'undo':e.reason===vscode.TextDocumentChangeReason.Redo?'redo':'edit';
    // Observe resulting whitespace, not keystrokes or inferred paste actions.
    const spaces=e.contentChanges.reduce((n,c)=>n+(c.text.match(/ /g)?.length||0),0);
    const breaks=e.contentChanges.reduce((n,c)=>n+(c.text.match(/\r\n|\r|\n/g)?.length||0),0);
    enqueue(kind,e.contentChanges.reduce((n,c)=>n+c.text.length,0),e.contentChanges.reduce((n,c)=>n+c.rangeLength,0),'',{
      ...(spaces?{spaces_inserted:spaces}:{}),...(breaks?{line_breaks_inserted:breaks}:{})
    });
  }));
  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc=>{if(session&&!session.paused&&session.uri===doc.uri.toString())enqueue('save');}));
  timer=setInterval(()=>{if(session?.pending.length)void persist().then(()=>flush()).catch(()=>{});},1000);ctx.subscriptions.push({dispose:()=>clearInterval(timer)});paint();
}
export async function deactivate(){clearInterval(timer);if(session){enqueue('gap');await persist();}try{await flush();}catch{}}
