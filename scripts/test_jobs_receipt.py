"""Linux root image acceptance of V4 receipt archive dependencies; no SQL."""
import copy
import hashlib
import io
import json
import os
import pathlib
import secrets
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0,'/opt/workproof')
import backup_crypto as crypto
import catalog_receipt as catalog
import jobs_receipt as jobs
import snapshot_archive as archive

assert sys.platform.startswith('linux') and os.geteuid()==0
COMMIT='a'*40
IMAGE='sha256:'+'b'*64
CATALOG={'format':catalog.FORMAT,'status':'prepared','sourceCommit':'c'*40,'imageId':'sha256:'+'d'*64,
    'migrationSha256':'e'*64,'schemaSha256':'f'*64,'backupSha256':'1'*64,'startedAt':100,'completedAt':101}


class JobsReceiptArchive(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='workproof-jobs-archive-');self.addCleanup(self.temporary.cleanup)
        self.base=pathlib.Path(self.temporary.name);self.base.chmod(0o700)
        self.stage=self.base/'stage';self.stage.mkdir(mode=0o700)
        for path,(owner,mode) in archive.ROOTS.items():
            target=self.stage/path;target.mkdir();os.chown(target,owner,owner);target.chmod(mode)
        target=self.stage/'app_data/jobs';target.mkdir(mode=0o700);os.chown(target,10001,10001)
        self.catalog=json.dumps(CATALOG,sort_keys=True).encode()
        self.jobs={**CATALOG,'format':jobs.FORMAT,'migrationSha256':'2'*64,'catalogReceiptSha256':hashlib.sha256(self.catalog).hexdigest(),
            'spoolPath':jobs.SPOOL,'startedAt':102,'completedAt':103}
        self.password=secrets.token_urlsafe(32).encode()
        contents={'database.sql':b'-- Synthetic SQL, never executed\nSELECT NULL;\n',
            'app_config/application.json':json.dumps({'jwt':secrets.token_hex(32),'databasePassword':secrets.token_hex(32)}).encode(),
            'app_config/initialized.json':json.dumps({'initializedAt':100,'schemaSha256':'f'*64}).encode(),
            'initial_account/account.json':b'{"username":"admin","password":"synthetic-long-password-value"}',
            'mysql_root_secret/password':secrets.token_hex(32).encode(),'mysql_app_secret/password':secrets.token_hex(32).encode(),
            'app_config/catalog.json':self.catalog,'app_config/jobs.json':json.dumps(self.jobs).encode(),
            'app_data/jobs/00000000-0000-4000-8000-000000000001.proof':bytes(range(256)),
            'app_data/jobs/00000000-0000-4000-8000-000000000002.tmp':b'interrupted-upload',
            'app_data/jobs/.queue.lock':b''}
        for path,data in contents.items():
            _,owner,mode=archive._rule(path);self.write(path,data,owner,mode)

    def write(self,path,data,owner=10001,mode=0o600):
        target=self.stage/path;target.write_bytes(data);os.chown(target,owner,owner);target.chmod(mode)

    def create(self,name='snapshot.enc'):
        target=self.base/name
        manifest=archive.create_encrypted_snapshot(self.stage,target,self.password,source_commit=COMMIT,image_id=IMAGE,backup_time='2026-11-03T00:00:00Z')
        return target,manifest

    def verify(self,path):
        return archive.verify_encrypted_snapshot(path,self.password,work_dir=self.base)

    def repack(self,source,*,updates=None,remove=(),reverse=False):
        raw=self.base/('raw-'+secrets.token_hex(4)+'.tar');crypto.decrypt_file(source,raw,self.password)
        with tarfile.open(raw,'r:') as package:
            members=[(copy.copy(info),package.extractfile(info).read() if info.isfile() else None) for info in package.getmembers()]
        manifest=json.loads(members[0][1]);updates=updates or {}
        manifest['entries']=[entry for entry in manifest['entries'] if entry['path'] not in remove]
        for entry in manifest['entries']:
            if entry['path'] in updates:
                data=updates[entry['path']];entry.update(size=len(data),sha256=hashlib.sha256(data).hexdigest())
        body=[(info,updates.get(info.name,data)) for info,data in members[1:] if info.name not in remove]
        if reverse:body.reverse()
        changed=self.base/('changed-'+secrets.token_hex(4)+'.tar')
        first=members[0][0];payload=json.dumps(manifest).encode();first.size=len(payload)
        with tarfile.open(changed,'w',format=tarfile.USTAR_FORMAT) as package:
            package.addfile(first,io.BytesIO(payload))
            for info,data in body:
                if data is not None:info.size=len(data)
                package.addfile(info,io.BytesIO(data) if data is not None else None)
        output=self.base/('repacked-'+secrets.token_hex(4)+'.enc');crypto.encrypt_file(changed,output,self.password)
        return output

    def test_real_roundtrip_and_reverse_member_order(self):
        encrypted,manifest=self.create();self.assertEqual(self.verify(encrypted),manifest)
        self.assertEqual(self.verify(self.repack(encrypted,reverse=True)),manifest)
        names={entry['path'] for entry in manifest['entries']}
        self.assertIn('app_config/jobs.json',names)
        self.assertIn('app_data/jobs/00000000-0000-4000-8000-000000000002.tmp',names)
        # Archive image differs from original preparation image intentionally:
        # historical provenance is not rewritten to the current application.
        self.assertNotEqual(CATALOG['imageId'],manifest['image_id'])

    def test_authenticated_malformed_jobs_payload(self):
        encrypted,_=self.create()
        for updates in ({'status':'applying'}, {'completedAt':True}, {'catalogReceiptSha256':'bad'}, {'spoolPath':'/tmp/other'}):
            payload=json.dumps({**self.jobs,**updates}).encode()
            with self.subTest(fields=tuple(updates)),self.assertRaises(archive.SnapshotArchiveError):
                self.verify(self.repack(encrypted,updates={'app_config/jobs.json':payload}))

    def test_missing_and_mismatched_dependency_creation_and_verification(self):
        encrypted,_=self.create()
        with self.assertRaises(archive.SnapshotArchiveError):
            self.verify(self.repack(encrypted,remove={'app_config/catalog.json'}))
        # Semantically identical V3 JSON with different whitespace must fail the
        # exact-byte dependency, even though both individual receipts validate.
        alternate=json.dumps(CATALOG,indent=2).encode()
        with self.assertRaises(archive.SnapshotArchiveError):
            self.verify(self.repack(encrypted,updates={'app_config/catalog.json':alternate}))
        changed={**self.jobs,'schemaSha256':'3'*64}
        with self.assertRaises(archive.SnapshotArchiveError):
            self.verify(self.repack(encrypted,updates={'app_config/jobs.json':json.dumps(changed).encode()}))
        self.write('app_config/catalog.json',alternate)
        with self.assertRaises(archive.SnapshotArchiveError):self.create('must-not-publish.enc')
        self.assertFalse((self.base/'must-not-publish.enc').exists())
        (self.stage/'app_config/catalog.json').unlink()
        with self.assertRaises(archive.SnapshotArchiveError):self.create('must-not-publish.enc')

    def test_pending_and_unsafe_temporary_paths_are_rejected(self):
        self.write('app_config/.jobs-preparing.json',json.dumps({**self.jobs,'status':'applying','completedAt':None}).encode(),owner=0)
        with self.assertRaises(archive.SnapshotArchiveError):self.create()
        (self.stage/'app_config/.jobs-preparing.json').unlink()
        self.write('app_data/jobs/not-a-uuid.tmp',b'unknown')
        with self.assertRaises(archive.SnapshotArchiveError):self.create()
        (self.stage/'app_data/jobs/not-a-uuid.tmp').unlink()
        path='app_data/jobs/00000000-0000-4000-8000-000000000002.tmp'
        self.write(path,b'bad-permission',mode=0o644)
        with self.assertRaises(archive.SnapshotArchiveError):self.create()
        self.assertFalse((self.base/'snapshot.enc').exists())
        self.assertFalse(list(self.base.glob('.workproof-snapshot-*')))


if __name__=='__main__':unittest.main()
