"""Authenticate and extract into a NEW private stage. No deployment or SQL restore.

Linux root only. The caller must independently trust the expected source/image
digests: the passphrase authenticates bytes, not their publisher. Staged SQL must
never be executed against an existing database. No Docker operations occur here.
"""
import argparse
import hashlib
import os
import pathlib
import stat
import sys
import tempfile

import backup_crypto as crypto
import snapshot_archive as archive


class RestoreSnapshotError(Exception):
    pass


def _copy_encrypted(source_path, target):
    parent, name = crypto._parent(source_path)
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        maximum = crypto.HARD_MAX_BYTES + crypto.HEADER.size + crypto.TAG_BYTES
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum:
            raise RestoreSnapshotError('Encrypted input type or size rejected')
        with target.open('xb') as output:
            os.fchmod(output.fileno(), 0o600)
            remaining = before.st_size
            while remaining:
                block = source.read(min(archive.CHUNK, remaining))
                if not block:
                    raise RestoreSnapshotError('Encrypted input changed')
                crypto._write(output, block)
                remaining -= len(block)
            if source.read(1) or archive._identity(os.fstat(source.fileno())) != archive._identity(before):
                raise RestoreSnapshotError('Encrypted input changed')
            output.flush()
            os.fsync(output.fileno())


def _parent_fd(root, path):
    parent = pathlib.PurePosixPath(path).parent.as_posix()
    return os.dup(root) if parent == '.' else archive._open_relative(root, parent, directory=True)


def _extract(source, root, manifest):
    expected = {item['path']: item for item in manifest['entries']}
    # Directories are created from validated manifest paths, independent of tar order.
    directories = sorted((item for item in manifest['entries'] if item['type'] == 'directory'),
                         key=lambda item: (item['path'].count('/'), item['path']))
    for item in directories:
        parent = _parent_fd(root, item['path'])
        try:
            os.mkdir(pathlib.PurePosixPath(item['path']).name, 0o700, dir_fd=parent)
        finally:
            os.close(parent)
    first = archive._header(source)
    if first is None or first.name != 'manifest.json':
        raise RestoreSnapshotError('Authenticated archive changed')
    current, _ = archive._manifest(archive._payload(source, first.size, capture=True),
                                  archive.MAX_TOTAL_BYTES, archive.MAX_FILES)
    if current != manifest:
        raise RestoreSnapshotError('Authenticated manifest changed')
    seen = set()
    while True:
        info = archive._header(source)
        if info is None:
            break
        if info.name not in expected or info.name in seen:
            raise RestoreSnapshotError('Unexpected extracted member')
        item = expected[info.name]
        if ((info.uid, info.gid, info.mode, info.size) !=
                (item['uid'], item['gid'], item['mode'], item['size']) or
                info.isdir() != (item['type'] == 'directory')):
            raise RestoreSnapshotError('Extracted metadata mismatch')
        seen.add(info.name)
        if info.isdir():
            continue
        parent = _parent_fd(root, info.name)
        try:
            fd = os.open(pathlib.PurePosixPath(info.name).name,
                         os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        finally:
            os.close(parent)
        digest = hashlib.sha256()
        with os.fdopen(fd, 'wb') as output:
            remaining = info.size
            while remaining:
                block = source.read(min(archive.CHUNK, remaining))
                if not block:
                    raise RestoreSnapshotError('Truncated extracted payload')
                digest.update(block)
                crypto._write(output, block)
                remaining -= len(block)
            padding = source.read((-info.size) % 512)
            if padding != bytes((-info.size) % 512) or digest.hexdigest() != item['sha256']:
                raise RestoreSnapshotError('Extracted payload mismatch')
            os.fchown(output.fileno(), item['uid'], item['gid'])
            os.fchmod(output.fileno(), item['mode'])
            output.flush()
            os.fsync(output.fileno())
    if seen != set(expected):
        raise RestoreSnapshotError('Incomplete extracted inventory')
    for item in reversed(directories):
        fd = archive._open_relative(root, item['path'], directory=True)
        try:
            os.fchown(fd, item['uid'], item['gid'])
            os.fchmod(fd, item['mode'])
            os.fsync(fd)
        finally:
            os.close(fd)
    os.fsync(root)


def _remove_children(root):
    """Only descend through pinned directories in our exclusively created stage."""
    for name in os.listdir(root):
        info = os.stat(name, dir_fd=root, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
            try:
                _remove_children(child)
            finally:
                os.close(child)
            os.rmdir(name, dir_fd=root)
        else:
            os.unlink(name, dir_fd=root)


def extract_authenticated_snapshot(input_path, stage_dir, password, *, expected_image_id, expected_source_commit):
    if not sys.platform.startswith('linux') or os.geteuid() != 0:
        raise RestoreSnapshotError('Linux root required')
    crypto._password(password)
    archive._metadata(expected_source_commit, expected_image_id, '2026-01-01T00:00:00Z')
    raw_stage = pathlib.Path(stage_dir)
    if '..' in raw_stage.parts:
        raise RestoreSnapshotError('Stage traversal rejected')
    parent, name = crypto._parent(raw_stage, private=True)
    root = None
    created = completed = False
    identity = None
    try:
        try:
            os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RestoreSnapshotError('Stage already exists; refusing overwrite')
        # Pin private work under the already checked root-owned parent. Host root
        # administrators remain trusted and must exclude concurrent operations.
        parent_path = pathlib.Path(os.path.abspath(raw_stage)).parent
        with tempfile.TemporaryDirectory(prefix='.workproof-restore-', dir=parent_path) as temporary:
            work = pathlib.Path(temporary)
            encrypted, authenticated = work / 'input.enc', work / 'authenticated.tar'
            _copy_encrypted(input_path, encrypted)
            manifest = archive.verify_encrypted_snapshot(encrypted, password, work_dir=work)
            if (manifest['source_commit'] != expected_source_commit or manifest['image_id'] != expected_image_id):
                raise RestoreSnapshotError('Expected source or image identity mismatch')
            crypto.decrypt_file(encrypted, authenticated, password,
                                max_bytes=archive._tar_limit(archive.MAX_TOTAL_BYTES, archive.MAX_FILES))
            # Authentication, full archive validation and identity comparison all
            # precede creation of the destination directory or any extracted file.
            os.mkdir(name, 0o700, dir_fd=parent)
            created = True
            root = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            identity = os.fstat(root)
            os.fchmod(root, 0o700)
            with authenticated.open('rb') as source:
                _extract(source, root, manifest)
        os.fsync(parent)
        completed = True
        return manifest
    except Exception:
        raise RestoreSnapshotError('Authenticated staging failed; no deployment restored') from None
    finally:
        try:
            if created and not completed and root is not None:
                _remove_children(root)
                current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino):
                    raise RestoreSnapshotError('Stage identity changed; private directory retained')
                os.rmdir(name, dir_fd=parent)
                os.fsync(parent)
        finally:
            if root is not None:
                os.close(root)
            os.close(parent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--stage', required=True)
    parser.add_argument('--expected-image', required=True)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--password-stdin', action='store_true')
    args = parser.parse_args()
    password = crypto._stdin_password() if args.password_stdin else crypto._password(
        __import__('getpass').getpass('Backup passphrase: ').encode('utf-8'))
    extract_authenticated_snapshot(args.input, args.stage, password,
        expected_image_id=args.expected_image, expected_source_commit=args.expected_commit)
    print('Authenticated files staged only. No deployment or database restored; no application started.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Authenticated staging failed. Inspect private staging before retrying; no deployment restored.', file=sys.stderr)
        sys.exit(1)
