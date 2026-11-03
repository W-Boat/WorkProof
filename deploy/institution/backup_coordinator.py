"""Linux root host entry point. Requires Docker Compose and the labelled release image.

Application remains stopped on success and failure. No restore or automatic restart.
Privileged administrators must exclude all concurrent writers/Compose operations.
Only a verified encrypted candidate is published; private scratch is removed on exit.
"""
import argparse
import contextlib
import fcntl
import getpass
import json
import os
import pathlib
import re
import resource
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile


PHASE = 'preflight'


class CoordinatorError(Exception):
    pass


def run(args, **kwargs):
    if kwargs.pop('capture_output',False):
        kwargs['stdout']=subprocess.PIPE
    return subprocess.run(args, check=True, stderr=subprocess.DEVNULL, **kwargs)


def inspect(target):
    return json.loads(run(['docker', 'inspect', target], capture_output=True).stdout)[0]


def volume(container, destination):
    mounts = [m for m in container['Mounts'] if m['Destination'] == destination]
    if len(mounts) != 1 or mounts[0]['Type'] != 'volume':
        raise CoordinatorError('Expected dedicated named volumes')
    name = mounts[0]['Name']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name):
        raise CoordinatorError('Invalid volume identity')
    return name


def stopped(container):
    state = container['State']
    if state['Running'] or state['Restarting'] or state.get('Paused'):
        raise CoordinatorError('Application must remain stopped')
    return (container['Id'], container['Image'], container['RestartCount'],
            state['StartedAt'], state['FinishedAt'], container['Mounts'])


@contextlib.contextmanager
def owned_stage(parent):
    """Terminate our exact helper before deleting plaintext it could still access."""
    base = pathlib.Path(tempfile.mkdtemp(prefix='.workproof-backup-', dir=parent))
    token = secrets.token_hex(32)
    helper = {'id': None, 'token': token, 'started': False}
    try:
        yield base, helper
    finally:
        # Repeated TERM must not interrupt the ownership/termination sequence.
        previous = {kind:signal.signal(kind,signal.SIG_IGN) for kind in (signal.SIGTERM,signal.SIGINT)}
        safe = not helper['started']
        try:
            if helper['id'] is not None:
                identity = helper['id']
                found = run(['docker', 'ps', '--all', '--no-trunc', '--quiet', '--filter',
                             'id=' + identity], capture_output=True).stdout.decode().strip()
                if not found:
                    safe = True
                elif found == identity:
                    current = inspect(identity)
                    if current['Id'] != identity or current['Config']['Labels'].get('org.workproof.backup-owner') != token:
                        raise CoordinatorError('Helper ownership could not be verified')
                    run(['docker', 'rm', '--force', identity], stdout=subprocess.DEVNULL)
                    remaining = run(['docker', 'ps', '--all', '--no-trunc', '--quiet', '--filter',
                                     'id=' + identity], capture_output=True).stdout.strip()
                    safe = not remaining
            if safe:
                shutil.rmtree(base)
            else:
                raise CoordinatorError('Helper termination unconfirmed; private staging retained')
        except Exception:
            # Deliberately retain root-private scratch when daemon state is unknown.
            raise CoordinatorError('Helper cleanup failed; private staging retained') from None
        finally:
            for kind,handler in previous.items():signal.signal(kind,handler)


def backup(output, password):
    def terminate(signum, frame):
        raise CoordinatorError('Backup cancelled')
    previous = {kind:signal.signal(kind,terminate) for kind in (signal.SIGTERM,signal.SIGINT)}
    try:
        return _backup(output, password)
    finally:
        for kind,handler in previous.items():signal.signal(kind,handler)


