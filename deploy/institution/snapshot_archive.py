"""Restricted, encrypted stopped-snapshot archives. No extraction or SQL execution.

The caller must stop all writers and stage a separate private snapshot first.
This module verifies file consistency, not database transactional completeness.
"""
import hashlib
import io
import json
import os
import pathlib
import re
import secrets
import stat
import tarfile

import backup_crypto

FORMAT = 'workproof-server-snapshot/1'
MAX_TOTAL_BYTES = 8 * 1024**3
MAX_FILES = 10000
MAX_MANIFEST_BYTES = 8 * 1024**2
MAX_PATH_BYTES = 160
CHUNK = 1024**2
ROOTS = {'app_config': (10001, 0o700), 'initial_account': (0, 0o700),
         'mysql_root_secret': (0, 0o755), 'mysql_app_secret': (0, 0o755), 'app_data': (10001, 0o700)}
FILES = {'database.sql': (0, 0o600), 'app_config/application.json': (10001, 0o600),
         'app_config/initialized.json': (10001, 0o600), 'app_config/.setup.lock': (0, 0o600),
         'initial_account/account.json': (0, 0o600), 'mysql_root_secret/password': (0, 0o444),
         'mysql_app_secret/password': (0, 0o444)}
REQUIRED = set(ROOTS) | (set(FILES) - {'app_config/.setup.lock'})
UUID_PROOF = re.compile(r'app_data/jobs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.proof')


class SnapshotArchiveError(Exception):
    pass


def _limits(total, count):
    if type(total) is not int or not 1 <= total <= MAX_TOTAL_BYTES or type(count) is not int or not 1 <= count <= MAX_FILES:
        raise SnapshotArchiveError('Unsupported snapshot limits')


def _rule(path):
    if not isinstance(path, str) or len(path.encode('utf-8')) > MAX_PATH_BYTES:
        raise SnapshotArchiveError('Invalid snapshot path')
    if path in ROOTS:
        uid, mode = ROOTS[path]
        return 'directory', uid, mode
    if path == 'app_data/jobs':
        return 'directory', 10001, 0o700
    if path in FILES:
        uid, mode = FILES[path]
        return 'file', uid, mode
    if path == 'app_data/jobs/.queue.lock' or UUID_PROOF.fullmatch(path):
        return 'file', 10001, 0o600
    raise SnapshotArchiveError('Unknown snapshot path')


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns,
            info.st_uid, info.st_gid, info.st_mode, info.st_nlink)


def _check(path, info, device):
    kind, uid, mode = _rule(path)
    correct_type = stat.S_ISDIR(info.st_mode) if kind == 'directory' else stat.S_ISREG(info.st_mode)
    if not correct_type or info.st_dev != device or info.st_uid != uid or info.st_gid != uid or stat.S_IMODE(info.st_mode) != mode:
        raise SnapshotArchiveError('Snapshot type, owner or permissions do not match its role')
    if kind == 'file' and info.st_nlink != 1:
        raise SnapshotArchiveError('Hard-linked snapshot files are not permitted')
    return kind


def _open_relative(root_fd, path, directory=False):
    fd = os.dup(root_fd)
    try:
        parts = path.split('/')
        for part in parts[:-1]:
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = following
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        if directory:
            flags |= os.O_DIRECTORY
        result = os.open(parts[-1], flags, dir_fd=fd)
        return result
    finally:
        os.close(fd)


def _scan(root_fd, maximum, count, hashes=True):
    device = os.fstat(root_fd).st_dev
    entries, identities = [], {}
    total = 0
    def walk(fd, prefix=''):
        nonlocal total
        for name in sorted(os.listdir(fd)):
            path = prefix + name
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            kind = _check(path, info, device)
            if len(entries) >= count:
                raise SnapshotArchiveError('Snapshot has too many entries')
            entry = {'path': path, 'type': kind, 'uid': info.st_uid, 'gid': info.st_gid,
                     'mode': stat.S_IMODE(info.st_mode), 'size': 0, 'sha256': None}
            entries.append(entry)
            identities[path] = _identity(info)
            if kind == 'directory':
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    if _identity(os.fstat(child)) != identities[path]:
                        raise SnapshotArchiveError('Snapshot directory changed')
                    walk(child, path + '/')
                finally:
                    os.close(child)
            else:
                if path == 'database.sql' and info.st_size == 0:
                    raise SnapshotArchiveError('SQL dump cannot be empty')
                total += info.st_size
                if total > maximum:
                    raise SnapshotArchiveError('Snapshot exceeds total byte limit')
                entry['size'] = info.st_size
                source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                try:
                    if _identity(os.fstat(source)) != identities[path]:
                        raise SnapshotArchiveError('Snapshot file changed')
                    if hashes:
                        digest = hashlib.sha256()
                        read_bytes = 0
                        while True:
                            block = os.read(source, CHUNK)
                            if not block:
                                break
                            read_bytes += len(block)
                            if read_bytes > info.st_size:
                                raise SnapshotArchiveError('Snapshot file grew')
                            digest.update(block)
                        if read_bytes != info.st_size or _identity(os.fstat(source)) != identities[path]:
                            raise SnapshotArchiveError('Snapshot file changed while reading')
                        entry['sha256'] = digest.hexdigest()
                finally:
                    os.close(source)
    walk(root_fd)
    if not REQUIRED <= set(identities):
        raise SnapshotArchiveError('Required snapshot files or directories are missing')
    return entries, identities


