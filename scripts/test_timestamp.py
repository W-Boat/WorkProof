"""CI-only real RFC3161 exchanges with an explicitly untrusted, synthetic test CA."""
import json, os, pathlib, shutil, subprocess, sys, tempfile
assert os.environ.get('GITHUB_ACTIONS') == 'true'
engine = str(pathlib.Path(sys.argv[1]).resolve())
openssl = shutil.which('openssl')
assert openssl
proof = pathlib.Path('apps/verifier/public/demo/essay.md.wproof').resolve()
original = proof.read_bytes()
def run(*args, ok=True):
    result = subprocess.run([str(a) for a in args], capture_output=True, timeout=30)
    if ok: assert result.returncode == 0, result.stderr.decode(errors='replace')[:300]
    else: assert result.returncode != 0
    return result
with tempfile.TemporaryDirectory(prefix='workproof-rfc3161-') as name:
    root=pathlib.Path(name)
    run(openssl,'req','-x509','-newkey','rsa:2048','-nodes','-keyout',root/'ca.key','-out',root/'ca.pem','-days','2','-subj','/CN=WorkProof synthetic test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
    run(openssl,'req','-new','-newkey','rsa:2048','-nodes','-keyout',root/'tsa.key','-out',root/'tsa.csr','-subj','/CN=WorkProof synthetic TSA')
    (root/'extensions.cnf').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    run(openssl,'x509','-req','-in',root/'tsa.csr','-CA',root/'ca.pem','-CAkey',root/'ca.key','-CAcreateserial','-out',root/'tsa.pem','-days','2','-extfile',root/'extensions.cnf')
    (root/'serial').write_text('01\n')
    (root/'tsa.cnf').write_text(f'''[tsa]
default_tsa=tsa_config
[tsa_config]
serial={root}/serial
signer_cert={root}/tsa.pem
certs={root}/ca.pem
signer_key={root}/tsa.key
signer_digest=sha256
default_policy=1.2.3.4.1
other_policies=1.2.3.4.2
digests=sha256
accuracy=secs:1
ordering=yes
tsa_name=yes
ess_cert_id_chain=no
ess_cert_id_alg=sha256
''')
    query=root/'request.tsq';response=root/'response.tsr'
    run(engine,'request',proof,query,openssl)
    run(openssl,'ts','-reply','-config',root/'tsa.cnf','-queryfile',query,'-out',response)
    def verify(p=proof,q=query,r=response,ca=root/'ca.pem',ok=True):
        result=run(engine,'verify',p,q,r,ca,openssl,ok=ok)
        if ok:
            report=json.loads(result.stdout)
            assert report['timestamp_verified'] and report['trust_policy']=='explicit-ca-file'
            assert not any(report[k] for k in ['artifact_checked','identity_verified','creation_time_verified','revocation_checked','network_used'])
        return result
    verify()
    run(engine,'request',proof,query,openssl,ok=False)  # no overwrite
    other_query=root/'other.tsq';run(engine,'request',proof,other_query,openssl)
    verify(q=other_query,ok=False)  # nonce mismatch
    tampered=root/'tampered.wproof';value=json.loads(original);value['records'][1]['event']['inserted']+=1;tampered.write_text(json.dumps(value))
    verify(p=tampered,ok=False)
    wrong_ca=root/'wrong-ca.pem'
    run(openssl,'req','-x509','-newkey','rsa:2048','-nodes','-keyout',root/'wrong.key','-out',wrong_ca,'-days','2','-subj','/CN=Wrong test root')
    verify(ca=wrong_ca,ok=False)
    legacy=pathlib.Path('crates/proof/tests/fixtures/v2-demo.wproof').resolve()
    legacy_query=root/'legacy.tsq';legacy_response=root/'legacy.tsr'
    run(engine,'request',legacy,legacy_query,openssl)
    run(openssl,'ts','-reply','-config',root/'tsa.cnf','-queryfile',legacy_query,'-out',legacy_response)
    verify(p=legacy,q=legacy_query,r=legacy_response)
    verify(q=legacy_query,r=legacy_response,ok=False)  # matching nonce, wrong signed certificate
    selected=root/'selected.wproof'
    run(pathlib.Path(engine).with_name('workproof-engine'),'disclose',proof,selected,'5')
    verify(p=selected)  # same original signature, honest partial scope remains in .wproof
    corrupt=root/'corrupt.tsr';corrupt.write_bytes(response.read_bytes()[:-20]);verify(r=corrupt,ok=False)
    assert proof.read_bytes()==original, 'Timestamp exchange must not rewrite the signed proof'
print('PASS: real synthetic RFC3161 request/response, explicit CA trust, nonce/data binding, tamper/wrong-root/truncation rejection and no proof mutation; not a public TSA endorsement')