def _backup(output, password):
    global PHASE
    PHASE = 'preflight'
    if not isinstance(password,bytes) or not 16 <= len(password) <= 1024 or any(x in password for x in (b'\n',b'\r',b'\0')):
        raise CoordinatorError('Invalid passphrase')
    if os.name != 'posix' or os.geteuid() != 0:
        raise CoordinatorError('Run on the Linux Docker host as root')
    output = pathlib.Path(output).absolute()
    # Reject symlinked parents as well as unsafe final directories.
    for parent in (output.parent, *output.parent.parents):
        if parent.is_symlink():
            raise CoordinatorError('Symlinked output parent')
    info = output.parent.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700 or output.exists() or output.is_symlink():
        raise CoordinatorError('Use a new output in a root-owned 0700 directory')
    compose = ['docker', 'compose', '--file', str(pathlib.Path(__file__).with_name('compose.yaml'))]
    def service(name):
        value = run(compose + ['ps', '--all', '--quiet', name], capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{12,64}', value):
            raise CoordinatorError('Expected exactly one existing service container')
        return inspect(value)
    PHASE = 'inspect-services'
    app, database = service('app'), service('database')
    project = app['Config']['Labels']['com.docker.compose.project']
    if not re.fullmatch('[a-z0-9][a-z0-9_-]*', project):
        raise CoordinatorError('Invalid project identity')
    if database['Config']['Labels']['com.docker.compose.project'] != project:
        raise CoordinatorError('Service project mismatch')
    image = app['Image']
    commit = inspect(image)['Config'].get('Labels', {}).get('org.opencontainers.image.revision', '')
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise CoordinatorError('Image needs its full source revision label')
    volumes = {role: volume(app, path) for role, path in
               [('app_config', '/private/config'), ('app_data', '/var/lib/workproof')]}
    volumes.update({role: volume(database, path) for role, path in
                    [('mysql_root_secret', '/private/mysql-root'), ('mysql_app_secret', '/private/mysql-app')]})
    # Account must belong to the same Compose project, never a guessed path.
    account_name = project + '_initial_account'
    account = inspect(account_name)
    labels = account.get('Labels') or {}
    if labels.get('com.docker.compose.project') != project or labels.get('com.docker.compose.volume') != 'initial_account':
        raise CoordinatorError('Initial account volume identity mismatch')
    volumes['initial_account'] = account['Name']
    for role, name in volumes.items():
        labels = inspect(name).get('Labels') or {}
        if labels.get('com.docker.compose.project') != project or labels.get('com.docker.compose.volume') != role:
            raise CoordinatorError('Volume project or role mismatch')
    PHASE = 'stop-application'
    lock_path = '/run/lock/workproof-backup-' + project
    lock = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(compose + ['stop', '--timeout', '60', 'app'])
        baseline = stopped(service('app'))
        if baseline[:2] != (app['Id'], image):
            raise CoordinatorError('Application identity changed before stop')
        with owned_stage(output.parent) as (base, helper):
            stage, encrypted = base / 'stage', base / 'encrypted'
            stage.mkdir(mode=0o700); encrypted.mkdir(mode=0o700)
            PHASE = 'database-dump'
            sql = stage / 'database.sql'
            with sql.open('xb') as stream, pathlib.Path(__file__).with_name('dump-database.sh').open('rb') as script:
                os.fchmod(stream.fileno(), 0o600)
                run(['docker', 'exec', '-i', database['Id'], 'bash', '-s'], stdin=script, stdout=stream,
                    preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024**3, 8 * 1024**3)))
                stream.flush(); os.fsync(stream.fileno())
            PHASE = 'create-collector'
            command = ['docker', 'create', '--rm', '-i', '--network', 'none', '--user', '0:0', '--read-only',
                       '--cidfile', str(base / 'helper.cid'), '--label',
                       'org.workproof.backup-owner=' + helper['token'],
                       '--entrypoint', 'python3']
            for role, name in volumes.items():
                command += ['--mount', f'type=volume,src={name},dst=/source/{role},readonly']
            command += ['--mount', f'type=bind,src={sql},dst=/source/database.sql,readonly',
                        '--mount', f'type=bind,src={stage},dst=/stage',
                        '--mount', f'type=bind,src={encrypted},dst=/output',
                        image, '/opt/workproof/backup_collect.py', 'collect', commit, image]
            # Creation never executes the helper. Cancellation before this returns
            # cannot leave a process writing into scratch; no start was submitted.
            created = run(command, capture_output=True).stdout.decode().strip()
            if not re.fullmatch('[0-9a-f]{64}', created) or (base / 'helper.cid').read_text().strip() != created:
                raise CoordinatorError('Invalid owned helper identity')
            helper['id'] = created
            current = inspect(created)
            if current['Id'] != created or current['Config']['Labels'].get('org.workproof.backup-owner') != helper['token']:
                raise CoordinatorError('Helper identity mismatch')
            PHASE = 'collect-and-encrypt'
            helper['started'] = True
            run(['docker', 'start', '--attach', '--interactive', created],
                input=password + b'\n', stdout=subprocess.DEVNULL)
            PHASE = 'verify-services'
            current_db = service('database')
            if (stopped(service('app')) != baseline or current_db['Id'] != database['Id'] or
                    current_db['Mounts'] != database['Mounts'] or
                    current_db['RestartCount'] != database['RestartCount'] or
                    current_db['State']['StartedAt'] != database['State']['StartedAt']):
                raise CoordinatorError('Service identity changed during backup')
            PHASE = 'publish'
            os.link(encrypted / 'candidate', output, follow_symlinks=False)
            fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--password-stdin',action='store_true',help='Read one passphrase line from standard input; never pass it in arguments')
    args = parser.parse_args()
    if args.password_stdin:
        raw=sys.stdin.buffer.read(1026)
        if not raw.endswith(b'\n'):raise CoordinatorError('One passphrase line required')
        password=raw[:-1]
        password.decode('utf-8',errors='strict')
    else:
        password = getpass.getpass('Backup passphrase (16–1024 UTF-8 bytes): ').encode('utf-8')
    if not 16 <= len(password) <= 1024 or any(x in password for x in (b'\n', b'\r', b'\0')):
        raise CoordinatorError('Invalid passphrase')
    backup(args.output, password)
    print('Encrypted backup completed. Application remains stopped; restore is not implemented.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('BACKUP_STAGE=' + PHASE, file=sys.stderr)
        print('Backup failed. Keep application stopped and inspect deployment state before restarting.', file=sys.stderr)
        sys.exit(1)
