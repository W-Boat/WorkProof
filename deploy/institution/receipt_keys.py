"""Explicit Linux root tool for external receipt-key backup; no Docker or service activation."""
import argparse
import json
import os
import pathlib
import re
import stat
import sys
import tempfile
import backup_crypto as crypto
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def identity(issuer, seed, public):
    if not isinstance(issuer, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', issuer):
        raise ValueError('Invalid issuer')
    if not all(isinstance(v, str) and re.fullmatch(r'[0-9a-f]{64}', v) for v in (seed, public)):
        raise ValueError('Invalid key encoding')
    actual = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed)).public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
    if actual != public:
        raise ValueError('Mismatched key pair')
    return {'format': 'workproof-receipt-key-backup/1', 'issuer_id': issuer, 'seed': seed, 'public_key': public}


def require_root():
    if os.name != 'posix' or os.geteuid() != 0:
        raise ValueError('Linux root required')


def directory(path):
    parent, name = crypto._parent(path)
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    finally:
        os.close(parent)
    info = os.fstat(descriptor)
    if info.st_uid != 10001 or info.st_gid != 10001 or stat.S_IMODE(info.st_mode) != 0o700:
        os.close(descriptor)
        raise ValueError('Private key directory must be UID/GID 10001 and mode 0700')
    return descriptor


def read_key(descriptor, name, private):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 128:
            raise ValueError('Invalid key file')
        if private and (before.st_uid != 10001 or before.st_gid != 10001 or stat.S_IMODE(before.st_mode) != 0o600):
            raise ValueError('Invalid private key permissions')
        value = stream.read(129).decode('ascii').strip().lower()
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('Key file changed')
        return value


def backup(key_directory, output, issuer, password):
    require_root()
    fd = directory(key_directory)
    try:
        value = identity(issuer, read_key(fd, 'seed.hex', True), read_key(fd, 'public.hex', False))
    finally:
        os.close(fd)
    with tempfile.TemporaryDirectory(prefix='workproof-key-backup-') as temporary:
        source = pathlib.Path(temporary)/'payload.json'
        descriptor = os.open(source, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream)
        crypto.encrypt_file(source, output, password, 4096)


def restore(source, target, issuer, expected_public, password):
    require_root()
    # Authenticate and validate completely before creating the destination.
    with tempfile.TemporaryDirectory(prefix='workproof-key-restore-') as temporary:
        payload = pathlib.Path(temporary)/'payload.json'
        crypto.decrypt_file(source, payload, password, 4096)
        value = json.loads(payload.read_text())
        if set(value) != {'format', 'issuer_id', 'seed', 'public_key'} or value['format'] != 'workproof-receipt-key-backup/1':
            raise ValueError('Unsupported key backup')
        validated = identity(value['issuer_id'], value['seed'], value['public_key'])
        if issuer != validated['issuer_id'] or expected_public != validated['public_key']:
            raise ValueError('Independent issuer/public key did not match')
        parent, name = crypto._parent(target, private=True)
        fd = None
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent)  # Existing paths always fail.
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            for filename, content in [('seed.hex', validated['seed']), ('public.hex', validated['public_key'])]:
                output = os.open(filename, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                with os.fdopen(output, 'w') as stream:
                    os.fchmod(stream.fileno(), 0o600)
                    stream.write(content)
                    stream.flush()
                    os.fchown(stream.fileno(), 10001, 10001)
                    os.fsync(stream.fileno())
            os.fchown(fd, 10001, 10001)
            os.fsync(fd)
            os.fsync(parent)
        finally:
            if fd is not None: os.close(fd)
            os.close(parent)
    # I/O failure retains a partial NEW directory; never deletes or overwrites it.


def main():
    parser = argparse.ArgumentParser(description='Explicit encrypted external receipt-key backup/restore; never activates signing')
    parser.add_argument('operation', choices=['backup', 'restore'])
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--issuer', required=True)
    parser.add_argument('--expected-public-key')
    args = parser.parse_args()
    if args.operation == 'restore' and not args.expected_public_key:
        raise ValueError('Restore requires independent public key')
    password = crypto._stdin_password()
    if args.operation == 'backup': backup(args.input, args.output, args.issuer, password)
    else: restore(args.input, args.output, args.issuer, args.expected_public_key, password)
    print('Completed; signing was not activated.')


if __name__ == '__main__':
    try: main()
    except Exception:
        print('WorkProof: key operation failed; inspect any new output before retrying. Existing files were not replaced.', file=sys.stderr)
        sys.exit(1)
