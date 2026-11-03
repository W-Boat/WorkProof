"""Linux/root image acceptance: real receipt permissions and encrypted archives."""
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
import catalog_receipt as receipt
import snapshot_archive as archive

assert sys.platform.startswith('linux') and os.geteuid() == 0, 'Use isolated Actions image with --user 0:0'
COMMIT = 'a'*40
IMAGE = 'sha256:'+'b'*64
TIME = '2026-11-03T00:00:00Z'
VALID = {'format':receipt.FORMAT,'status':'prepared','sourceCommit':COMMIT,'imageId':IMAGE,
         'migrationSha256':'c'*64,'schemaSha256':'d'*64,'backupSha256':'e'*64,
         'startedAt':100,'completedAt':101}


class ReceiptAcceptance(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='workproof-receipt-')
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name)
        self.base.chmod(0o700)

    def write(self, path, value=VALID, owner=10001, mode=0o600):
        path.write_bytes(value if isinstance(value,bytes) else json.dumps(value).encode())
        os.chown(path,owner,owner)
        path.chmod(mode)
        return path

    def test_strict_receipt_values(self):
        self.assertEqual(receipt.validate(json.dumps(VALID)),VALID)
        cases = []
        for key in VALID:
            missing = dict(VALID);missing.pop(key);cases.append(missing)
        for key,values in {'format':['other',None], 'status':['applying','enabled',True],
                'sourceCommit':['a'*39,'A'*40,1], 'imageId':['b'*64,'sha256:'+'z'*64,None],
                'migrationSha256':['c'*63,True], 'schemaSha256':['D'*64,[]],
                'backupSha256':['e'*65,{}], 'startedAt':[True,-1,'100',None],
                'completedAt':[False,99,'101',None]}.items():
            for value in values:
                case = dict(VALID);case[key]=value;cases.append(case)
        cases += [{**VALID,'extra':1},[],None]
        for index,case in enumerate(cases):
            with self.subTest(case=index),self.assertRaises((ValueError,TypeError)):
                receipt.validate(json.dumps(case))
        raw = json.dumps(VALID)
        malformed = [raw[:-1]+',"startedAt":100}', raw.replace('100','NaN'),
                     raw.replace('101','Infinity'), raw.replace('101','1e999')]
        for data in malformed:
            with self.assertRaises(ValueError):
                receipt.validate(data)

    def test_actual_permissions_and_links(self):
        path = self.write(self.base/'prepared.json')
        self.assertEqual(receipt.read(path),VALID)
        for owner,mode in [(0,0o600),(10002,0o600),(10001,0o644),(10001,0o400)]:
            self.write(path,owner=owner,mode=mode)
            with self.assertRaises(ValueError):
                receipt.read(path)
        self.write(path)
        os.chown(path,10001,10002)
        with self.assertRaises(ValueError):
            receipt.read(path)
        self.write(path)
        link = self.base/'symbolic';link.symlink_to(path)
        with self.assertRaises((ValueError,OSError)):
            receipt.read(link)
        hard = self.base/'hard';os.link(path,hard)
        with self.assertRaises(ValueError):
            receipt.read(path)
        hard.unlink()
        self.write(path,b'x'*16385)
        with self.assertRaises(ValueError):
            receipt.read(path)
        path.unlink();path.mkdir()
        with self.assertRaises((ValueError,OSError)):
            receipt.read(path)
        fifo = self.base/'fifo';os.mkfifo(fifo,0o600)
        with self.assertRaises(ValueError):
            receipt.read(fifo)

    def test_pending_is_never_a_prepared_receipt(self):
        pending = {**VALID,'status':'applying','completedAt':None}
        path = self.write(self.base/receipt.PENDING,pending,owner=0)
        self.assertEqual(receipt.read(path,pending=True),pending)
        with self.assertRaises(ValueError):
            receipt.validate(json.dumps(pending))
        with self.assertRaises(ValueError):
            receipt.read(path)
        with self.assertRaises(ValueError):
            receipt.validate(json.dumps(VALID),pending=True)
        for value in [101,False,'101']:
            with self.assertRaises(ValueError):
                receipt.validate(json.dumps({**pending,'completedAt':value}),pending=True)

    def fixture(self):
        stage = self.base/'stage';stage.mkdir(mode=0o700)
        for name,(owner,mode) in archive.ROOTS.items():
            path=stage/name;path.mkdir();os.chown(path,owner,owner);path.chmod(mode)
        data = {'database.sql':b'-- Synthetic SQL; never executed\nSELECT NULL;\n',
                'app_config/application.json':json.dumps({'jwt':secrets.token_hex(32),'databasePassword':secrets.token_hex(32)}).encode(),
                'app_config/initialized.json':json.dumps({'initializedAt':100,'schemaSha256':'d'*64}).encode(),
                'initial_account/account.json':json.dumps({'username':'admin','password':secrets.token_hex(24)}).encode(),
                'mysql_root_secret/password':secrets.token_hex(32).encode(),
                'mysql_app_secret/password':secrets.token_hex(32).encode(),
                'app_config/'+receipt.PREPARED:json.dumps(VALID).encode()}
        for name,value in data.items():
            owner,mode=archive.FILES[name];self.write(stage/name,value,owner,mode)
        return stage

    def create(self,stage,output,password):
        return archive.create_encrypted_snapshot(stage,output,password,source_commit=COMMIT,image_id=IMAGE,backup_time=TIME)

    def test_actual_encrypted_optional_receipt_and_pending_refusal(self):
        stage=self.fixture();password=secrets.token_urlsafe(32).encode()
        target=self.base/'valid.enc'
        manifest=self.create(stage,target,password)
        self.assertEqual(archive.verify_encrypted_snapshot(target,password,work_dir=self.base),manifest)
        self.assertIn('app_config/'+receipt.PREPARED,{entry['path'] for entry in manifest['entries']})
        # A legitimately authenticated envelope must still reject malformed receipt
        # payloads even when its manifest size/hash are internally consistent.
        raw=self.base/'original.tar';crypto.decrypt_file(target,raw,password)
        changed=self.base/'invalid.tar'
        with tarfile.open(raw,'r:') as source:
            members=[(copy.copy(member),source.extractfile(member).read() if member.isfile() else None) for member in source.getmembers()]
        bad=json.dumps({**VALID,'completedAt':False}).encode()
        recorded=json.loads(members[0][1])
        for entry in recorded['entries']:
            if entry['path']=='app_config/'+receipt.PREPARED:
                entry.update(size=len(bad),sha256=hashlib.sha256(bad).hexdigest())
        with tarfile.open(changed,'w',format=tarfile.USTAR_FORMAT) as output:
            for member,payload in members:
                if member.name=='manifest.json':payload=json.dumps(recorded).encode()
                if member.name=='app_config/'+receipt.PREPARED:payload=bad
                if payload is not None:member.size=len(payload)
                output.addfile(member,io.BytesIO(payload) if payload is not None else None)
        invalid=self.base/'invalid.enc';crypto.encrypt_file(changed,invalid,password)
        with self.assertRaises(archive.SnapshotArchiveError):
            archive.verify_encrypted_snapshot(invalid,password,work_dir=self.base)
        self.write(stage/'app_config'/receipt.PREPARED,bad)
        refused=self.base/'must-not-publish.enc'
        with self.assertRaises(archive.SnapshotArchiveError):
            self.create(stage,refused,password)
        self.assertFalse(refused.exists())
        self.write(stage/'app_config'/receipt.PREPARED)
        self.write(stage/'app_config'/receipt.PENDING,{**VALID,'status':'applying','completedAt':None},owner=0)
        with self.assertRaises(archive.SnapshotArchiveError):
            self.create(stage,refused,password)
        self.assertFalse(refused.exists())
        self.assertFalse(list(self.base.glob('.workproof-snapshot-*')))


if __name__ == '__main__':
    unittest.main()