def _metadata(source_commit, image_id, backup_time):
    if not isinstance(source_commit, str) or not re.fullmatch('[0-9a-f]{40}', source_commit):
        raise SnapshotArchiveError('Source commit must be a full commit digest')
    if not isinstance(image_id, str) or not re.fullmatch('sha256:[0-9a-f]{64}', image_id):
        raise SnapshotArchiveError('Image ID must be a SHA256 digest')
    if not isinstance(backup_time, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', backup_time):
        raise SnapshotArchiveError('Backup time must be UTC')
    import datetime
    datetime.datetime.strptime(backup_time, '%Y-%m-%dT%H:%M:%SZ')


def _initialized(data):
    if len(data) > 16384:
        raise SnapshotArchiveError('Initialization record exceeds the limit')
    value = json.loads(data.decode('utf-8'), object_pairs_hook=_json_unique)
    if (type(value) is not dict or set(value) != {'initializedAt', 'schemaSha256'} or
            type(value['initializedAt']) is not int or value['initializedAt'] < 0 or
            not isinstance(value['schemaSha256'], str) or not re.fullmatch('[0-9a-f]{64}', value['schemaSha256'])):
        raise SnapshotArchiveError('Unrecognized initialization completion record')


class _PrivateTemp:
    def __init__(self, parent):
        self.parent_path = pathlib.Path(os.path.abspath(parent))
        self.parent_fd = self.fd = None
        self.name = None

    def __enter__(self):
        self.parent_fd, _ = backup_crypto._parent(self.parent_path / 'anchor', private=True)
        try:
            name = '.workproof-snapshot-' + secrets.token_hex(16)
            os.mkdir(name, mode=0o700, dir_fd=self.parent_fd)
            self.name = name
            self.fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.parent_fd)
            self.identity = os.fstat(self.fd)
            return self.parent_path / name
        except BaseException:
            if self.fd is not None:
                os.close(self.fd)
            if self.name is not None:
                os.rmdir(self.name, dir_fd=self.parent_fd)
            os.close(self.parent_fd)
            raise

    def __exit__(self, *unused):
        try:
            if self.fd is not None:
                # Only this module's two fixed temporary files can be created here.
                for name in ('snapshot.tar', 'authenticated.tar'):
                    try:
                        os.unlink(name, dir_fd=self.fd)
                    except FileNotFoundError:
                        pass
                os.close(self.fd)
                self.fd = None
            if self.name is not None:
                current = os.stat(self.name, dir_fd=self.parent_fd, follow_symlinks=False)
                if (current.st_dev, current.st_ino) != (self.identity.st_dev, self.identity.st_ino):
                    raise SnapshotArchiveError('Temporary directory identity changed; preserved for inspection')
                os.rmdir(self.name, dir_fd=self.parent_fd)
                os.fsync(self.parent_fd)
        finally:
            if self.parent_fd is not None:
                os.close(self.parent_fd)


def _tar_info(entry):
    info = tarfile.TarInfo(entry['path'])
    info.type = tarfile.DIRTYPE if entry['type'] == 'directory' else tarfile.REGTYPE
    info.uid, info.gid, info.mode, info.size = entry['uid'], entry['gid'], entry['mode'], entry['size']
    info.mtime = 0
    return info


