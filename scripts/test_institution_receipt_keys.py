"""Real encryption/restore boundary checks inside the exact image, no service or database."""
import os
import pathlib
import secrets
import stat
import sys
import tempfile
import subprocess
import json
import hashlib
from unittest import mock
sys.path.insert(0, '/opt/workproof')
import receipt_keys as keys
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.geteuid() == 0
with tempfile.TemporaryDirectory(prefix='workproof-key-acceptance-') as temporary:
    root = pathlib.Path(temporary)
    os.chmod(root, 0o700)
    original = root/'original'
    original.mkdir(mode=0o700)
    signing = Ed25519PrivateKey.generate()
    seed = signing.private_bytes(s.Encoding.Raw, s.PrivateFormat.Raw, s.NoEncryption()).hex()
    public = signing.public_key().public_bytes(s.Encoding.Raw, s.PublicFormat.Raw).hex()
    for name, value in [('seed.hex', seed), ('public.hex', public)]:
        p = original/name
        p.write_text(value)
        os.chmod(p, 0o600)
        os.chown(p, 10001, 10001)
    os.chown(original, 10001, 10001)
    password = secrets.token_hex(24).encode()
    encrypted = root/'keys.enc'
    keys.backup(original, encrypted, 'ci-keys', password)
    assert seed.encode() not in encrypted.read_bytes()
    def reject(call):
        try: call()
        except Exception: return
        raise AssertionError('Unsafe key operation was accepted')
    created = root/'explicit-created'
    generated = subprocess.run([sys.executable, '/opt/workproof/receipt_keys.py', 'create', '--output', str(created), '--issuer', 'ci-create'],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15)
    assert generated.returncode == 0, 'Explicit creation unexpectedly needs a password or failed'
    notice = json.loads(generated.stdout)
    assert set(notice) == {'issuer_id', 'public_key', 'signing_activated'}
    assert notice['issuer_id'] == 'ci-create' and notice['signing_activated'] is False
    created_seed = (created/'seed.hex').read_text()
    assert created_seed not in generated.stdout + generated.stderr
    assert notice['public_key'] == (created/'public.hex').read_text()
    keys.identity('ci-create', created_seed, notice['public_key'])
    for p in (created, created/'seed.hex', created/'public.hex'):
        assert p.stat().st_uid == p.stat().st_gid == 10001
        assert stat.S_IMODE(p.stat().st_mode) == (0o700 if p.is_dir() else 0o600)
    reject(lambda: keys.create(created, 'ci-create'))
    assert (created/'seed.hex').read_text() == created_seed
    reject(lambda: keys.create(root/'invalid-issuer', 'contains spaces'))
    assert not (root/'invalid-issuer').exists()
    bound = root/'bound.enc'
    snapshot_digest = 'ab' * 32  # Synthetic independently retained snapshot identifier.
    keys.backup(original, bound, 'ci-keys', password, snapshot_digest)
    for supplied in (None, 'cd' * 32, 'not-a-digest'):
        target = root/'wrong-deployment'
        reject(lambda: keys.restore(bound, target, 'ci-keys', public, password, supplied))
        assert not target.exists()
    reject(lambda: keys.restore(encrypted, root/'unbound-as-bound', 'ci-keys', public, password, snapshot_digest))
    assert not (root/'unbound-as-bound').exists()
    keys.restore(bound, root/'bound-restored', 'ci-keys', public, password, snapshot_digest)
    assert (root/'bound-restored/seed.hex').read_text() == seed
    chosen = root/'chosen-deployment.enc'
    chosen.write_bytes(b'Explicit synthetic backup bytes for association only.')
    assert keys.deployment_digest(chosen) == hashlib.sha256(chosen.read_bytes()).hexdigest()
    empty = root/'empty-deployment.enc';empty.write_bytes(b'')
    reject(lambda: keys.deployment_digest(empty))
    chosen_link = root/'chosen-link';chosen_link.symlink_to(chosen)
    reject(lambda: keys.deployment_digest(chosen_link))
    file_bound = root/'file-bound.enc'
    command = [sys.executable, '/opt/workproof/receipt_keys.py', 'backup', '--input', str(original), '--output', str(file_bound),
        '--issuer', 'ci-keys', '--deployment-backup', str(chosen)]
    selected = subprocess.run(command, input=password+b'\n', capture_output=True, timeout=30)
    assert selected.returncode == 0
    # A backup must never silently ignore an explicitly supplied independent key.
    checked_backup = root/'identity-checked.enc'
    checked = subprocess.run([sys.executable, '/opt/workproof/receipt_keys.py', 'backup', '--input', str(original),
        '--output', str(checked_backup), '--issuer', 'ci-keys', '--expected-public-key', public,
        '--deployment-backup', str(chosen)], input=password+b'\n', capture_output=True, timeout=30)
    assert checked.returncode == 0 and seed.encode() not in checked.stdout+checked.stderr
    keys.restore(checked_backup, root/'identity-checked-restored', 'ci-keys', public, password, keys.deployment_digest(chosen))
    assert (root/'identity-checked-restored/seed.hex').read_text() == seed
    for wrong_public in ('00'*32, 'malformed', 'AB'*32):
        output = root/'must-not-publish-wrong-identity.enc'
        refused = subprocess.run([sys.executable, '/opt/workproof/receipt_keys.py', 'backup', '--input', str(original),
            '--output', str(output), '--issuer', 'ci-keys', '--expected-public-key', wrong_public],
            input=password+b'\n', capture_output=True, timeout=15)
        assert refused.returncode != 0 and not output.exists()
        assert seed.encode() not in refused.stdout+refused.stderr
    assert (original/'seed.hex').read_text() == seed
    mismatched = subprocess.run([sys.executable, '/opt/workproof/receipt_keys.py', 'restore', '--input', str(file_bound),
        '--output', str(root/'file-mismatch'), '--issuer', 'ci-keys', '--expected-public-key', public,
        '--deployment-backup', str(chosen), '--deployment-sha256', '00'*32], input=password+b'\n', capture_output=True, timeout=15)
    assert mismatched.returncode != 0 and not (root/'file-mismatch').exists()
    restored_file = subprocess.run([sys.executable, '/opt/workproof/receipt_keys.py', 'restore', '--input', str(file_bound),
        '--output', str(root/'file-restored'), '--issuer', 'ci-keys', '--expected-public-key', public,
        '--deployment-backup', str(chosen)], input=password+b'\n', capture_output=True, timeout=30)
    assert restored_file.returncode == 0 and (root/'file-restored/seed.hex').read_text() == seed
    reject(lambda: keys.backup(original, encrypted, 'ci-keys', password))
    for issuer, expected, phrase in [('wrong', public, password), ('ci-keys', '00'*32, password), ('ci-keys', public, b'wrong-password-at-least-16')]:
        target = root/'rejected'
        reject(lambda: keys.restore(encrypted, target, issuer, expected, phrase))
        assert not target.exists()
    restored = root/'restored'
    keys.restore(encrypted, restored, 'ci-keys', public, password)
    reject(lambda: keys.restore(encrypted, restored, 'ci-keys', public, password))
    assert stat.S_IMODE(restored.stat().st_mode) == 0o700 and restored.stat().st_uid == 10001
    for name in ['seed.hex', 'public.hex']:
        assert (restored/name).read_bytes() == (original/name).read_bytes()
        assert (restored/name).stat().st_uid == 10001 and stat.S_IMODE((restored/name).stat().st_mode) == 0o600
    # Exercise actual signing after restore, rather than inferring usability from
    # matching bytes. The same independently retained public key checks both.
    proof = pathlib.Path('/fixture.wproof').read_bytes()
    receipts = []
    for directory in (original, restored):
        issued = subprocess.run(['/opt/workproof/workproof-receipt', 'issue-stdin', 'ci-keys', '60',
            str(directory/'seed.hex'), str(directory/'public.hex')], input=proof, capture_output=True, timeout=15)
        assert issued.returncode == 0, 'Real signing failed with original or restored key'
        assert seed.encode() not in issued.stdout + issued.stderr
        receipt_file = root/('receipt-'+directory.name+'.json')
        receipt_file.write_bytes(issued.stdout)
        checked = subprocess.run(['/opt/workproof/workproof-receipt', 'verify', '/fixture.wproof',
            str(receipt_file), 'ci-keys', '60', str(original/'public.hex')], capture_output=True, timeout=15)
        assert checked.returncode == 0, 'Restored signing identity did not verify with retained public key'
        report = json.loads(checked.stdout)
        assert report['receipt_verified'] is True and report['client_origin_verified'] is False
        receipts.append(json.loads(issued.stdout)['payload']['receipt_id'])
    assert receipts[0] != receipts[1]
    tampered = root/'tampered.enc'
    content = bytearray(encrypted.read_bytes());content[-1] ^= 1;tampered.write_bytes(content)
    reject(lambda: keys.restore(tampered, root/'tampered-output', 'ci-keys', public, password))
    assert not (root/'tampered-output').exists()
    linked = root/'linked'
    linked.symlink_to(original, target_is_directory=True)
    reject(lambda: keys.backup(linked, root/'linked.enc', 'ci-keys', password))
    assert not (root/'linked.enc').exists()
    # Fail after writing the first private file but before creating its public
    # partner. Retain the partial root-owned directory, so it cannot be used by
    # the service or silently overwritten on a retry.
    partial = root/'partial'
    real_open = os.open
    def interrupt_public(path, flags, *args, **kwargs):
        if path == 'public.hex' and flags & os.O_CREAT:
            raise OSError('Synthetic disk failure before public key creation')
        return real_open(path, flags, *args, **kwargs)
    with mock.patch.object(keys.os, 'open', side_effect=interrupt_public):
        reject(lambda: keys.restore(encrypted, partial, 'ci-keys', public, password))
    assert partial.is_dir() and partial.stat().st_uid == 0
    assert stat.S_IMODE(partial.stat().st_mode) == 0o700
    assert (partial/'seed.hex').read_text() == seed
    assert not (partial/'public.hex').exists()
    before = (partial/'seed.hex').read_bytes()
    reject(lambda: keys.restore(encrypted, partial, 'ci-keys', public, password))
    assert (partial/'seed.hex').read_bytes() == before
    assert (original/'seed.hex').read_text() == seed
    os.chmod(original/'seed.hex', 0o644)
    reject(lambda: keys.backup(original, root/'unsafe.enc', 'ci-keys', password))
    assert not (root/'unsafe.enc').exists()
print('PASS: encrypted external keys, exact new-directory restore, real signing with restored key and retained public key, tamper/link/issuer/key/password refusal, no overwrite, private permissions; no service activation')
