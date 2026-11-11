"""Actions/Linux-root failure injection; Docker is entirely mocked.

Exercises real coordinator staging, cleanup and exclusive publication. Synthetic
candidate bytes here do not test encryption; real archive authentication has its
own container acceptance. No subprocess in this file reaches a real Docker daemon.
"""
import copy
import importlib.util
import json
import os
import pathlib
import subprocess
import signal
import tempfile
import unittest
from unittest import mock


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'deploy/institution/backup_coordinator.py'
SPEC = importlib.util.spec_from_file_location('failure_coordinator', SOURCE)
coordinator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(coordinator)
PASSWORD = b'synthetic-backup-passphrase'
APP = 'a' * 64
DB = 'b' * 64
IMAGE = 'sha256:' + 'c' * 64
HELPER = 'e' * 64
PROJECT = 'failure_injection'


class FakeDocker:
    def __init__(self, failure=None, target=None):
        self.failure, self.target = failure, target
        self.calls = []
        self.running = True
        self.dumped = self.collected = False
        self.stage = self.encrypted = None
        self.helper_exists = False
        self.owner = None
        self.app = self.container(APP, [('/private/config', 'app_config'), ('/var/lib/workproof', 'app_data')])
        self.database = self.container(DB, [('/private/mysql-root', 'mysql_root_secret'),
                                            ('/private/mysql-app', 'mysql_app_secret')])

    @staticmethod
    def container(identity, mounts):
        return {'Id': identity, 'Image': IMAGE, 'RestartCount': 0,
                'Config': {'Labels': {'com.docker.compose.project': PROJECT}},
                'State': {'Running': True, 'Restarting': False, 'Paused': False,
                          'StartedAt': 'start', 'FinishedAt': 'finish'},
                'Mounts': [{'Type': 'volume', 'Destination': path, 'Name': PROJECT + '_' + role}
                           for path, role in mounts]}

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        if args[:2] == ['docker', 'inspect']:
            identity = args[2]
            if identity == APP:
                value = copy.deepcopy(self.app)
                value['State']['Running'] = self.running
                if self.failure == 'restart' and self.collected:
                    # A restart that finished again must still invalidate the backup.
                    value['RestartCount'] = 1
                    value['State']['StartedAt'] = 'later'
            elif identity == DB:
                value = self.database
            elif identity == IMAGE:
                value = {'Config': {'Labels': {'org.opencontainers.image.revision': 'd' * 40}}}
            elif identity == HELPER:
                value = {'Id': HELPER, 'Config': {'Labels': {'org.workproof.backup-owner': self.owner}}}
            else:
                role = identity.removeprefix(PROJECT + '_')
                value = {'Name': identity, 'Labels': {'com.docker.compose.project': PROJECT,
                                                     'com.docker.compose.volume': role}}
            return subprocess.CompletedProcess(args, 0, json.dumps([value]).encode())
        if args[:2] == ['docker', 'compose']:
            if 'ps' in args:
                identity = APP if args[-1] == 'app' else DB
                return subprocess.CompletedProcess(args, 0, (identity + '\n').encode())
            if 'stop' in args:
                self.running = False
                return subprocess.CompletedProcess(args, 0)
            raise AssertionError('Unexpected Compose mutation')
        if args[:2] == ['docker', 'exec']:
            assert not self.running, 'dump before stopping application'
            self.dumped = True
            kwargs['stdout'].write(b'-- synthetic partial SQL\n')
            kwargs['stdout'].flush()
            if self.failure == 'dump':
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0)
        if args[:2] == ['docker', 'ps']:
            if self.failure == 'cleanup_unknown':
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0, (HELPER if self.helper_exists else '').encode())
        if args[:2] == ['docker', 'rm']:
            assert args[-1] == HELPER
            self.helper_exists = False
            return subprocess.CompletedProcess(args, 0)
        if args[:2] == ['docker', 'create']:
            assert not self.running and self.dumped
            self.owner = args[args.index('--label') + 1].split('=', 1)[1]
            pathlib.Path(args[args.index('--cidfile') + 1]).write_text(HELPER)
            self.helper_exists = True
            mounts = {}
            for index, item in enumerate(args):
                if item == '--mount':
                    fields = dict(part.split('=', 1) for part in args[index + 1].split(',') if '=' in part)
                    mounts[fields['dst']] = fields['src']
            self.stage = pathlib.Path(mounts['/stage'])
            self.encrypted = pathlib.Path(mounts['/output'])
            return subprocess.CompletedProcess(args, 0, (HELPER + '\n').encode())
        if args[:2] == ['docker', 'start']:
            assert args[-1] == HELPER
            assert kwargs['input'] == PASSWORD + b'\n'
            assert PASSWORD.decode() not in ' '.join(args)
            assert self.stage.stat().st_mode & 0o777 == 0o700
            assert self.encrypted.stat().st_mode & 0o777 == 0o700
            assert (self.stage / 'database.sql').stat().st_mode & 0o777 == 0o600
            (self.stage / 'private-material').write_bytes(b'synthetic plaintext secret')
            candidate = self.encrypted / 'candidate'
            candidate.write_bytes(b'synthetic verified envelope')
            candidate.chmod(0o600)
            self.collected = True
            if self.failure == 'term':
                os.kill(os.getpid(), signal.SIGTERM)
            if self.failure == 'cleanup_unknown':
                raise subprocess.CalledProcessError(1, args)
            if self.failure == 'collect':
                candidate.write_bytes(b'incomplete envelope')
                raise subprocess.CalledProcessError(1, args)
            if self.failure == 'race':
                self.target.write_bytes(b'preexisting concurrent target')
            return subprocess.CompletedProcess(args, 0)
        raise AssertionError('Unexpected subprocess: ' + repr(args))


