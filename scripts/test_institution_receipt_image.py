"""Actions-only check of the exact image's receipt executable, without network or real keys."""
import json
import os
import pathlib
import stat
import subprocess
import tempfile
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.getuid() == 10001, 'Exercise the shipped nonroot identity'
tool = pathlib.Path('/opt/workproof/workproof-receipt')
assert tool.is_file() and os.access(tool, os.X_OK)
assert tool.stat().st_uid == 0 and stat.S_IMODE(tool.stat().st_mode) == 0o555
proof = pathlib.Path('/fixture.wproof').read_bytes()
assert 0 < len(proof) <= 32 * 1024 * 1024

with tempfile.TemporaryDirectory(prefix='workproof-receipt-image-') as directory:
    private = pathlib.Path(directory)
    signing = Ed25519PrivateKey.generate()
    seed = signing.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    public = signing.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    seed_file, public_file = private/'seed.hex', private/'public.hex'
    descriptor = os.open(seed_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(seed.hex())
    public_file.write_text(public.hex())
    before = sorted(p.name for p in private.iterdir())
    issued = subprocess.run([str(tool), 'issue-stdin', 'ci-image', '60', str(seed_file), str(public_file)], input=proof, capture_output=True, timeout=15, cwd=private)
    assert issued.returncode == 0, 'Packaged tool could not issue a receipt'
    assert len(issued.stdout) <= 16 * 1024
    assert seed.hex().encode() not in issued.stdout + issued.stderr, 'Private seed was disclosed'
    assert sorted(p.name for p in private.iterdir()) == before, 'Stdin mode created unexpected files'
    receipt = json.loads(issued.stdout)
    assert receipt['payload']['purpose'] == 'server-received'
    receipt_file = private/'receipt.json'
    receipt_file.write_bytes(issued.stdout)
    verified = subprocess.run([str(tool), 'verify', '/fixture.wproof', str(receipt_file), 'ci-image', '60', str(public_file)], capture_output=True, timeout=15, cwd=private)
    assert verified.returncode == 0, 'Packaged receipt could not be independently checked'
    result = json.loads(verified.stdout)
    assert result['receipt_verified'] is True
    for flag in ('artifact_checked', 'client_origin_verified', 'collection_verified', 'author_identity_verified', 'rule_calibration_verified'):
        assert result[flag] is False, 'Receipt must not upgrade unrelated trust claims'
    public_file.write_text('00' * 32)
    rejected = subprocess.run([str(tool), 'issue-stdin', 'ci-image', '60', str(seed_file), str(public_file)], input=proof, capture_output=True, timeout=15, cwd=private)
    assert rejected.returncode != 0 and not rejected.stdout, 'Wrong configured public key produced a receipt'
print('PASS: exact image receipt executable, nonroot identity, original-byte verification, no network, no inherited authenticity claims, mismatched-key refusal')
