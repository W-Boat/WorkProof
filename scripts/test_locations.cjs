// Same input environments must resolve to the same directory in Rust, TS and Python.
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {transformSync}=require('esbuild');
const output=transformSync(fs.readFileSync('apps/extension/src/location.ts','utf8'),{loader:'ts',format:'cjs',platform:'node'}).code;
const moduleFixture={exports:{}};vm.runInNewContext(output,{module:moduleFixture,exports:moduleFixture.exports,require,process});
const resolve=moduleFixture.exports.dataDirectory;
const root=path.join(os.tmpdir(),'WorkProof path fixture with spaces');
const engine=path.resolve(process.argv[2]);
const python=process.platform==='win32'?'python':'python3';
const py="import importlib.util,sys; s=importlib.util.spec_from_file_location('location',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.data_directory())";
const home=path.join(root,'home'),base=path.join(root,'base');
const fixtures=[
  {name:'explicit override',vars:{WORKPROOF_DATA_DIR:path.join(root,'custom')},expected:path.join(root,'custom')},
  {name:'relative override rejected',vars:{WORKPROOF_DATA_DIR:'relative-state'},expected:null},
  {name:'home default',vars:{HOME:home},expected:process.platform==='win32'?path.join(home,'AppData','Local','WorkProof'):process.platform==='darwin'?path.join(home,'Library','Application Support','WorkProof'):path.join(home,'.local','share','WorkProof')},
  {name:'no home rejected',vars:{},expected:null},
];
if(process.platform!=='darwin')fixtures.push({name:'native base without home',vars:process.platform==='win32'?{LOCALAPPDATA:base}:{XDG_DATA_HOME:base},expected:path.join(base,'WorkProof')});
fixtures.push({name:'relative native base ignored',vars:{HOME:home,LOCALAPPDATA:'relative',XDG_DATA_HOME:'relative'},expected:fixtures[2].expected});
fixtures.push({name:'invalid home falls back to user profile',vars:{HOME:'relative-home',USERPROFILE:home},expected:fixtures[2].expected});
for(const fixture of fixtures){
  const env={...process.env,PYTHONIOENCODING:'utf-8'};
  // Windows inherits case-insensitive environment names; process.env may expose
  // Home/UserProfile/LocalAppData spellings. Remove all equivalent names before
  // passing the explicit fixture, so "no home" cannot retain a real profile.
  const locationKeys=new Set(['WORKPROOF_DATA_DIR','HOME','USERPROFILE','LOCALAPPDATA','XDG_DATA_HOME']);
  for(const key of Object.keys(env))if(locationKeys.has(key.toUpperCase()))delete env[key];Object.assign(env,fixture.vars);
  const rust=spawnSync(engine,[],{env,encoding:'utf8'});
  const pythonResult=spawnSync(python,['-c',py,path.resolve('apps/blender/workproof/location.py')],{env,encoding:'utf8'});
  if(fixture.expected===null){
    assert.notEqual(rust.status,0,fixture.name);assert.notEqual(pythonResult.status,0,fixture.name);assert.throws(()=>resolve(env));
  }else{
    assert.equal(rust.status,0,rust.stderr);assert.equal(pythonResult.status,0,pythonResult.stderr);
    assert.equal(path.normalize(rust.stdout.trim()),fixture.expected,fixture.name);
    assert.equal(path.normalize(pythonResult.stdout.trim()),fixture.expected,fixture.name);assert.equal(resolve(env),fixture.expected,fixture.name);
  }
}
console.log(`PASS: ${fixtures.length} shared state-directory cases on ${process.platform}; no filesystem state created`);
