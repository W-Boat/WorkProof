"""Isolated Actions probe of opt-in signing in the exact delivered server image.

The extra app shares only the disposable CI database/cache. Synthetic signing keys
use a private tmpfs or an explicit read-only external directory. Source-continuity
fixtures retain encrypted keys separately; no key is put in deployment volumes or
public artifacts.
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


def verify_receipt_server(compose, environment, token, root, project, external=False, port=18082, expected_image=None, deployment_sha256=None, provided_keys=None, expected_public=None, previous_receipt=None):
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert re.fullmatch(r'workproof-(?:server|restore)-ci-[0-9a-f]{12}', project)
    assert port in (18082, 18083)
    if expected_image is not None: assert re.fullmatch(r'sha256:[0-9a-f]{64}', expected_image)
    name = project + ('-receipt-bind-probe' if external else '-receipt-probe')
    ttl = '3600' if provided_keys is not None else ('600' if external else '60')
    if provided_keys is not None:
        assert external and pathlib.Path(provided_keys).is_absolute()
        assert re.fullmatch(r'[0-9a-f]{64}', expected_public or '')
    else:
        assert expected_public is None and previous_receipt is None
    external_keys = None
    restored_keys = None
    launch_compose, launch_environment = list(compose), dict(environment)
    origin = f'http://127.0.0.1:{port}'
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
        if expected_image is not None: assert value['Image'] == expected_image
        return value

    try:
        if external:
            if provided_keys is not None:
                key_root = pathlib.Path(provided_keys)
            else:
                external_keys = tempfile.TemporaryDirectory(prefix='workproof-ci-external-keys-')
                key_root = pathlib.Path(external_keys.name)
                # Node built-in crypto avoids downloading an extra key-generation package.
                generated = subprocess.run(['node', '-e', "const c=require('node:crypto'),k=c.generateKeyPairSync('ed25519'),j=k.privateKey.export({format:'jwk'});process.stdout.write(JSON.stringify({seed:Buffer.from(j.d,'base64url').toString('hex'),public:Buffer.from(j.x,'base64url').toString('hex')}))"], capture_output=True, text=True, check=True, timeout=15)
                material = json.loads(generated.stdout)
                seed_path = key_root/'seed.hex'
                descriptor = os.open(seed_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, 'w') as stream: stream.write(material['seed'])
                (key_root/'public.hex').write_text(material['public'])
                del material, generated
                subprocess.run(['sudo', 'chown', '10001:10001', str(seed_path), str(key_root)], check=True, capture_output=True, timeout=15)
                # Round-trip with the exact image's backup module before the HTTP
                # app starts. Only synthetic test key bytes cross captured stdout;
                # they are never logged, placed in argv or saved as artifacts.
                recovery = '''import json,pathlib,sys,tempfile
import receipt_keys as k
v=json.loads(sys.stdin.read())
with tempfile.TemporaryDirectory(prefix='ci-key-recovery-') as d:
 p=pathlib.Path(d)
 k.backup('/source',p/'keys.enc','ci-image-http',v['password'].encode(),v.get('deployment_sha256'))
 k.restore(p/'keys.enc',p/'restored','ci-image-http',v['public'],v['password'].encode(),v.get('deployment_sha256'))
 print(json.dumps({'seed':(p/'restored/seed.hex').read_text(),'public':(p/'restored/public.hex').read_text()}))
'''
                retained_public = (key_root/'public.hex')
                # The source directory belongs to the service UID, so read its public
                # key through the same root-only helper rather than relaxing access.
                public_probe = subprocess.run(['sudo', 'cat', str(retained_public)], capture_output=True, text=True, check=True, timeout=15)
                import secrets
                recovered = subprocess.run(['docker', 'run', '--rm', '--user', '0', '--network', 'none', '--read-only',
                    '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777', '--interactive', '--mount',
                    'type=bind,src='+str(key_root)+',dst=/source,readonly', '--entrypoint', 'python3',
                    expected_image or 'workproof-institution:local', '-c', recovery],
                    input=json.dumps({'password':secrets.token_hex(24),'public':public_probe.stdout.strip(),'deployment_sha256':deployment_sha256}),
                    capture_output=True, text=True, timeout=60)
                assert recovered.returncode == 0, 'Image key backup/restore failed before HTTP activation'
                restored_material = json.loads(recovered.stdout)
                assert restored_material['public'] == public_probe.stdout.strip()
                restored_keys = tempfile.TemporaryDirectory(prefix='workproof-ci-restored-keys-')
                key_root = pathlib.Path(restored_keys.name)
                for filename, content in [('seed.hex',restored_material['seed']),('public.hex',restored_material['public'])]:
                    descriptor = os.open(key_root/filename, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                    with os.fdopen(descriptor, 'w') as stream: stream.write(content)
                del restored_material, recovered
                subprocess.run(['sudo', 'chown', '10001:10001', str(key_root/'seed.hex'), str(key_root/'public.hex'), str(key_root)], check=True, capture_output=True, timeout=15)
            launch_compose += ['-f', str(root/'deploy/institution/compose.receipts.yaml')]
            launch_environment.update(WORKPROOF_RECEIPT_KEY_DIRECTORY=str(key_root), WORKPROOF_RECEIPT_ISSUER_ID='ci-image-http', WORKPROOF_RECEIPT_LIFETIME_SECONDS=ttl)
            bootstrap = "import os;assert os.environ.get('GITHUB_ACTIONS')=='true';os.execv('/usr/bin/python3',['python3','/opt/workproof/entrypoint.py'])"
        started = subprocess.run([*launch_compose, 'run', '--detach', '--rm', '--no-deps', '--name', name,
            '--publish', f'127.0.0.1:{port}:8080', '--entrypoint', 'python3', '-e', 'GITHUB_ACTIONS=true',
            'app', '-c', bootstrap], env=launch_environment, capture_output=True, text=True, timeout=90)
        assert started.returncode == 0, 'Could not launch isolated signing probe'
        info = probe_info()
        assert info and info['HostConfig']['ReadonlyRootfs'] is True
        assert '/tmp' in info['HostConfig']['Tmpfs'] and info['Config']['User'] == '10001:10001'
        key_public = '/private/receipts/public.hex' if external else '/tmp/workproof-ci-receipt/public.hex'
        if external:
            mounts = [m for m in info['Mounts'] if m['Destination'] == '/private/receipts']
            assert len(mounts) == 1 and mounts[0]['Type'] == 'bind' and mounts[0]['RW'] is False
            assert pathlib.Path(mounts[0]['Source']).resolve() == key_root.resolve()
            readable = subprocess.run(['docker', 'exec', info['Id'], 'python3', '-c',
                "import os,pathlib,stat;assert os.getuid()==10001;p=pathlib.Path('/private/receipts');assert all(os.access(p/n,os.R_OK) for n in ('seed.hex','public.hex'));s=(p/'seed.hex').stat();assert s.st_uid==10001 and s.st_gid==10001 and stat.S_IMODE(s.st_mode)==0o600"],
                capture_output=True, timeout=15)
            assert readable.returncode == 0, 'Service identity cannot read the restored key pair with required private permissions'
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
            "import pathlib;print(pathlib.Path("+repr(key_public)+").read_text())"], capture_output=True, text=True, timeout=15)
        assert public.returncode == 0 and re.fullmatch(r'[0-9a-f]{64}\s*', public.stdout)
        if provided_keys is not None:
            assert public.stdout.strip() == expected_public, 'Explicit signing identity did not match independent source public key'
        with tempfile.TemporaryDirectory(prefix='workproof-image-http-') as directory:
            location = pathlib.Path(directory)
            (location/'proof.wproof').write_bytes(proof)
            (location/'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
            (location/'public.hex').write_text(public.stdout)
            verified = subprocess.run([str(root/'target/release/workproof-receipt'), 'verify', str(location/'proof.wproof'),
                str(location/'receipt.json'), 'ci-image-http', ttl, str(location/'public.hex')], capture_output=True, text=True, timeout=15)
            assert verified.returncode == 0, 'Image HTTP receipt failed independent host verification'
            report = json.loads(verified.stdout)
            assert report['receipt_verified'] is True and report['client_origin_verified'] is False
            if external and provided_keys is None and project.startswith('workproof-server-ci-'):
                from test_institution_receipt_permissions import verify_receipt_permissions
                limited=verify_receipt_permissions(origin,token,proof,project,root,location/'public.hex',ttl)
                (location/'ordinary-role-receipt.json').write_text(json.dumps(limited),encoding='utf-8')
                checked=subprocess.run([str(root/'target/release/workproof-receipt'),'verify',str(location/'proof.wproof'),
                    str(location/'ordinary-role-receipt.json'),'ci-image-http',ttl,str(location/'public.hex')],
                    capture_output=True,timeout=15)
                assert checked.returncode==0,'Ordinary-role receipt failed independent original-byte and trusted-key verification'
            if previous_receipt is not None:
                assert len(json.dumps(previous_receipt).encode()) <= 16 * 1024
                assert previous_receipt['payload']['receipt_id'] != receipt['payload']['receipt_id']
                (location/'source-receipt.json').write_text(json.dumps(previous_receipt), encoding='utf-8')
                checked = subprocess.run([str(root/'target/release/workproof-receipt'), 'verify', str(location/'proof.wproof'),
                    str(location/'source-receipt.json'), 'ci-image-http', ttl, str(location/'public.hex')],
                    capture_output=True, timeout=15)
                assert checked.returncode == 0, 'Pre-backup source receipt failed against restored signing identity'
            if external:
                # Exercise the existing Java permission boundary against the real
                # external file, without allowing the app to repair permissions.
                subprocess.run(['sudo', 'chmod', '644', str(key_root/'seed.hex')], check=True, capture_output=True, timeout=15)
                try:
                    state = json.loads(request('/api/workproof/receipts/capabilities')[1])['data']
                    assert state['configured'] is False, 'Insecure external private key was accepted'
                    assert request('/api/workproof/receipts', proof, consent=True)[0] != 200
                finally:
                    subprocess.run(['sudo', 'chmod', '600', str(key_root/'seed.hex')], check=True, capture_output=True, timeout=15)
                # A normal process restart must retain the externally supplied
                # identity rather than silently generating a replacement key.
                owned = probe_info()
                assert owned['Id'] == info['Id']
                restarted = subprocess.run(['docker', 'restart', '--time', '20', owned['Id']], capture_output=True, timeout=50)
                assert restarted.returncode == 0
                deadline = time.monotonic() + 120
                while True:
                    try:
                        if request('/api/health', authenticated=False)[0] == 200: break
                    except (urllib.error.URLError, TimeoutError, ConnectionError): pass
                    assert time.monotonic() < deadline, 'External-key app did not recover after restart'
                    time.sleep(1)
                assert probe_info()['Id'] == info['Id']
                assert json.loads(request('/api/workproof/receipts/capabilities')[1])['data']['configured'] is True
                second_status, second_body = request('/api/workproof/receipts', proof, consent=True)
                assert second_status == 200
                second = json.loads(second_body)['data']
                assert second['payload']['receipt_id'] != receipt['payload']['receipt_id']
                (location/'receipt-after-restart.json').write_text(json.dumps(second), encoding='utf-8')
                for filename in ('receipt.json', 'receipt-after-restart.json'):
                    checked = subprocess.run([str(root/'target/release/workproof-receipt'), 'verify', str(location/'proof.wproof'),
                        str(location/filename), 'ci-image-http', ttl, str(location/'public.hex')], capture_output=True, timeout=15)
                    assert checked.returncode == 0, 'External signing identity changed across restart'
        assert request('/api/workproof/receipts', b'{}', consent=True)[0] != 200
        changed = subprocess.run(['docker', 'exec', info['Id'], 'python3', '-c',
            "import pathlib;pathlib.Path("+repr(key_public)+").write_text('00'*32)"], capture_output=True, timeout=15)
        if external:
            assert changed.returncode != 0, 'Container modified read-only external key mount'
            if provided_keys is None:
                subprocess.run(['sudo', 'tee', str(key_root/'public.hex')], input=b'00'*32, capture_output=True, check=True, timeout=15)
        else:
            assert changed.returncode == 0
        if provided_keys is None:
            assert request('/api/workproof/receipts', proof, consent=True)[0] != 200, 'Image signed with a mismatched configured public key'
    finally:
        info = probe_info()
        if info:
            stopped = subprocess.run(['docker', 'stop', '--time', '20', info['Id']], capture_output=True, timeout=35)
            assert stopped.returncode == 0, 'Could not stop owned signing probe'
        for temporary_keys in (restored_keys, external_keys):
            if temporary_keys is None: continue
            # Return only this newly created CI directory to the runner account;
            # TemporaryDirectory removes it after the owned container is stopped.
            subprocess.run(['sudo', 'chown', str(os.getuid())+':'+str(os.getgid()), temporary_keys.name], check=True, capture_output=True, timeout=15)
            temporary_keys.cleanup()
    print('PASS: read-only nonroot image, opt-in HTTP signing, independent host verification, no-consent refusal; identity scope: '+
          ('explicit retained source key' if provided_keys is not None else 'isolated synthetic key with mismatch refusal'))
    return {'public_key':public.stdout.strip(), 'receipt':receipt}
