"""Real, offline C2PA PNG round trips with synthetic image, process records and CA."""
import json, os, pathlib, shutil, struct, subprocess, sys, tempfile, zlib
assert os.environ.get('GITHUB_ACTIONS') == 'true'
tool, fixture = map(lambda p: str(pathlib.Path(p).resolve()), sys.argv[1:3])
openssl = shutil.which('openssl')
assert openssl
def run(*args, ok=True):
    result = subprocess.run(list(map(str,args)),capture_output=True,timeout=60)
    assert (result.returncode == 0) == ok, result.stderr.decode(errors='replace')[:800]
    return result
def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
def png(pixel):
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'+pixel))+chunk(b'IEND',b'')
with tempfile.TemporaryDirectory(prefix='workproof-c2pa-ci-') as name:
    root=pathlib.Path(name);original=root/'original.png';original.write_bytes(png(b'\x14\x99\x88\xff'))
    snapshot=original.read_bytes();run(fixture,original,root)
    proof_snapshot=(root/'full.wproof').read_bytes()
    run(openssl,'req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/'ca.key','-out',root/'ca.pem','-days','2','-subj','/CN=WorkProof synthetic C2PA CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
    run(openssl,'req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/'signer.key','-out',root/'signer.csr','-subj','/CN=WorkProof synthetic C2PA signer')
    (root/'ext.cnf').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    run(openssl,'x509','-req','-in',root/'signer.csr','-CA',root/'ca.pem','-CAkey',root/'ca.key','-CAcreateserial','-out',root/'signer.pem','-days','2','-extfile',root/'ext.cnf')
    (root/'chain.pem').write_bytes((root/'signer.pem').read_bytes()+(root/'ca.pem').read_bytes())
    signed=root/'signed.png'
    def embed(proof='full.wproof',destination=signed,source=original,consent=True,ok=True):
        args=[tool,'embed',source,root/proof,root/'chain.pem',root/'signer.key',destination]
        if consent: args.append('--allow-public-process')
        return run(*args,ok=ok)
    embed(consent=False,ok=False);assert not signed.exists()
    packaged=json.loads(embed().stdout);assert packaged['original_png_checked'] and not packaged['c2pa_trusted']
    report=json.loads(run(tool,'verify',signed,root/'ca.pem').stdout)
    assert report['c2pa_integrity_valid'] and report['c2pa_trusted'] and report['original_png_checked'] and report['workproof']['valid'] and report['workproof']['scope']=='full'
    assert not any(report[k] for k in ['identity_verified','creation_time_verified','revocation_checked','network_used'])
    signed_snapshot=signed.read_bytes();embed(ok=False);assert signed.read_bytes()==signed_snapshot
    embed(source=signed,destination=root/'nested.png',ok=False);assert not (root/'nested.png').exists()
    # Independent wrong trust anchor; does not depend on any other workflow's fixture.
    run(openssl,'req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/'wrong.key','-out',root/'wrong.pem','-days','2','-subj','/CN=Wrong synthetic CA','-addext','basicConstraints=critical,CA:TRUE')
    run(tool,'verify',signed,root/'wrong.pem',ok=False)
    # Change actual image pixels while retaining structurally valid chunks and valid CRCs.
    data=signed_snapshot;pos=8;changed=data[:8];assertion_changed=data[:8];found=False
    while pos<len(data):
        length=int.from_bytes(data[pos:pos+4],'big');kind=data[pos+4:pos+8];body=data[pos+8:pos+8+length]
        changed+=chunk(kind,zlib.compress(b'\0\xff\0\0\xff') if kind==b'IDAT' else body)
        altered=body
        if kind==b'caBX' and b'png-remove-cabx-v1' in body:
            altered=body.replace(b'png-remove-cabx-v1',b'png-remove-cabx-v0',1);found=True
        assertion_changed+=chunk(kind,altered);pos+=12+length
    assert found, 'Expected uncompressed custom assertion in the actual C2PA chunk'
    (root/'changed.png').write_bytes(changed);run(tool,'verify',root/'changed.png',root/'ca.pem',ok=False)
    (root/'assertion-changed.png').write_bytes(assertion_changed);run(tool,'verify',root/'assertion-changed.png',root/'ca.pem',ok=False)
    proof=json.loads(proof_snapshot);proof['records'][1]['event']['elapsed_ms']+=1
    (root/'bad.wproof').write_text(json.dumps(proof));embed(proof='bad.wproof',destination=root/'bad.png',ok=False);assert not (root/'bad.png').exists()
    selected=root/'selected.png';embed(proof='selected.wproof',destination=selected)
    partial=json.loads(run(tool,'verify',selected,root/'ca.pem').stdout)
    assert partial['workproof']['scope']=='selective' and partial['workproof']['disclosed_events']==1 and partial['workproof']['total_events']==3
    # Runtime evidence for offline verification, in addition to disabled HTTP features.
    trace=root/'network.trace';run('strace','-f','-e','trace=network','-o',trace,tool,'verify',signed,root/'ca.pem')
    calls=trace.read_text();assert 'connect(' not in calls and 'sendto(' not in calls
    assert original.read_bytes()==snapshot and (root/'full.wproof').read_bytes()==proof_snapshot
pathlib.Path('test-c2pa-results.json').write_text(json.dumps({'real_c2pa_png':True,'explicit_ca':True,'full_and_selective':True,'tamper_rejected':True,'original_bytes_unchanged':True,'verification_network_calls':False,'synthetic_authority_only':True},indent=2))
print('PASS: real C2PA PNG packaging, exact original-byte binding, explicit CA trust, full/partial scope, tamper/wrong-root/overwrite rejection and offline verification')