@unittest.skipUnless(os.name == 'posix' and os.geteuid() == 0, 'Run in Actions with sudo python3')
class BackupFailures(unittest.TestCase):
    def test_pair_publication_refuses_an_existing_empty_directory(self):
        with tempfile.TemporaryDirectory(prefix='workproof-pair-publication-') as temporary:
            parent = pathlib.Path(temporary)
            candidate = parent / 'candidate'
            target = parent / 'target'
            candidate.mkdir(mode=0o700)
            target.mkdir(mode=0o700)
            for name in ('deployment.wproofbackup', 'receipt-key.wproofbackup'):
                member = candidate / name
                member.write_bytes(b'synthetic encrypted member')
                member.chmod(0o600)
            with self.assertRaises(FileExistsError):
                coordinator.publish_backup(candidate, target, paired=True)
            self.assertEqual(list(target.iterdir()), [])
            self.assertEqual(len(list(candidate.iterdir())), 2)

    def exercise(self, failure):
        with tempfile.TemporaryDirectory(prefix='workproof-failure-test-') as temporary:
            base = pathlib.Path(temporary)
            output_dir = base / 'output'
            output_dir.mkdir(mode=0o700)
            target = output_dir / 'backup.enc'
            fake = FakeDocker(failure, target)
            real_open, real_link = os.open, os.link

            def open_local(path, flags, *args, **kwargs):
                if str(path).startswith('/run/lock/workproof-backup-'):
                    path = base / 'coordinator.lock'
                return real_open(path, flags, *args, **kwargs)

            def publish(source, destination, **kwargs):
                if failure == 'publish':
                    raise OSError('injected filesystem publication failure')
                return real_link(source, destination, **kwargs)

            with mock.patch.object(coordinator.subprocess, 'run', side_effect=fake), \
                    mock.patch.object(coordinator.os, 'open', side_effect=open_local), \
                    mock.patch.object(coordinator.os, 'link', side_effect=publish):
                if failure:
                    with self.assertRaises((subprocess.CalledProcessError, OSError, coordinator.CoordinatorError)):
                        coordinator.backup(target, PASSWORD)
                else:
                    coordinator.backup(target, PASSWORD)
            self.assertFalse(fake.running, 'Application restarted after backup attempt')
            self.assertFalse(any(args[:2] == ['docker', 'compose'] and
                                 ('start' in args or 'up' in args) for args in fake.calls))
            if failure == 'cleanup_unknown':
                retained = list(output_dir.glob('.workproof-backup-*'))
                self.assertEqual(len(retained), 1)
                self.assertEqual(retained[0].stat().st_mode & 0o777, 0o700)
                self.assertTrue((fake.stage / 'private-material').exists())
                self.assertFalse(target.exists())
                self.assertTrue(fake.helper_exists)
                return
            self.assertFalse(fake.helper_exists, 'Owned helper left alive')
            self.assertFalse(list(output_dir.glob('.workproof-backup-*')), 'Owned scratch leaked')
            if fake.stage is not None:
                self.assertFalse(fake.stage.exists())
                self.assertFalse(fake.encrypted.exists())
            if failure == 'race':
                self.assertEqual(target.read_bytes(), b'preexisting concurrent target')
            elif failure:
                self.assertFalse(target.exists(), 'Failed backup published a candidate')
            else:
                self.assertEqual(target.read_bytes(), b'synthetic verified envelope')
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(set(output_dir.iterdir()), {target} if target.exists() else set())

    def test_success_uses_same_cleanup_path(self):
        self.exercise(None)

    def test_partial_dump_failure(self):
        self.exercise('dump')

    def test_partial_collection_failure(self):
        self.exercise('collect')

    def test_publication_filesystem_failure(self):
        self.exercise('publish')

    def test_concurrent_target_is_never_overwritten(self):
        self.exercise('race')

    def test_completed_restart_invalidates_candidate(self):
        self.exercise('restart')

    def test_sigterm_terminates_owned_helper_before_cleanup(self):
        self.exercise('term')

    def test_unconfirmed_helper_keeps_private_stage(self):
        self.exercise('cleanup_unknown')

    def test_existing_target_rejected_before_docker(self):
        with tempfile.TemporaryDirectory(prefix='workproof-existing-test-') as temporary:
            target = pathlib.Path(temporary) / 'backup.enc'
            target.write_bytes(b'original')
            with mock.patch.object(coordinator.subprocess, 'run') as docker:
                with self.assertRaises(coordinator.CoordinatorError):
                    coordinator.backup(target, PASSWORD)
                docker.assert_not_called()
            self.assertEqual(target.read_bytes(), b'original')


if __name__ == '__main__':
    unittest.main()