def create_encrypted_snapshot(stage_dir, output_path, password, *, source_commit, image_id, backup_time,
                              max_total_bytes=MAX_TOTAL_BYTES, max_files=MAX_FILES):
    root = None
    try:
        _limits(max_total_bytes, max_files)
        _metadata(source_commit, image_id, backup_time)
        root, _ = backup_crypto._parent(pathlib.Path(stage_dir) / 'anchor', private=True)
        before_root = _identity(os.fstat(root))
        entries, identities = _scan(root, max_total_bytes, max_files)
        initialized_fd = _open_relative(root, 'app_config/initialized.json')
        with os.fdopen(initialized_fd, 'rb') as initialized:
            _initialized(initialized.read(16385))
        manifest = {'format': FORMAT, 'source_commit': source_commit, 'image_id': image_id,
                    'backup_time': backup_time, 'initialization': 'initialized', 'entries': entries}
        encoded = json.dumps(manifest, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()
        if len(encoded) > MAX_MANIFEST_BYTES:
            raise SnapshotArchiveError('Manifest exceeds the limit')
        with _PrivateTemp(pathlib.Path(output_path).absolute().parent) as temporary:
            archive = temporary / 'snapshot.tar'
            descriptor = os.open(archive, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'w+b') as output:
                os.fchmod(output.fileno(), 0o600)
                with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as package:
                    package.addfile(_tar_info({'path': 'manifest.json', 'type': 'file', 'uid': 0, 'gid': 0,
                                              'mode': 0o600, 'size': len(encoded)}), io.BytesIO(encoded))
                    for entry in entries:
                        if entry['type'] == 'directory':
                            package.addfile(_tar_info(entry))
                            continue
                        fd = _open_relative(root, entry['path'])
                        with os.fdopen(fd, 'rb') as source:
                            if _identity(os.fstat(source.fileno())) != identities[entry['path']]:
                                raise SnapshotArchiveError('Snapshot changed before archiving')
                            digest = hashlib.sha256()
                            class Reader:
                                def read(self, length):
                                    data = source.read(length)
                                    digest.update(data)
                                    return data
                            package.addfile(_tar_info(entry), Reader())
                            if digest.hexdigest() != entry['sha256'] or _identity(os.fstat(source.fileno())) != identities[entry['path']]:
                                raise SnapshotArchiveError('Snapshot changed during archiving')
                output.flush()
                os.fsync(output.fileno())
            _, after = _scan(root, max_total_bytes, max_files, hashes=False)
            if after != identities or _identity(os.fstat(root)) != before_root:
                raise SnapshotArchiveError('Snapshot inventory changed during archiving')
            backup_crypto.encrypt_file(archive, output_path, password, max_bytes=_tar_limit(max_total_bytes, max_files))
        return manifest
    except SnapshotArchiveError:
        raise
    except Exception:
        raise SnapshotArchiveError('Snapshot creation failed; no backup completeness claim') from None
    finally:
        if root is not None:
            os.close(root)


def _tar_limit(total, count):
    return min(backup_crypto.HARD_MAX_BYTES, total + (count + 2) * 2048 + MAX_MANIFEST_BYTES + 10240)


def _json_unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SnapshotArchiveError('Duplicate manifest field')
        result[key] = value
    return result


def _manifest(data, maximum, count):
    manifest = json.loads(data.decode('utf-8'), object_pairs_hook=_json_unique)
    if type(manifest) is not dict or set(manifest) != {'format', 'source_commit', 'image_id', 'backup_time', 'initialization', 'entries'}:
        raise SnapshotArchiveError('Unknown manifest fields')
    if manifest['format'] != FORMAT or manifest['initialization'] != 'initialized':
        raise SnapshotArchiveError('Unsupported snapshot manifest')
    _metadata(manifest['source_commit'], manifest['image_id'], manifest['backup_time'])
    entries = manifest['entries']
    if type(entries) is not list or len(entries) > count:
        raise SnapshotArchiveError('Invalid manifest entry count')
    paths, total = {}, 0
    for entry in entries:
        if type(entry) is not dict or set(entry) != {'path', 'type', 'uid', 'gid', 'mode', 'size', 'sha256'}:
            raise SnapshotArchiveError('Unknown manifest entry fields')
        path = entry['path']
        kind, uid, mode = _rule(path)
        if path in paths or entry['type'] != kind or any(type(entry[key]) is not int for key in ('uid', 'gid', 'mode', 'size')):
            raise SnapshotArchiveError('Duplicate path or invalid manifest value')
        if (entry['uid'], entry['gid'], entry['mode']) != (uid, uid, mode) or entry['size'] < 0:
            raise SnapshotArchiveError('Invalid manifest permissions or size')
        if kind == 'directory':
            if entry['size'] != 0 or entry['sha256'] is not None:
                raise SnapshotArchiveError('Invalid directory entry')
        else:
            if path == 'database.sql' and entry['size'] == 0:
                raise SnapshotArchiveError('SQL dump cannot be empty')
            if not isinstance(entry['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', entry['sha256']):
                raise SnapshotArchiveError('Invalid file digest')
            total += entry['size']
        paths[path] = entry
    if total > maximum or not REQUIRED <= set(paths):
        raise SnapshotArchiveError('Missing files or excessive snapshot size')
    for path in paths:
        parent = pathlib.PurePosixPath(path).parent.as_posix()
        if parent != '.' and (parent not in paths or paths[parent]['type'] != 'directory'):
            raise SnapshotArchiveError('Missing parent directory')
    return manifest, paths


def _header(source):
    raw = source.read(512)
    if len(raw) != 512:
        raise SnapshotArchiveError('Truncated tar header')
    if raw == bytes(512):
        if source.read(512) != bytes(512):
            raise SnapshotArchiveError('Invalid tar terminator')
        while True:
            tail = source.read(CHUNK)
            if not tail:
                return None
            if any(tail):
                raise SnapshotArchiveError('Nonzero data after tar terminator')
    # Read fixed USTAR blocks ourselves: tarfile's extension readers could allocate
    # attacker-selected PAX/GNU long-name payloads before a member-count check.
    if raw[257:263] != b'ustar\0' or raw[263:265] != b'00' or raw[156:157] not in (b'0', b'\0', b'5'):
        raise SnapshotArchiveError('Only fixed regular USTAR members are allowed')
    info = tarfile.TarInfo.frombuf(raw, 'utf-8', 'strict')
    if info.linkname or info.pax_headers or info.uname or info.gname or info.devmajor or info.devminor or info.mtime != 0:
        raise SnapshotArchiveError('Unsupported tar metadata')
    return info


def _payload(source, size, capture=False):
    digest, parts = hashlib.sha256(), []
    remaining = size
    while remaining:
        block = source.read(min(CHUNK, remaining))
        if not block:
            raise SnapshotArchiveError('Truncated tar payload')
        digest.update(block)
        if capture:
            parts.append(block)
        remaining -= len(block)
    padding = source.read((-size) % 512)
    if len(padding) != (-size) % 512 or any(padding):
        raise SnapshotArchiveError('Invalid tar padding')
    return b''.join(parts) if capture else digest.hexdigest()


def verify_encrypted_snapshot(encrypted_path, password, *, work_dir,
                              max_total_bytes=MAX_TOTAL_BYTES, max_files=MAX_FILES):
    try:
        _limits(max_total_bytes, max_files)
        with _PrivateTemp(work_dir) as temporary:
            archive = temporary / 'authenticated.tar'
            # Nothing reads a tar header until the complete encrypted envelope is authenticated.
            backup_crypto.decrypt_file(encrypted_path, archive, password, max_bytes=_tar_limit(max_total_bytes, max_files))
            fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as source:
                first = _header(source)
                if first is None or first.name != 'manifest.json' or not first.isreg() or (first.uid, first.gid, first.mode) != (0, 0, 0o600) or not 1 <= first.size <= MAX_MANIFEST_BYTES:
                    raise SnapshotArchiveError('A bounded private manifest must be the first member')
                manifest, expected = _manifest(_payload(source, first.size, capture=True), max_total_bytes, max_files)
                seen = set()
                while True:
                    info = _header(source)
                    if info is None:
                        break
                    if info.name not in expected or info.name in seen or len(seen) >= max_files:
                        raise SnapshotArchiveError('Duplicate or unknown tar member')
                    entry = expected[info.name]
                    if (info.uid, info.gid, info.mode, info.size) != (entry['uid'], entry['gid'], entry['mode'], entry['size']):
                        raise SnapshotArchiveError('Tar member does not match manifest metadata')
                    if info.isdir() != (entry['type'] == 'directory'):
                        raise SnapshotArchiveError('Tar member type mismatch')
                    if info.name == 'app_config/initialized.json':
                        if info.size > 16384:
                            raise SnapshotArchiveError('Initialization record exceeds the limit')
                        data = _payload(source, info.size, capture=True)
                        _initialized(data)
                        digest = hashlib.sha256(data).hexdigest()
                    else:
                        digest = _payload(source, info.size)
                    if entry['type'] == 'file' and digest != entry['sha256']:
                        raise SnapshotArchiveError('Tar member digest mismatch')
                    seen.add(info.name)
                if seen != set(expected):
                    raise SnapshotArchiveError('Tar file set does not match manifest')
                return manifest
    except SnapshotArchiveError:
        raise
    except Exception:
        raise SnapshotArchiveError('Encrypted snapshot verification failed; no files restored') from None
