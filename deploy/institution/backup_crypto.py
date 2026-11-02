"""Version 1 encrypted byte envelope; this module never parses archives or SQL.

Wire layout: HEADER, ciphertext (plaintext_length bytes), 16-byte GCM tag.
HEADER = >8sBBBBIII16s12sQ: magic, version, KDF, cipher, reserved, N, r, p,
salt, nonce, plaintext_length. The complete header is authenticated as AAD.
Only scrypt(2**17,8,1,32 bytes) and AES-256-GCM are accepted.

Decrypted bytes remain in a private temporary file until GCM finalization.
See https://cryptography.io/en/41.0.0/hazmat/primitives/symmetric-encryption/
This protects confidentiality/integrity, not sender identity or backup completeness.
Linux/POSIX only: private output directory and atomic exclusive hard-link publish.
"""
import argparse
import getpass
import os
import pathlib
import secrets
import stat
import struct
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b'WPBKENC1'
HEADER = struct.Struct('>8sBBBBIII16s12sQ')
TAG_BYTES = 16
DEFAULT_MAX_BYTES = 8 * 1024**3
HARD_MAX_BYTES = 16 * 1024**3
CHUNK_BYTES = 1024 * 1024


class BackupCryptoError(Exception):
    """Failure without secret or input-content details."""


def _password(value):
    if not isinstance(value, bytes) or not 16 <= len(value) <= 1024:
        raise BackupCryptoError('Passphrase must contain 16 to 1024 UTF-8 bytes')
    try:
        value.decode('utf-8', errors='strict')
    except UnicodeError:
        raise BackupCryptoError('Passphrase must be valid UTF-8') from None
    if any(char in value for char in (b'\r', b'\n', b'\0')):
        raise BackupCryptoError('Passphrase cannot contain line breaks or NUL')
    return value


def _limit(value):
    if type(value) is not int or not 1 <= value <= HARD_MAX_BYTES:
        raise BackupCryptoError('Byte limit must be between 1 and 16 GiB')
    return value


