"""Restore authenticated backup into a brand NEW Compose project; never start app.

Root Linux Docker host only, with exclusive administrator maintenance. Retain the
private state directory and partial project on failure; never replay or delete it
automatically. SIGKILL/power loss require manual inspection before any restart.
"""
import argparse
import getpass
import hashlib
import json
import math
import os
import pathlib
import re
import secrets
import signal
import stat
import subprocess
import sys
import time

LABEL = 'org.workproof.restore-owner'
ROLES = ('app_config', 'initial_account', 'mysql_root_secret', 'mysql_app_secret',
         'app_data', 'mysql_data', 'cache_data')
PHASE = 'preflight'
PHASES = {'preflight', 'authenticate', 'create-owned-volumes', 'install-private-volumes',
          'start-new-database', 'import-new-database', 'verify-restored-database'}
CANCEL_SIGNALS = (signal.SIGTERM, signal.SIGINT)


class RestoreNewError(Exception):
    pass


def _set_cancel_handlers(handler):
    previous = {}
    for signum in CANCEL_SIGNALS:
        previous[signum] = signal.signal(signum, handler)
    return previous


def _restore_cancel_handlers(previous):
    for signum, handler in previous.items():
        signal.signal(signum, handler)


def _cancel(signum, frame):
    raise RestoreNewError('Cancelled')


def run(args, *, data=None, capture=False, timeout=300):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, check=True, timeout=timeout).stdout


def inspect(identity, kind='container'):
    return json.loads(run(['docker', kind, 'inspect', identity], capture=True))[0]


def _path_parent(path, private=False):
    raw = pathlib.Path(path)
    if '..' in raw.parts:
        raise RestoreNewError('Parent traversal rejected')
    absolute = pathlib.Path(os.path.abspath(raw))
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in absolute.parent.parts[1:]:
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = following
        info = os.fstat(fd)
        if private and (info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700):
            raise RestoreNewError('State parent must be root-owned 0700')
        return fd, absolute
    except BaseException:
        os.close(fd)
        raise


def _json_write(path, value):
    temporary = path.with_name('.' + path.name + '-' + secrets.token_hex(16))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(value, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def preflight(project):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,47}', project):
        raise RestoreNewError('Invalid new project name')
    for kind, command in [('container', ['docker', 'ps', '--all', '--quiet']),
                          ('volume', ['docker', 'volume', 'ls', '--quiet']),
                          ('network', ['docker', 'network', 'ls', '--quiet'])]:
        if run(command + ['--filter', 'label=com.docker.compose.project=' + project], capture=True).strip():
            raise RestoreNewError('Project already has resources')
    # Exact names are checked separately; unlabelled collisions are also refused.
    volumes = set(run(['docker', 'volume', 'ls', '--format', '{{.Name}}'], capture=True).decode().splitlines())
    if volumes.intersection(project + '_' + role for role in ROLES):
        raise RestoreNewError('Target volume name already exists')
    networks = set(run(['docker', 'network', 'ls', '--format', '{{.Name}}'], capture=True).decode().splitlines())
    if project + '_default' in networks:
        raise RestoreNewError('Target network name already exists')
    names = set(run(['docker', 'ps', '--all', '--format', '{{.Names}}'], capture=True).decode().splitlines())
    if names.intersection(project + separator + service + separator + '1'
                          for service in ('database', 'cache', 'app') for separator in ('-', '_')):
        raise RestoreNewError('Target container name already exists')


def owned_containers(project, token):
    identifiers = run(['docker', 'ps', '--all', '--no-trunc', '--quiet', '--filter',
                       'label=com.docker.compose.project=' + project], capture=True).decode().splitlines()
    result = []
    for identity in identifiers:
        value = inspect(identity)
        labels = value['Config'].get('Labels') or {}
        if value['Id'] != identity or labels.get(LABEL) != token:
            raise RestoreNewError('Project container ownership mismatch')
        result.append(value)
    return result


