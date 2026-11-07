// Real CLI, synthetic issuer key, no local collector or production trust setup.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const binary=path.resolve(process.argv[2]),temporary=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(temporary,'workproof-receipt-'));
function call(args,ok=true){const result=spawnSync(binary,args,{encoding:'utf8',timeout:15000,env:{...process.env,WORKPROOF_DATA_DIR:directory}});assert(!result.error,'CLI must exit within deadline');if(ok)assert.equal(result.status,0,result.stderr);else assert.notEqual(result.status,0);return result;}
try{
  const proof=path.join(directory,'proof.wproof'),receipt=path.join(directory,'receipt.json'),privateFile=path.join(directory,'issuer-private.hex'),publicFile=path.join(directory,'issuer-public.hex'),wrongFile=path.join(directory,'wrong-public.hex');
  const seed=crypto.randomBytes(32),privateKey=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),type:'pkcs8',format:'der'}),publicKey=crypto.createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32);
  fs.writeFileSync(privateFile,seed.toString('hex'),{mode:0o600});fs.writeFileSync(publicFile,publicKey.toString('hex'));fs.writeFileSync(wrongFile,crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'));
  const original=fs.readFileSync('apps/verifier/public/demo/essay.md.wproof');fs.writeFileSync(proof,original);
  const created=JSON.parse(call(['issue',proof,receipt,'synthetic-test','60',privateFile]).stdout);assert.equal(created.receipt_created,true);assert.equal(created.client_origin_verified,false);assert.equal(created.artifact_checked,false);
  const bytes=fs.readFileSync(receipt),record=JSON.parse(bytes);assert.equal(record.payload.purpose,'server-received');assert.match(record.payload.receipt_id,/^[a-f0-9]{64}$/);assert.equal(record.payload.expires_at_ms-record.payload.received_at_ms,60000);
  const result=JSON.parse(call(['verify',proof,receipt,'synthetic-test','60',publicFile]).stdout);assert.equal(result.receipt_verified,true);for(const flag of ['artifact_checked','client_origin_verified','collection_verified','author_identity_verified','rule_calibration_verified'])assert.equal(result[flag],false);
  call(['issue',proof,receipt,'synthetic-test','60',privateFile],false);assert(fs.readFileSync(receipt).equals(bytes),'existing output must never be replaced');
  call(['verify',proof,receipt,'synthetic-test','60',wrongFile],false);call(['verify',proof,receipt,'other-issuer','60',publicFile],false);call(['verify',proof,receipt,'synthetic-test','59',publicFile],false);
  fs.appendFileSync(proof,' ');call(['verify',proof,receipt,'synthetic-test','60',publicFile],false);fs.writeFileSync(proof,original);
  const second=path.join(directory,'second.json');call(['issue',proof,second,'synthetic-test','60',privateFile]);assert.notEqual(JSON.parse(fs.readFileSync(second)).payload.receipt_id,record.payload.receipt_id);
  const invalid=path.join(directory,'invalid.wproof'),missing=path.join(directory,'must-not-exist.json');fs.writeFileSync(invalid,'{}');call(['issue',invalid,missing,'synthetic-test','60',privateFile],false);assert(!fs.existsSync(missing));
  call(['issue',proof,missing,'synthetic-test','0',privateFile],false);call(['issue',proof,missing,'synthetic-test','60','relative-key.hex'],false);call(['unknown'],false);
  assert(fs.readFileSync(proof).equals(original));assert(!fs.existsSync(path.join(directory,'signing-key.bin')));assert(!fs.existsSync(path.join(directory,'workproof.db')));
  console.log('PASS: real issuer receipt signing, independent trust, evidence mismatch, no-overwrite, fresh identifiers and no collector state');
}finally{assert.equal(path.dirname(fs.realpathSync(directory)),temporary);assert(path.basename(directory).startsWith('workproof-receipt-'));fs.rmSync(directory,{recursive:true,force:true});}
