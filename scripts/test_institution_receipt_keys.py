"""Real encryption/restore boundary checks inside the exact image, no service or database."""
import os
import pathlib
import secrets
import stat
import sys
import tempfile
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
    os.chmod(original/'seed.hex', 0o644)
    reject(lambda: keys.backup(original, root/'unsafe.enc', 'ci-keys', password))
    assert not (root/'unsafe.enc').exists()
print('PASS: encrypted external keys, exact new-directory restore, independent issuer/key and bad-password refusal, no overwrite, private permissions; no signing activation')