def helper(image, token, state, mounts, command, password=None, network='none'):
    """A helper is never started until its exact ID and owner token are pinned."""
    identity = None
    cidfile = state / ('helper-' + secrets.token_hex(16) + '.cid')
    try:
        args = ['docker', 'create', '-i', '--network', network, '--user', '0:0', '--read-only',
                '--label', LABEL + '=' + token, '--cidfile', str(cidfile), '--entrypoint', 'python3']
        for mount in mounts:
            args += ['--mount', mount]
        identity = run(args + [image] + command, capture=True).decode().strip()
        if not re.fullmatch('[0-9a-f]{64}', identity) or cidfile.read_text().strip() != identity:
            raise RestoreNewError('Invalid helper identity')
        value = inspect(identity)
        if value['Id'] != identity or value['Config']['Labels'].get(LABEL) != token:
            raise RestoreNewError('Unowned helper')
        run(['docker', 'start', '--attach', '--interactive', identity],
            data=password + b'\n' if password is not None else None)
        # docker start --attach can report CLI success independently of helper
        # semantics on some engines; explicitly require its completed exit code.
        value = inspect(identity)
        if value['State']['Running'] or value['State']['ExitCode'] != 0:
            raise RestoreNewError('Helper did not complete successfully')
    finally:
        previous = _set_cancel_handlers(signal.SIG_IGN)
        try:
            if identity and re.fullmatch('[0-9a-f]{64}', identity):
                value = inspect(identity)
                if value['Id'] != identity or value['Config']['Labels'].get(LABEL) != token:
                    raise RestoreNewError('Helper ownership changed; private state retained')
                run(['docker', 'rm', '--force', identity])
                cidfile.unlink(missing_ok=True)
        finally:
            _restore_cancel_handlers(previous)


def _read_private_bytes(path, maximum=16384):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
            raise RestoreNewError('Private record type or size rejected')
        value = source.read(maximum + 1)
    if len(value) > maximum:
        raise RestoreNewError('Private record too large')
    return value


def _read_private_json(path):
    return json.loads(_read_private_bytes(path), object_pairs_hook=_unique_json,
                      parse_constant=_nonfinite_json, parse_float=_finite_float)


