// Independent JS encoding and tree oracle against Rust CLI output, run only in Actions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','Run only in GitHub Actions');
  const {blake3}=await import('@noble/hashes/blake3.js');
  const digest=b=>Buffer.from(blake3(b));
  const field=s=>{const bytes=Buffer.from(s,'utf8'),length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,bytes]);};
  const number=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
  const encodeEvent=(previous,e)=>{
    const parts=[Buffer.from('WorkProof:event:v1\0'),field(previous),...[e.seq,e.elapsed_ms,e.inserted,e.deleted,e.chars].map(number),field(e.kind),field(e.checkpoint)];
    const keys=Object.keys(e.metrics||{}).sort();
    if(keys.length){const count=Buffer.alloc(4);count.writeUInt32LE(keys.length);parts.push(Buffer.from('WorkProof:metrics:v2\0'),count,...keys.flatMap(k=>[field(k),number(e.metrics[k])]));}
    return digest(Buffer.concat(parts)).toString('hex');
  };
  const leaf=(session,r)=>digest(Buffer.concat([Buffer.from('WorkProof:merkle-leaf:v3\0'),field(session),field(r.hash),field(encodeEvent('',r.event))]));
  const node=(left,right)=>digest(Buffer.concat([Buffer.from('WorkProof:merkle-node:v3\0'),left,right]));
  // Recursive split oracle differs from Rust's level/promotion implementation.
  const root=leaves=>{if(leaves.length===1)return leaves[0];let k=1;while(k*2<leaves.length)k*=2;return node(root(leaves.slice(0,k)),root(leaves.slice(k)));};
  const engine=path.resolve(process.argv[2]);
  const fixture='apps/verifier/public/demo/';
  const original=JSON.parse(fs.readFileSync(fixture+'essay.md.wproof','utf8'));
  const m=original.manifest;
  assert.equal(m.protocol,'workproof/3');
  assert.equal(root(original.records.map(r=>leaf(m.session_id,r))).toString('hex'),m.merkle_root);
  const signing=Buffer.concat([Buffer.from('WorkProof:manifest:v3\0'),...[m.protocol,m.session_id,m.file_name,m.started_at,m.source,m.chain_head,m.artifact_hash,m.public_key,m.identity,m.time_evidence].map(field),number(m.event_count),number(m.artifact_bytes),Buffer.from([m.demo?1:0]),field(m.merkle_root)]);
  const key=crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(m.public_key,'hex')]),format:'der',type:'spki'});
  assert.equal(crypto.verify(null,signing,key,Buffer.from(original.signature,'hex')),true);
  assert.equal(digest(fs.readFileSync(fixture+'essay.md')).toString('hex'),m.artifact_hash);
  const temporaryRoot=fs.realpathSync(os.tmpdir());
  const directory=fs.mkdtempSync(path.join(temporaryRoot,'workproof-disclosure-'));
  try{
    const selected=path.join(directory,'selected.wproof');
    const run=(args,code=0)=>{const p=spawnSync(engine,args,{encoding:'utf8'});assert.equal(p.status,code,p.stderr||p.stdout);return p;};
    run(['disclose',fixture+'essay.md.wproof',selected,'5,20,40']);
    const d=JSON.parse(fs.readFileSync(selected,'utf8'));
    assert.equal(d.signature,original.signature);assert.deepEqual(d.manifest,m);
    assert.deepEqual(d.disclosed.map(e=>e.record.event.seq),[0,5,20,40,85]);
    assert.equal('records' in d,false);
    const reference=JSON.parse(fs.readFileSync(fixture+'essay.md.selected.wproof','utf8'));
    assert.deepEqual(d,reference);
    for(const entry of d.disclosed){
      let value=leaf(m.session_id,entry.record),index=entry.record.event.seq,width=m.event_count,cursor=0;
      while(width>1){
        if(index%2===1||index+1<width){const sibling=Buffer.from(entry.siblings[cursor++],'hex');value=index%2?node(sibling,value):node(value,sibling);}
        index=Math.floor(index/2);width=Math.ceil(width/2);
      }
      assert.equal(cursor,entry.siblings.length);assert.equal(value.toString('hex'),m.merkle_root);
    }
    const report=JSON.parse(run(['verify',fixture+'essay.md',selected]).stdout);
    assert.equal(report.valid,true);assert.equal(report.scope,'selective');assert.equal(report.chain_valid,false);assert.equal(report.merkle_valid,true);
    // Replacing a file must fail, even if the disclosed event paths are genuine.
    const replacement=path.join(directory,'replacement.txt');fs.writeFileSync(replacement,'replacement');run(['verify',replacement,selected],2);
    d.disclosed[1].record.event.chars++;
    const bad=path.join(directory,'bad.wproof');fs.writeFileSync(bad,JSON.stringify(d));run(['verify',fixture+'essay.md',bad],2);
    assert.notEqual(spawnSync(engine,['disclose',fixture+'essay.md.wproof',selected,'5']).status,0,'Never overwrite an existing certificate');
    const legacy=path.join(directory,'legacy-selected.wproof');
    assert.notEqual(spawnSync(engine,['disclose','crates/proof/tests/fixtures/v2-demo.wproof',legacy]).status,0,'Legacy proofs cannot acquire a new unsigned root');
    run(['verify',fixture+'essay.md','crates/proof/tests/fixtures/v2-demo.wproof']);
    console.log('PASS: independent BLAKE3 tree/encoding/Ed25519, CLI selective export, legacy compatibility, no-overwrite and tamper/file rejection');
  }finally{
    assert.equal(path.dirname(fs.realpathSync(directory)),temporaryRoot);
    assert.equal(path.basename(directory).startsWith('workproof-disclosure-'),true);
    fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
