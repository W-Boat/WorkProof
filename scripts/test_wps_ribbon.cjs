// Host simulations only; these do not replace actual WPS loading.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const source=readFileSync('apps/office/wps/main.js','utf8');
function fixture({alias='Application',url='https://institution.example/office/wps/index.html',create}={}){
  const calls=[],messages=[];
  const api={CreateTaskPane(href,title){calls.push({href,title});return create?create():{};}};
  const context={window:{location:new URL(url),[alias]:api},URL,alert:message=>messages.push(message)};
  vm.createContext(context);vm.runInContext(source,context);
  return {context,calls,messages,open:()=>context.OnOpenWorkProof()};
}
for(const alias of ['Application','wps'])test(`${alias}: reuse taskpane, ignore query-string destinations`,()=>{
  const f=fixture({alias,url:'https://institution.example/office/wps/index.html?url=https://attacker.example/'});
  f.open();f.open();assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].href,'https://institution.example/office/index.html?host=wps');
  assert.equal(f.context.workproofPane.Visible,true);assert.deepEqual(f.messages,[]);
});
test('recreate a taskpane whose native handle was disposed',()=>{
  let disposed=false;
  const f=fixture({create:()=>({set Visible(value){if(disposed)throw Error('disposed');}})});
  f.open();disposed=true;
  f.context.window.Application.CreateTaskPane=()=>{f.calls.push({});disposed=false;return {};};
  f.open();assert.equal(f.calls.length,2);assert.equal(f.messages.length,0);
});
for(const url of ['http://institution.example/office/wps/','file:///C:/office/wps/index.html','https://user:password@institution.example/office/wps/'])test(`refuse unsafe ribbon origin ${new URL(url).protocol}`,()=>{
  const f=fixture({url});f.open();assert.equal(f.calls.length,0);assert.equal(f.messages.length,1);
});
test('permit local HTTP development without changing host security settings',()=>{
  const f=fixture({url:'http://127.0.0.1:4173/office/wps/index.html'});f.open();
  assert.equal(f.calls[0].href,'http://127.0.0.1:4173/office/index.html?host=wps');
});
test('report host denial and permit a later user retry',()=>{
  let denied=true;const f=fixture({create:()=>{if(denied)throw Error('permission denied');return {};}});
  f.open();assert.match(f.messages[0],/permission denied/);assert.equal(f.context.workproofPane,null);
  denied=false;f.open();assert.equal(f.context.workproofPane.Visible,true);
});
