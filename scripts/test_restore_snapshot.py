"""Actions Linux/root acceptance of real encrypted staged extraction, no Docker/SQL."""
import io
import json
import os
import pathlib
import secrets
import stat
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, '/opt/workproof')
candidate = pathlib.Path(__file__).resolve().parent.parent / 'deploy/institution'
if candidate.is_dir():
    sys.path.insert(0, str(candidate))
import backup_crypto as crypto
import snapshot_archive as archive
import restore_snapshot as restore

assert os.name == 'posix' and os.geteuid() == 0, 'Run in isolated Linux Actions container with --user 0:0'
COMMIT = 'a' * 40
IMAGE = 'sha256:' + 'b' * 64


class RestoreAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='workproof-restore-acceptance-')
        cls.base = pathlib.Path(cls.temporary.name)
        cls.base.chmod(0o700)
        cls.fixture = cls.base / 'source'
        cls.fixture.mkdir(mode=0o700)
        for path, (uid, mode) in archive.ROOTS.items():
            directory = cls.fixture / path
            directory.mkdir(mode=mode)
            os.chown(directory, uid, uid)
            directory.chmod(mode)
        jobdir = cls.fixture / 'app_data/jobs'
        jobdir.mkdir(mode=0o700)
        os.chown(jobdir, 10001, 10001)
        cls.contents = {
            'database.sql': b'-- synthetic SQL; never executed\nSELECT NULL, 0x00ff;\n',
            'app_config/application.json': json.dumps({'jwt': secrets.token_hex(32), 'databasePassword': 'synthetic-db-secret'}).encode(),
            'app_config/initialized.json': json.dumps({'initializedAt': 1793664000, 'schemaSha256': 'c' * 64}).encode(),
            'app_config/.setup.lock': b'',
            'initial_account/account.json': json.dumps({'username': 'admin', 'password': secrets.token_hex(24)}).encode(),
            'mysql_root_secret/password': secrets.token_hex(32).encode(),
            'mysql_app_secret/password': b'synthetic-db-secret',
            'app_data/jobs/.queue.lock': b'',
            'app_data/jobs/00000000-0000-4000-8000-000000000001.proof': bytes(range(256)) * 4,
        }
        for path, data in cls.contents.items():
            target = cls.fixture / path
            target.write_bytes(data)
            _, uid, mode = archive._rule(path)
            os.chown(target, uid, uid)
            target.chmod(mode)
        cls.password = secrets.token_urlsafe(32).encode()
        cls.encrypted = cls.base / 'snapshot.enc'
        cls.manifest = archive.create_encrypted_snapshot(cls.fixture, cls.encrypted, cls.password,
            source_commit=COMMIT, image_id=IMAGE, backup_time='2026-11-03T00:00:00Z')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.work = self.base / ('case-' + secrets.token_hex(6))
        self.work.mkdir(mode=0o700)
        self.stage = self.work / 'new-stage'

    def extract(self, source=None, password=None, **identities):
        return restore.extract_authenticated_snapshot(source or self.encrypted, self.stage,
            self.password if password is None else password,
            expected_image_id=identities.get('image', IMAGE),
            expected_source_commit=identities.get('commit', COMMIT))

    def assert_no_output(self):
        self.assertFalse(self.stage.exists())
        self.assertFalse(list(self.work.glob('.workproof-restore-*')))

    def test_real_archive_roundtrip_preserves_every_byte_and_role(self):
        manifest = self.extract()
        self.assertEqual(manifest, self.manifest)
        self.assertEqual(self.stage.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.stage.stat().st_uid, 0)
        actual = {item.relative_to(self.stage).as_posix() for item in self.stage.rglob('*')}
        self.assertEqual(actual, {entry['path'] for entry in manifest['entries']})
        for entry in manifest['entries']:
            target = self.stage / entry['path']
            info = target.lstat()
            self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)),
                             (entry['uid'], entry['gid'], entry['mode']))
            self.assertFalse(target.is_symlink())
            if entry['type'] == 'file':
                self.assertEqual(target.read_bytes(), self.contents[entry['path']])
                self.assertEqual(info.st_nlink, 1)
        self.assertFalse(list(self.work.glob('.workproof-restore-*')))

    def test_wrong_password_never_parses_tar_or_creates_stage(self):
        with mock.patch.object(archive, '_header', wraps=archive._header) as parser:
            with self.assertRaises(restore.RestoreSnapshotError):
                self.extract(password=b'a-different-long-password')
            parser.assert_not_called()
        self.assert_no_output()

    def test_tamper_never_parses_tar_or_creates_stage(self):
        data = bytearray(self.encrypted.read_bytes())
        data[-1] ^= 1
        bad = self.work / 'tampered.enc'
        bad.write_bytes(data)
        with mock.patch.object(archive, '_header', wraps=archive._header) as parser:
            with self.assertRaises(restore.RestoreSnapshotError):
                self.extract(source=bad)
            parser.assert_not_called()
        self.assert_no_output()

    def test_expected_image_and_commit_checked_before_stage_creation(self):
        for identities in [{'image': 'sha256:' + 'd' * 64}, {'commit': 'e' * 40}]:
            with self.subTest(identity=next(iter(identities))):
                with self.assertRaises(restore.RestoreSnapshotError):
                    self.extract(**identities)
                self.assert_no_output()

    def test_existing_directory_is_not_modified_even_when_empty(self):
        self.stage.mkdir(mode=0o700)
        sentinel = self.stage / 'sentinel'
        sentinel.write_bytes(b'untouched')
        with mock.patch.object(archive, 'verify_encrypted_snapshot') as verify:
            with self.assertRaises(restore.RestoreSnapshotError):
                self.extract()
            verify.assert_not_called()
        self.assertEqual(sentinel.read_bytes(), b'untouched')
        sentinel.unlink()
        with self.assertRaises(restore.RestoreSnapshotError):
            self.extract()
        self.assertEqual(list(self.stage.iterdir()), [])

    def test_symlinked_source_destination_and_parent_are_refused(self):
        link = self.work / 'source-link'
        link.symlink_to(self.encrypted)
        with self.assertRaises(restore.RestoreSnapshotError):
            self.extract(source=link)
        self.assert_no_output()
        self.stage.symlink_to(self.fixture, target_is_directory=True)
        with self.assertRaises(restore.RestoreSnapshotError):
            self.extract()
        self.assertTrue(self.stage.is_symlink())
        self.stage.unlink()
        parent = self.work / 'parent-link'
        parent.symlink_to(self.work, target_is_directory=True)
        with self.assertRaises((restore.RestoreSnapshotError, crypto.BackupCryptoError, OSError)):
            restore.extract_authenticated_snapshot(self.encrypted, parent / 'unsafe', self.password,
                expected_image_id=IMAGE, expected_source_commit=COMMIT)
        self.assertFalse((self.work / 'unsafe').exists())

    def test_authenticated_path_traversal_archive_rejected(self):
        raw = self.work / 'unsafe.tar'
        with tarfile.open(raw, 'w', format=tarfile.USTAR_FORMAT) as package:
            member = tarfile.TarInfo('../outside')
            member.size = 4
            member.mode = 0o600
            package.addfile(member, io.BytesIO(b'evil'))
        encrypted = self.work / 'unsafe.enc'
        crypto.encrypt_file(raw, encrypted, self.password)
        with self.assertRaises(restore.RestoreSnapshotError):
            self.extract(source=encrypted)
        self.assert_no_output()
        self.assertFalse((self.base / 'outside').exists())

    def test_real_extraction_write_failure_removes_only_owned_stage(self):
        outside = self.work / 'untouched'
        outside.write_bytes(b'keep')
        original_extract = restore._extract
        def fail_during_extraction(*args):
            with mock.patch.object(crypto, '_write', side_effect=OSError('injected write failure')):
                return original_extract(*args)
        with mock.patch.object(restore, '_extract', side_effect=fail_during_extraction):
            with self.assertRaises(restore.RestoreSnapshotError):
                self.extract()
        self.assert_no_output()
        self.assertEqual(outside.read_bytes(), b'keep')

    def test_replaced_stage_identity_never_deletes_replacement(self):
        renamed = self.work / 'owned-renamed'
        def replace_stage(*args):
            self.stage.rename(renamed)
            self.stage.mkdir(mode=0o700)
            (self.stage / 'other-owner-sentinel').write_bytes(b'preserve replacement')
            raise OSError('injected identity replacement')
        with mock.patch.object(restore, '_extract', side_effect=replace_stage):
            with self.assertRaises(restore.RestoreSnapshotError):
                self.extract()
        self.assertEqual((self.stage / 'other-owner-sentinel').read_bytes(), b'preserve replacement')
        self.assertTrue(renamed.is_dir())
        self.assertFalse(list(self.work.glob('.workproof-restore-*')))


if __name__ == '__main__':
    unittest.main()
