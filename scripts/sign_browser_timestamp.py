"""CI-only synthetic authority for a request downloaded from the real browser UI."""
import os, pathlib, shutil, subprocess, sys, tempfile
assert os.environ.get('GITHUB_ACTIONS') == 'true'
query, response, ca = map(lambda p: pathlib.Path(p).resolve(), sys.argv[1:4])
openssl = shutil.which('openssl')
assert openssl
def run(*args):
    result = subprocess.run([openssl, *map(str, args)], capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors='replace')[:500]
with tempfile.TemporaryDirectory(prefix='workproof-browser-tsa-') as directory:
    root = pathlib.Path(directory)
    run('req','-x509','-newkey','rsa:2048','-nodes','-keyout',root/'ca.key','-out',ca,'-days','2','-subj','/CN=Browser synthetic CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
    run('req','-new','-newkey','rsa:2048','-nodes','-keyout',root/'tsa.key','-out',root/'tsa.csr','-subj','/CN=Browser synthetic TSA')
    (root/'ext.cnf').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    run('x509','-req','-in',root/'tsa.csr','-CA',ca,'-CAkey',root/'ca.key','-CAcreateserial','-out',root/'tsa.pem','-days','2','-extfile',root/'ext.cnf')
    (root/'serial').write_text('01\n')
    (root/'tsa.cnf').write_text(f'''[tsa]
default_tsa=config
[config]
serial={root}/serial
signer_cert={root}/tsa.pem
certs={ca}
signer_key={root}/tsa.key
signer_digest=sha256
default_policy=1.2.3.4.1
digests=sha256
accuracy=secs:1
ordering=yes
tsa_name=yes
ess_cert_id_chain=no
ess_cert_id_alg=sha256
''')
    run('ts','-reply','-config',root/'tsa.cnf','-queryfile',query,'-out',response)
    run('ts','-verify','-queryfile',query,'-in',response,'-CAfile',ca)
# Only public request, response and CA survive. Synthetic authority keys are destroyed.