def _unique_json(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise RestoreNewError('Duplicate private JSON key')
        value[key] = item
    return value


def _nonfinite_json(value):
    raise RestoreNewError('Nonfinite private JSON value')


def _finite_float(value):
    result = float(value)
    if not math.isfinite(result):
        raise RestoreNewError('Nonfinite private JSON value')
    return result


def coherence(stage):
    import catalog_receipt
    import jobs_receipt
    if (os.path.lexists(stage / 'app_config' / catalog_receipt.PENDING) or
            os.path.lexists(stage / 'app_config' / jobs_receipt.PENDING)):
        raise RestoreNewError('Catalog preparation incomplete')
    config = _read_private_json(stage / 'app_config/application.json')
    initialized = _read_private_json(stage / 'app_config/initialized.json')
    account = _read_private_json(stage / 'initial_account/account.json')
    secret = _read_private_bytes(stage / 'mysql_app_secret/password', 64)
    root_secret = _read_private_bytes(stage / 'mysql_root_secret/password', 64)
    if (set(config) != {'jwt', 'databasePassword'} or
            not isinstance(config['jwt'], str) or len(config['jwt']) < 32 or
            not isinstance(config['databasePassword'], str) or
            config['databasePassword'].encode() != secret or
            not re.fullmatch(b'[0-9a-f]{64}', secret) or not re.fullmatch(b'[0-9a-f]{64}', root_secret) or
            account.get('username') != 'admin' or not isinstance(account.get('password'), str) or
            len(account['password']) < 24):
        raise RestoreNewError('Source private records disagree')
    prepared = stage / 'app_config' / catalog_receipt.PREPARED
    if os.path.lexists(prepared):
        receipt = catalog_receipt.read(prepared)
        if receipt['schemaSha256'] != initialized['schemaSha256']:
            raise RestoreNewError('Catalog initialization identity differs')
    jobs_path = stage / 'app_config' / jobs_receipt.PREPARED
    if os.path.lexists(jobs_path):
        receipt = jobs_receipt.read(jobs_path)
        if (not os.path.lexists(prepared) or receipt['schemaSha256'] != initialized['schemaSha256'] or
                receipt['catalogReceiptSha256'] != hashlib.sha256(prepared.read_bytes()).hexdigest()):
            raise RestoreNewError('Jobs catalog dependency differs')
    return initialized['schemaSha256']


def install_volumes(stage, destination):
    """In-image only; every destination is an exclusively owned empty volume."""
    import backup_crypto as crypto
    import snapshot_archive as archive
    root = os.open(stage, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        entries, before = archive._scan(root, archive.MAX_TOTAL_BYTES, archive.MAX_FILES)
        for role in ROLES:
            target = pathlib.Path(destination) / role
            fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if os.listdir(fd):
                    raise RestoreNewError('Nonempty destination volume')
            finally:
                os.close(fd)
        for role in archive.ROOTS:
            target_root = os.open(pathlib.Path(destination) / role, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                for entry in entries:
                    if not entry['path'].startswith(role + '/'):
                        continue
                    relative = entry['path'][len(role) + 1:]
                    parent_path = pathlib.PurePosixPath(relative).parent.as_posix()
                    parent = os.dup(target_root) if parent_path == '.' else archive._open_relative(target_root, parent_path, directory=True)
                    try:
                        name = pathlib.PurePosixPath(relative).name
                        if entry['type'] == 'directory':
                            os.mkdir(name, 0o700, dir_fd=parent)
                            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                            os.fchown(fd, entry['uid'], entry['gid']); os.fchmod(fd, entry['mode']); os.close(fd)
                        else:
                            source = archive._open_relative(root, entry['path'])
                            output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
                            with os.fdopen(source, 'rb') as src, os.fdopen(output, 'wb') as dst:
                                remaining = entry['size']
                                digest = hashlib.sha256()
                                while remaining:
                                    block = src.read(min(archive.CHUNK, remaining))
                                    if not block:
                                        raise RestoreNewError('Source changed during installation')
                                    crypto._write(dst, block); digest.update(block); remaining -= len(block)
                                if (src.read(1) or archive._identity(os.fstat(src.fileno())) != before[entry['path']] or
                                        digest.hexdigest() != entry['sha256']):
                                    raise RestoreNewError('Source changed during installation')
                                os.fchown(dst.fileno(), entry['uid'], entry['gid']); os.fchmod(dst.fileno(), entry['mode'])
                                dst.flush(); os.fsync(dst.fileno())
                    finally:
                        os.close(parent)
                uid, mode = archive.ROOTS[role]
                os.fchown(target_root, uid, uid); os.fchmod(target_root, mode); os.fsync(target_root)
            finally:
                os.close(target_root)
        _, after = archive._scan(root, archive.MAX_TOTAL_BYTES, archive.MAX_FILES)
        if before != after:
            raise RestoreNewError('Source inventory changed during installation')
    finally:
        os.close(root)


def restore_new(input_path, project, state_dir, password, expected_image, expected_commit):
    global PHASE
    PHASE = 'preflight'
    if not sys.platform.startswith('linux') or os.geteuid() != 0:
        raise RestoreNewError('Linux root required')
    if (not isinstance(password, bytes) or not 16 <= len(password) <= 1024 or
            any(char in password for char in (b'\n', b'\r', b'\0')) or
            not re.fullmatch('sha256:[0-9a-f]{64}', expected_image) or not re.fullmatch('[0-9a-f]{40}', expected_commit)):
        raise RestoreNewError('Invalid passphrase or expected identity')
    password.decode('utf-8', errors='strict')
    preflight(project)
    image = inspect(expected_image, 'image')
    if image['Id'] != expected_image or image['Config']['Labels'].get('org.opencontainers.image.revision') != expected_commit:
        raise RestoreNewError('Installed image and expected source disagree')
    canonical = json.loads(run(['docker', 'compose', '--file', str(pathlib.Path(__file__).with_name('compose.yaml')),
                                '--project-name', project, 'config', '--format', 'json'], capture=True))
    services = {name: canonical['services'][name] for name in ('database', 'cache', 'app')}
    services['app']['image'] = expected_image
    runtime_images = {}
    for name, service in services.items():
        # Resolve only images already installed by the administrator. Persist
        # immutable IDs so a later startup cannot silently follow changed tags.
        identity = inspect(service['image'], 'image')['Id']
        if not re.fullmatch('sha256:[0-9a-f]{64}', identity):
            raise RestoreNewError('Invalid installed runtime image identity')
        runtime_images[name] = identity
        service['image'] = identity
        service['pull_policy'] = 'never'
    source_parent, source = _path_parent(input_path)
    try:
        info = os.stat(source.name, dir_fd=source_parent, follow_symlinks=False)
        if not stat.S_ISREG(info.st_mode):
            raise RestoreNewError('Input must be regular')
    finally:
        os.close(source_parent)
    parent, state = _path_parent(state_dir, private=True)
    try:
        os.mkdir(state.name, 0o700, dir_fd=parent)
        fd = os.open(state.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            os.fchmod(fd, 0o700)
        finally:
            os.close(fd)
    finally:
        os.close(parent)
    token = secrets.token_hex(32)
    record = {'format': 'workproof-new-restore/1', 'project': project, 'owner': token,
              'image_id': expected_image, 'source_commit': expected_commit, 'runtime_image_ids': runtime_images,
              'status': 'in-progress', 'phase': PHASE}
    marker = state / 'state.json'
    _json_write(marker, record)
    old_signals = _set_cancel_handlers(_cancel)
    try:
        PHASE = 'authenticate'
        helper(expected_image, token, state,
               [f'type=bind,src={source},dst=/input.enc,readonly', f'type=bind,src={state},dst=/restore'],
               ['/opt/workproof/restore_snapshot.py', '--input', '/input.enc', '--stage', '/restore/stage',
                '--expected-image', expected_image, '--expected-commit', expected_commit, '--password-stdin'], password)
        schema_hash = coherence(state / 'stage')
        schema_code = "import hashlib,pathlib;print(hashlib.sha256(pathlib.Path('/opt/workproof/sql/V1__init_schema.sql').read_text(encoding='utf-8-sig').encode()).hexdigest())"
        actual_schema = run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python3', expected_image, '-c', schema_code], capture=True).decode().strip()
        if schema_hash != actual_schema:
            raise RestoreNewError('Initialized schema identity differs from installed image')
        preflight(project)
        PHASE = 'create-owned-volumes'
        for role in ROLES:
            name = project + '_' + role
            run(['docker', 'volume', 'create', '--label', LABEL + '=' + token,
                 '--label', 'com.docker.compose.project=' + project,
                 '--label', 'com.docker.compose.volume=' + role, name])
            value = inspect(name, 'volume')
            if value['Name'] != name or value.get('Labels', {}).get(LABEL) != token:
                raise RestoreNewError('Volume ownership collision')
        PHASE = 'install-private-volumes'
        mounts = [f'type=bind,src={state / "stage"},dst=/stage,readonly',
                  f'type=bind,src={pathlib.Path(__file__).absolute()},dst=/opt/workproof/restore_new.py,readonly']
        mounts += [f'type=volume,src={project}_{role},dst=/target/{role}' for role in ROLES]
        helper(expected_image, token, state, mounts, ['/opt/workproof/restore_new.py', '_install'])
        for service in services.values():
            service['labels'] = {**(service.get('labels') or {}), LABEL: token}
            service.pop('profiles', None)
        document = {'name': project, 'services': services,
                    'volumes': {role: {'external': True, 'name': project + '_' + role} for role in ROLES},
                    'networks': {'default': {'name': project + '_default', 'labels': {LABEL: token}}}}
        composefile = state / 'compose.json'
        _json_write(composefile, document)
        compose = ['docker', 'compose', '--file', str(composefile), '--project-name', project]
        PHASE = 'start-new-database'
        owned_containers(project, token)
        for role in ROLES:
            if inspect(project + '_' + role, 'volume').get('Labels', {}).get(LABEL) != token:
                raise RestoreNewError('Volume ownership changed before database startup')
        run(compose + ['up', '--detach', '--no-deps', 'database'])
        values = owned_containers(project, token)
        databases = [value for value in values if value['Config']['Labels'].get('com.docker.compose.service') == 'database']
        if len(databases) != 1 or len(values) != 1:
            raise RestoreNewError('Unexpected new project containers')
        database = databases[0]['Id']
        if databases[0]['Image'] != runtime_images['database']:
            raise RestoreNewError('New database runtime image differs from pinned identity')
        deadline = time.monotonic() + 200
        while time.monotonic() < deadline:
            value = inspect(database)
            if value['State'].get('Health', {}).get('Status') == 'healthy':
                break
            time.sleep(1)
        else:
            raise RestoreNewError('New database not healthy')
        PHASE = 'import-new-database'
        root_access = 'export MYSQL_PWD="$(cat /private/mysql-root/password)"; '
        empty = run(['docker', 'exec', database, 'bash', '-ec', root_access +
            "mysql --user=root --batch --skip-column-names --execute=\"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='workproof'\""], capture=True).strip()
        if empty != b'0':
            raise RestoreNewError('New database is not empty')
        # SQL is read only from the authenticated private stage, never a user path.
        with (state / 'stage/database.sql').open('rb') as sql:
            subprocess.run(['docker', 'exec', '-i', database, 'bash', '-ec', root_access +
                            'exec mysql --user=root --default-character-set=utf8mb4 workproof'], stdin=sql,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=300)
        PHASE = 'verify-restored-database'
        check = "SELECT COUNT(*),COALESCE(SUM(ENGINE <> 'InnoDB'),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='workproof' AND TABLE_TYPE='BASE TABLE'"
        facts = run(['docker', 'exec', database, 'bash', '-ec', root_access +
                    'mysql --user=root --batch --skip-column-names --execute="' + check + '"'], capture=True).decode().strip()
        if not re.fullmatch(r'[1-9][0-9]*\t0', facts):
            raise RestoreNewError('Restored database inventory invalid')
        app_check = 'export MYSQL_PWD="$(cat /private/mysql-app/password)"; exec mysql --host=127.0.0.1 --user=workproof --database=workproof --batch --skip-column-names --execute="SELECT COUNT(*) FROM sys_user WHERE username=\'admin\' AND status=1"'
        if run(['docker', 'exec', database, 'bash', '-ec', app_check], capture=True).strip() != b'1':
            raise RestoreNewError('Restored application credential/admin check failed')
        if (state / 'stage/app_config/catalog.json').exists():
            network = inspect(project + '_default', 'network')
            if network.get('Labels', {}).get(LABEL) != token:
                raise RestoreNewError('Restored network ownership differs')
            verify_catalog = """import pathlib,hashlib,pymysql,catalog_receipt as r
from catalog_prepare import verify_schema
import json
p=pathlib.Path('/stage/app_config');v=r.read(p/r.PREPARED)
assert v['migrationSha256']==hashlib.sha256(pathlib.Path('/opt/workproof/sql/V3__workproof_certificate_catalog.sql').read_bytes()).hexdigest()
c=json.loads((p/'application.json').read_text());db=pymysql.connect(host='database',user='workproof',password=c['databasePassword'],database='workproof',charset='utf8mb4',connect_timeout=10,read_timeout=10,write_timeout=10)
try:
 with db.cursor() as cursor:
  verify_schema(cursor)
  import jobs_receipt as j
  if (p/j.PREPARED).exists():
   from jobs_prepare import verify_schema as verify_jobs,verify_spool,verify_spool_references
   v4=j.read(p/j.PREPARED)
   assert v4['catalogReceiptSha256']==hashlib.sha256((p/r.PREPARED).read_bytes()).hexdigest()
   assert v4['migrationSha256']==hashlib.sha256(pathlib.Path('/opt/workproof/sql/V4__workproof_certificate_jobs.sql').read_bytes()).hexdigest()
   verify_jobs(cursor);spool=pathlib.Path(j.SPOOL);verify_spool(spool);verify_spool_references(cursor,spool)
finally:db.close()
"""
            helper(expected_image, token, state,
                   [f'type=bind,src={state / "stage"},dst=/stage,readonly',
                    f'type=volume,src={project}_app_data,dst=/var/lib/workproof,readonly'], ['-c', verify_catalog],
                   network=network['Id'])
        if any(value['Config']['Labels'].get('com.docker.compose.service') != 'database' for value in owned_containers(project, token)):
            raise RestoreNewError('Unexpected application startup')
        run(['docker', 'stop', '--time', '60', database])
        if inspect(database)['State']['Running']:
            raise RestoreNewError('New database did not stop')
        record.update(status='ready-to-start', phase='verified-stopped')
        _json_write(marker, record)
        return record
    except BaseException:
        record.update(status='failed-retained', phase=PHASE)
        cleanup_signals = _set_cancel_handlers(signal.SIG_IGN)
        try:
            try:
                _json_write(marker, record)
            except Exception:
                pass
            for value in owned_containers(project, token):
                if value['State']['Running']:
                    run(['docker', 'stop', '--time', '60', value['Id']])
        except Exception:
            pass  # State/daemon uncertainty must never trigger data deletion.
        finally:
            _restore_cancel_handlers(cleanup_signals)
        raise RestoreNewError('New-project restore failed; private state and project retained') from None
    finally:
        _restore_cancel_handlers(old_signals)


def main():
    if sys.argv[1:] == ['_install']:
        install_volumes('/stage', '/target')
        return
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('input', 'project', 'state-dir', 'expected-image', 'expected-commit'):
        parser.add_argument('--' + option, required=True)
    parser.add_argument('--password-stdin', action='store_true')
    args = parser.parse_args()
    if args.password_stdin:
        line = sys.stdin.buffer.read(1026)
        if not line.endswith(b'\n'):
            raise RestoreNewError('One passphrase line required')
        password = line[:-1]
    else:
        password = getpass.getpass('Backup passphrase: ').encode()
    restore_new(args.input, args.project, args.state_dir, password, args.expected_image, args.expected_commit)
    print('Restored into new project and verified. Services are stopped; private compose.json is ready for explicit startup.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        phase = PHASE if PHASE in PHASES else 'unknown'
        print('RESTORE_PHASE=' + phase + '; failed; retain private state and inspect project before restarting.', file=sys.stderr)
        sys.exit(1)
