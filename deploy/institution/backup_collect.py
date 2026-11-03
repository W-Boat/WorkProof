"""Internal read-only volume collector; invoked only by backup_coordinator.py."""
import datetime
import fcntl
import json
import os
import pathlib
import sys

import backup_crypto
import snapshot_archive as archive

PHASE='preflight'


def inventory(root):
    entries, identities = [], {}
    total = 0
    def walk(fd, prefix, device):
        nonlocal total
        for name in sorted(os.listdir(fd)):
            path = prefix + name
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            kind = archive._check(path, info, device)
            identities[path] = archive._identity(info)
            entries.append({'path': path, 'type': kind, 'uid': info.st_uid,
                            'gid': info.st_gid, 'mode': info.st_mode & 0o777,
                            'size': info.st_size if kind == 'file' else 0})
            if len(entries) > archive.MAX_FILES:
                raise RuntimeError('Too many source files')
            if kind == 'directory':
                child = archive._open_relative(root, path, directory=True)
                try:
                    walk(child, path + '/', device)
                finally:
                    os.close(child)
            else:
                total += info.st_size
                if total > archive.MAX_TOTAL_BYTES:
                    raise RuntimeError('Source exceeds byte limit')
    # Each named volume is a separate mount and may have a different device.
    for role in sorted(archive.ROOTS):
        fd = archive._open_relative(root, role, directory=True)
        try:
            info = os.fstat(fd)
            archive._check(role, info, info.st_dev)
            identities[role] = archive._identity(info)
            entries.append({'path': role, 'type': 'directory', 'uid': info.st_uid,
                            'gid': info.st_gid, 'mode': info.st_mode & 0o777, 'size': 0})
            walk(fd, role + '/', info.st_dev)
        finally:
            os.close(fd)
    if not (archive.REQUIRED - {'database.sql'}) <= set(identities):
        raise RuntimeError('Incomplete source volumes')
    return entries, identities


def collect(source, stage):
    """Copy only archive-approved objects, retaining required role permissions."""
    root = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        entries, identities = inventory(root)
        for entry in entries:
            path = entry['path']
            if path == 'database.sql':
                continue
            target = pathlib.Path(stage) / path
            if entry['type'] == 'directory':
                target.mkdir(mode=0o700)
            else:
                fd = archive._open_relative(root, path)
                try:
                    with os.fdopen(fd, 'rb') as src, target.open('xb') as dst:
                        os.fchmod(dst.fileno(), 0o600)
                        remaining = entry['size']
                        while remaining:
                            block = src.read(min(archive.CHUNK, remaining))
                            if not block:
                                raise RuntimeError('Source changed')
                            dst.write(block)
                            remaining -= len(block)
                        if src.read(1) or archive._identity(os.fstat(src.fileno())) != identities[path]:
                            raise RuntimeError('Source changed')
                        dst.flush()
                        os.fsync(dst.fileno())
                except BaseException:
                    raise
            os.chown(target, entry['uid'], entry['gid'])
            os.chmod(target, entry['mode'])
        _, after = inventory(root)
        if after != identities:
            raise RuntimeError('Source inventory changed')
        config = json.loads((pathlib.Path(stage) / 'app_config/application.json').read_text())
        secret = (pathlib.Path(stage) / 'mysql_app_secret/password').read_text()
        if config.get('databasePassword') != secret:
            raise RuntimeError('Application and database secret disagree')
    finally:
        os.close(root)


def main():
    global PHASE
    operation, commit, image = sys.argv[1:]
    password = backup_crypto._stdin_password()
    lock = os.open('/source/app_config/.setup.lock', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        PHASE='inventory'
        collect('/source', '/stage')
        PHASE='encrypt'
        archive.create_encrypted_snapshot('/stage', '/output/candidate', password,
            source_commit=commit, image_id=image,
            backup_time=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
        PHASE='verify'
        archive.verify_encrypted_snapshot('/output/candidate', password, work_dir='/output')
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('COLLECTOR_STAGE='+PHASE,file=sys.stderr)
        print('Backup collection failed; application must remain stopped.', file=sys.stderr)
        sys.exit(1)
