// Native certificate-only inspection: never claims to have read an artifact.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const engine=path.resolve(process.argv[2]),inspector=path.resolve(process.argv[3]),temporaryRoot=fs.realpathSync(os.tmpdir());
const directory=fs.mkdtempSync(path.join(temporaryRoot,'workproof-inspection-'));
try{
  const full=JSON.parse(fs.readFileSync('apps/verifier/public/demo/essay.md.wproof','utf8'));
  function inspect(input){
    const bytes=Buffer.isBuffer(input)?input:JSON.stringify(input);
    const result=spawnSync(inspector,[],{input:bytes,encoding:'utf8',env:{...process.env,WORKPROOF_DATA_DIR:directory},timeout:15000});
    assert.equal(result.status,0,result.stderr);assert(Buffer.byteLength(result.stdout)<16*1024);
    const report=JSON.parse(result.stdout);assert.equal(report.protocol,'workproof-inspection/1');
    assert.equal(report.artifact_checked,false);assert.equal(report.identity_verified,false);assert.equal(report.time_verified,false);assert(!('file_match' in report));assert(!('records' in report));return report;
  }
  const valid=inspect(full);assert.equal(valid.certificate_valid,true);assert.equal(valid.signature_valid,true);assert.equal(valid.signature,full.signature);
  const embedded=spawnSync(engine,['inspect-stdin'],{input:JSON.stringify(full),encoding:'utf8',timeout:15000});assert.equal(embedded.status,0);assert.deepEqual(JSON.parse(embedded.stdout),valid);
  const unknown=spawnSync(engine,['unknown-command'],{env:{...process.env,WORKPROOF_DATA_DIR:directory},encoding:'utf8',timeout:5000});assert.notEqual(unknown.status,0);assert(!unknown.error,'Unknown commands must exit instead of starting a collector');
  const legacy=inspect(JSON.parse(fs.readFileSync('crates/proof/tests/fixtures/v2-demo.wproof','utf8')));assert.equal(legacy.certificate_valid,true);assert.equal(legacy.merkle_valid,null);
  const altered=structuredClone(full);altered.records[1].event.inserted++;assert.equal(inspect(altered).certificate_valid,false);
  const selected=path.join(directory,'selected.wproof');
  const exportResult=spawnSync(engine,['disclose',path.resolve('apps/verifier/public/demo/essay.md.wproof'),selected,'5'],{encoding:'utf8'});assert.equal(exportResult.status,0,exportResult.stderr);
  const partial=inspect(JSON.parse(fs.readFileSync(selected,'utf8')));assert.equal(partial.certificate_valid,true);assert.equal(partial.scope,'selective');assert.equal(partial.chain_valid,false);assert.equal(partial.signature,full.signature);
  assert.equal(inspect(Buffer.from('not JSON')).certificate_valid,false);
  assert.deepEqual(inspect(Buffer.alloc(32*1024*1024+1,32)).errors,['PROOF_TOO_LARGE']);
  const escaped=structuredClone(full);escaped.manifest.file_name='\0'.repeat(1024);escaped.manifest.source='\0'.repeat(128);escaped.manifest.session_id='\0'.repeat(128);inspect(escaped);
  assert.deepEqual(fs.readdirSync(directory),['selected.wproof'],'Inspection must not create keys, a database or connection metadata');
  console.log('PASS: real native full/partial certificate inspection, tamper/size rejection, bounded metadata and no artifact/state access');
}finally{
  assert.equal(path.dirname(fs.realpathSync(directory)),temporaryRoot);assert(path.basename(directory).startsWith('workproof-inspection-'));fs.rmSync(directory,{recursive:true,force:true});
}
