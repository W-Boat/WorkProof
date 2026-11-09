"""Actions-only Compose resolution; no services or volumes are created."""
import json
import os
import pathlib
import subprocess

assert os.environ.get('GITHUB_ACTIONS') == 'true'
root = pathlib.Path(__file__).resolve().parents[1]
base = root/'deploy/institution/compose.yaml'
overlay = root/'deploy/institution/compose.receipts.yaml'
clean = {key: value for key, value in os.environ.items() if not key.startswith('WORKPROOF_RECEIPT_')}
command = ['docker', 'compose', '-f', str(base), '-f', str(overlay), 'config', '--format', 'json']
missing = subprocess.run(command, env=clean, capture_output=True, timeout=20)
assert missing.returncode != 0, 'Explicit signing configuration must not resolve without required values'
environment = dict(clean, WORKPROOF_RECEIPT_ISSUER_ID='ci-config', WORKPROOF_RECEIPT_KEY_DIRECTORY='/tmp/workproof-test-external-keys')
resolved = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=20)
assert resolved.returncode == 0, 'Could not resolve opt-in overlay'
app = json.loads(resolved.stdout)['services']['app']
assert app['read_only'] is True and app['user'] == '10001:10001'
assert app['environment']['WORKPROOF_RECEIPT_EXECUTABLE'] == '/opt/workproof/workproof-receipt'
assert app['environment']['WORKPROOF_RECEIPT_ISSUER_ID'] == 'ci-config'
assert app['environment']['WORKPROOF_RECEIPT_LIFETIME_SECONDS'] == '86400'
mounts = [m for m in app['volumes'] if m['target'] == '/private/receipts']
assert len(mounts) == 1
assert mounts[0]['read_only'] is True and mounts[0]['type'] == 'bind'
assert mounts[0]['source'] == '/tmp/workproof-test-external-keys'
assert mounts[0].get('bind', {}).get('create_host_path', False) is False
default = subprocess.run(['docker', 'compose', '-f', str(base), 'config', '--format', 'json'], env=clean, capture_output=True, text=True, timeout=20)
assert default.returncode == 0
app_default = json.loads(default.stdout)['services']['app']
assert not any(key.startswith('WORKPROOF_RECEIPT_') for key in app_default['environment'])
assert not any(m['target'] == '/private/receipts' for m in app_default['volumes'])
print('PASS: explicit receipt overlay, required configuration, read-only external keys, unchanged default deployment; no Docker mutations')
