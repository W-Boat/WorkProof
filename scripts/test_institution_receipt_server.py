"""Isolated Actions probe of opt-in signing in the exact delivered server image.

The extra app shares only the disposable CI database/cache. Its synthetic signing
key lives in its own /tmp tmpfs, never in configuration/backup volumes or artifacts.
"""
import json
import os
import pathlib
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def verify_receipt_server(compose, environment, token, root, project):
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert re.fullmatch(r'workproof-server-ci-[0-9a-f]{12}', project)
    name = project + '-receipt-probe'
    origin = 'http://127.0.0.1:18082'
    bootstrap = '''import os,pathlib,stat
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.getuid()==10001
p=pathlib.Path('/tmp/workproof-ci-receipt');p.mkdir(mode=0o700)
k=Ed25519PrivateKey.generate()
fd=os.open(p/'seed.hex',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(k.private_bytes(s.Encoding.Raw,s.PrivateFormat.Raw,s.NoEncryption()).hex())
(p/'public.hex').write_text(k.public_key().public_bytes(s.Encoding.Raw,s.PublicFormat.Raw).hex())
os.environ.update(WORKPROOF_RECEIPT_EXECUTABLE='/opt/workproof/workproof-receipt',WORKPROOF_RECEIPT_PRIVATE_KEY=str(p/'seed.hex'),WORKPROOF_RECEIPT_PUBLIC_KEY=str(p/'public.hex'),WORKPROOF_RECEIPT_ISSUER_ID='ci-image-http',WORKPROOF_RECEIPT_LIFETIME_SECONDS='60')
os.execv('/usr/bin/python3',['python3','/opt/workproof/entrypoint.py'])
'''

    def request(path, data=None, authenticated=True, consent=False):
        headers = {'Content-Type': 'application/json'}
        if authenticated:
            headers['Authorization'] = 'Bearer ' + token
        if consent:
            headers['X-WorkProof-Receipt-Consent'] = 'true'
        try:
            response = urllib.request.urlopen(urllib.request.Request(origin+path, data=data, headers=headers), timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def probe_info():
        inspected = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True, timeout=15)
        if inspected.returncode:
            return None
        values = json.loads(inspected.stdout)
        assert len(values) == 1
        value = values[0]
        assert value['Name'] == '/' + name
        assert value['Config']['Labels'].get('com.docker.compose.project') == project
        assert value['Config']['Labels'].get('com.docker.compose.service') == 'app'
        assert str(value['Config']['Labels'].get('com.docker.compose.oneoff')).lower() == 'true'
        assert re.fullmatch(r'[0-9a-f]{64}', value['Id'])
        return value

    try:
        started = subprocess.run([*compose, 'run', '--detach', '--rm', '--no-deps', '--name', name,
            '--publish', '127.0.0.1:18082:8080', '--entrypoint', 'python3', '-e', 'GITHUB_ACTIONS=true',
            'app', '-c', bootstrap], env=environment, capture_output=True, text=True, timeout=90)
        assert started.returncode == 0, 'Could not launch isolated signing probe'
        info = probe_info()
        assert info and info['HostConfig']['ReadonlyRootfs'] is True
        assert '/tmp' in info['HostConfig']['Tmpfs'] and info['Config']['User'] == '10001:10001'
        deadline = time.monotonic() + 120
        while True:
            assert probe_info()['State']['Running'], 'Signing probe exited before readiness'
            try:
                if request('/api/health', authenticated=False)[0] == 200:
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            assert time.monotonic() < deadline, 'Signing probe did not become healthy'
            time.sleep(1)
        assert request('/api/workproof/receipts/capabilities', authenticated=False)[0] == 401
        capabilities = json.loads(request('/api/workproof/receipts/capabilities')[1])['data']
        assert capabilities['configured'] is True and capabilities['clientOriginVerified'] is False
        proof = (root/'apps/verifier/public/demo/essay.md.wproof').read_bytes()
        assert request('/api/workproof/receipts', proof)[0] == 400
        status, body = request('/api/workproof/receipts', proof, consent=True)
        assert status == 200, 'Image HTTP signing did not succeed'
        receipt = json.loads(body)['data']
        assert receipt['payload']['issuer_id'] == 'ci-image-http'
        public = subprocess.run(['docker', 'exec', info['Id'], 'python3', '-c',
            "import pathlib;print(pathlib.Path('/tmp/workproof-ci-receipt/public.hex').read_text())"], capture_output=True, text=True, timeout=15)
        assert public.returncode == 0 and re.fullmatch(r'[0-9a-f]{64}\s*', public.stdout)
        with tempfile.TemporaryDirectory(prefix='workproof-image-http-') as directory:
            location = pathlib.Path(directory)
            (location/'proof.wproof').write_bytes(proof)
            (location/'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
            (location/'public.hex').write_text(public.stdout)
            verified = subprocess.run([str(root/'target/release/workproof-receipt'), 'verify', str(location/'proof.wproof'),
                str(location/'receipt.json'), 'ci-image-http', '60', str(location/'public.hex')], capture_output=True, text=True, timeout=15)
            assert verified.returncode == 0, 'Image HTTP receipt failed independent host verification'
            report = json.loads(verified.stdout)
            assert report['receipt_verified'] is True and report['client_origin_verified'] is False
        assert request('/api/workproof/receipts', b'{}', consent=True)[0] != 200
        changed = subprocess.run(['docker', 'exec', info['Id'], 'python3', '-c',
            "import pathlib;pathlib.Path('/tmp/workproof-ci-receipt/public.hex').write_text('00'*32)"], capture_output=True, timeout=15)
        assert changed.returncode == 0
        assert request('/api/workproof/receipts', proof, consent=True)[0] != 200, 'Image signed with a mismatched configured public key'
    finally:
        info = probe_info()
        if info:
            stopped = subprocess.run(['docker', 'stop', '--time', '20', info['Id']], capture_output=True, timeout=35)
            assert stopped.returncode == 0, 'Could not stop owned signing probe'
    print('PASS: exact read-only nonroot image, opt-in HTTP signing, independent host verification, no-consent and key-mismatch refusal; test key existed only in isolated tmpfs')