def _parent(path, private=False):
    # Pin each directory using no-follow openat, rather than checking then following
    # a replaceable parent pathname. A trusted parent administrator remains required.
    raw = pathlib.Path(path)
    if '..' in raw.parts:
        raise BackupCryptoError('Parent traversal is not permitted')
    absolute = pathlib.Path(os.path.abspath(raw))
    if not absolute.name:
        raise BackupCryptoError('A file path is required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in absolute.parent.parts[1:]:
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = following
        info = os.fstat(fd)
        if private and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise BackupCryptoError('Output directory must be owned by the current user with mode 0700')
        return fd, absolute.name
    except BaseException:
        os.close(fd)
        raise


def _key(password, salt):
    # Parameters are constants, never selected from an untrusted envelope.
    return Scrypt(salt=salt, length=32, n=2**17, r=8, p=1).derive(password)


def _write(output, data):
    view = memoryview(data)
    while view:
        written = output.write(view)
        if not written:
            raise BackupCryptoError('Output write failed')
        view = view[written:]


def _transform(input_path, output_path, password, max_bytes, decrypt):
    password = _password(password)
    maximum = _limit(max_bytes)
    source_parent = output_parent = source_fd = temporary_fd = None
    temporary = None
    temporary_owned = False
    try:
        if os.name != 'posix':
            raise BackupCryptoError('This envelope tool requires POSIX filesystem semantics')
        source_parent, source_name = _parent(input_path)
        source_fd = os.open(source_name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source_parent)
        original = os.fstat(source_fd)
        if not stat.S_ISREG(original.st_mode):
            raise BackupCryptoError('Input must be a regular file')
        output_parent, output_name = _parent(output_path, private=True)
        try:
            os.stat(output_name, dir_fd=output_parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise BackupCryptoError('Output already exists; refusing overwrite')
        with os.fdopen(source_fd, 'rb') as source:
            source_fd = None
            if decrypt:
                header = source.read(HEADER.size)
                if len(header) != HEADER.size:
                    raise BackupCryptoError('Invalid encrypted envelope')
                magic, version, kdf, cipher, reserved, n, r, p, salt, nonce, length = HEADER.unpack(header)
                if (magic, version, kdf, cipher, reserved, n, r, p) != (MAGIC, 1, 1, 1, 0, 2**17, 8, 1):
                    raise BackupCryptoError('Unsupported encrypted envelope parameters')
                if length > maximum or original.st_size != HEADER.size + length + TAG_BYTES:
                    raise BackupCryptoError('Encrypted envelope size is invalid or exceeds the limit')
                source.seek(HEADER.size + length)
                tag = source.read(TAG_BYTES)
                source.seek(HEADER.size)
                context = Cipher(algorithms.AES(_key(password, salt)), modes.GCM(nonce, tag)).decryptor()
            else:
                length = original.st_size
                if length > maximum:
                    raise BackupCryptoError('Input exceeds the byte limit')
                salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
                header = HEADER.pack(MAGIC, 1, 1, 1, 0, 2**17, 8, 1, salt, nonce, length)
                context = Cipher(algorithms.AES(_key(password, salt)), modes.GCM(nonce)).encryptor()
            context.authenticate_additional_data(header)
            temporary = '.workproof-crypto-' + secrets.token_hex(16) + '.partial'
            temporary_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                   0o600, dir_fd=output_parent)
            temporary_owned = True
            # Never unlink a colliding file if exclusive creation fails.
            with os.fdopen(temporary_fd, 'wb') as output:
                temporary_fd = None
                os.fchmod(output.fileno(), 0o600)
                if not decrypt:
                    _write(output, header)
                remaining = length
                while remaining:
                    chunk = source.read(min(CHUNK_BYTES, remaining))
                    if not chunk:
                        raise BackupCryptoError('Input changed or is truncated')
                    remaining -= len(chunk)
                    _write(output, context.update(chunk))
                # No plaintext publication, archive parsing or SQL precedes finalize.
                _write(output, context.finalize())
                if not decrypt:
                    _write(output, context.tag)
                    if source.read(1):
                        raise BackupCryptoError('Input changed during encryption')
                current = os.fstat(source.fileno())
                if (current.st_size, current.st_mtime_ns, current.st_ctime_ns) != (original.st_size, original.st_mtime_ns, original.st_ctime_ns):
                    raise BackupCryptoError('Input changed during processing')
                output.flush()
                os.fsync(output.fileno())
            # linkat creates the destination atomically and refuses an existing entry.
            # Unlike replace/rename it cannot clobber a path created after preflight.
            os.link(temporary, output_name, src_dir_fd=output_parent, dst_dir_fd=output_parent, follow_symlinks=False)
            os.unlink(temporary, dir_fd=output_parent)
            temporary = None
            os.fsync(output_parent)
    except BackupCryptoError:
        raise
    except Exception:
        raise BackupCryptoError('Encryption or authentication failed; output was not safely completed') from None
    finally:
        if source_fd is not None:
            os.close(source_fd)
        if temporary_fd is not None:
            os.close(temporary_fd)
        if temporary_owned and temporary is not None and output_parent is not None:
            # Only the private file successfully created by this invocation is removed.
            # A failure after publication can leave the authenticated final file; callers
            # must inspect that file rather than blindly retrying or overwriting it.
            try:
                os.unlink(temporary, dir_fd=output_parent)
            except FileNotFoundError:
                pass
        for fd in (source_parent, output_parent):
            if fd is not None:
                os.close(fd)


def encrypt_file(input_path, output_path, password, max_bytes=DEFAULT_MAX_BYTES):
    _transform(input_path, output_path, password, max_bytes, False)


def decrypt_file(input_path, output_path, password, max_bytes=DEFAULT_MAX_BYTES):
    _transform(input_path, output_path, password, max_bytes, True)


def _stdin_password():
    if sys.stdin.isatty():
        return _password(getpass.getpass('备份口令（16–1024 UTF-8 字节）：').encode('utf-8'))
    line = sys.stdin.buffer.readline(1027)
    if line.endswith(b'\n'):
        line = line[:-1]
        if line.endswith(b'\r'):
            line = line[:-1]
    return _password(line)


def main():
    parser = argparse.ArgumentParser(description='Encrypt/decrypt bytes; no archive extraction or SQL execution')
    parser.add_argument('operation', choices=('encrypt', 'decrypt'))
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--max-bytes', type=int, default=DEFAULT_MAX_BYTES)
    arguments = parser.parse_args()
    password = _stdin_password()
    (encrypt_file if arguments.operation == 'encrypt' else decrypt_file)(arguments.input, arguments.output, password, arguments.max_bytes)


if __name__ == '__main__':
    try:
        main()
    except BackupCryptoError as error:
        print('WorkProof: ' + str(error), file=sys.stderr)
        sys.exit(1)
