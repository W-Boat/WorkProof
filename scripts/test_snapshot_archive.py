"""Container-only snapshot envelope acceptance. No MySQL, SQL execution or restoration."""
import copy
import hashlib
import io
import json
import os
import pathlib
import secrets
import stat
import sys
import tarfile
import tempfile
from unittest import mock

sys.path.insert(0, '/opt/workproof')
import backup_crypto as crypto
import snapshot_archive as archive

assert os.name == 'posix' and os.getuid() == 0, 'Use the packaged Linux image with --user 0'
COMMIT = 'a' * 40
IMAGE = 'sha256:' + 'b' * 64
TIME = '2026-11-03T00:00:00Z'


def main():
    password = secrets.token_hex(24).encode('ascii')
    with tempfile.TemporaryDirectory(prefix='workproof-snapshot-acceptance-') as temporary:
        base = pathlib.Path(temporary);base.chmod(0o700)
        work = base/'work';work.mkdir(mode=0o700)
        out = base/'output';out.mkdir(mode=0o700)
        count = 0

        def fixture(name):
            stage = base/name;stage.mkdir(mode=0o700)
            for relative, owner, mode in [('app_config',10001,0o700),('initial_account',0,0o700),('mysql_root_secret',0,0o755),('mysql_app_secret',0,0o755),('app_data',10001,0o700),('app_data/jobs',10001,0o700)]:
                path=stage/relative;path.mkdir();os.chown(path,owner,owner);path.chmod(mode)
            db_password=secrets.token_hex(32)
            contents={
                'database.sql':("-- 合成测试布局，未执行 SQL\nCREATE TABLE example (v VARBINARY(16),note TEXT);\nINSERT INTO example VALUES (NULL,'中文'),(0x0001ff,'二进制');\n".encode(),0,0o600),
                'app_config/application.json':(json.dumps({'jwt':secrets.token_hex(32),'databasePassword':db_password}).encode(),10001,0o600),
                'app_config/initialized.json':(json.dumps({'initializedAt':1793664000,'schemaSha256':'c'*64}).encode(),10001,0o600),
                'initial_account/account.json':(json.dumps({'username':'admin','password':secrets.token_hex(24)}).encode(),0,0o600),
                'mysql_root_secret/password':(secrets.token_hex(32).encode(),0,0o444),
                'mysql_app_secret/password':(db_password.encode(),0,0o444),
                'app_data/jobs/00000000-0000-4000-8000-000000000001.proof':(bytes(range(256))*17,10001,0o600),
                'app_data/jobs/.queue.lock':(b'',10001,0o600),
            }
            for relative,(data,owner,mode) in contents.items():
                path=stage/relative;path.write_bytes(data);os.chown(path,owner,owner);path.chmod(mode)
            return stage

        def create(stage, target):
            return archive.create_encrypted_snapshot(stage,target,password,source_commit=COMMIT,image_id=IMAGE,backup_time=TIME)

        def clean_work():
            assert not list(work.iterdir()), 'Temporary plaintext archive or extraction was retained'

        stage=fixture('valid')
        encrypted=out/'snapshot.wpbak'
        manifest=create(stage,encrypted)
        verified=archive.verify_encrypted_snapshot(encrypted,password,work_dir=work)
        assert verified==manifest
        assert stat.S_IMODE(encrypted.stat().st_mode)==0o600
        clean_work()
        raw=out/'authenticated.tar';crypto.decrypt_file(encrypted,raw,password)
        with tarfile.open(raw,'r:') as tar:
            members=[(copy.copy(member),tar.extractfile(member).read() if member.isfile() else None) for member in tar.getmembers()]
            stored_manifest=json.loads(tar.extractfile('manifest.json').read())
            assert stored_manifest==manifest
            for member in tar.getmembers():
                if member.name=='manifest.json':continue
                source=stage/member.name
                assert source.exists()
                info=source.stat()
                assert member.uid==info.st_uid and member.gid==info.st_gid and member.mode==stat.S_IMODE(info.st_mode)
                if member.isfile():assert tar.extractfile(member).read()==source.read_bytes()
        # Every source file must have an exact manifest digest, including binary and empty files.
        entries={entry['path']:entry for entry in manifest['entries']}
        for source in stage.rglob('*'):
            if source.is_file():
                entry=entries[source.relative_to(stage).as_posix()]
                assert entry['size']==source.stat().st_size and entry['sha256']==hashlib.sha256(source.read_bytes()).hexdigest()

        def rejected_snapshot(path, secret=password, **limits):
            nonlocal count
            try:archive.verify_encrypted_snapshot(path,secret,work_dir=work,**limits)
            except archive.SnapshotArchiveError:count+=1
            else:raise AssertionError('Unsafe snapshot accepted')
            clean_work()

        def bad_tar(name, records):
            plain=out/(name+'.tar')
            with tarfile.open(plain,'w:',format=tarfile.USTAR_FORMAT) as tar:
                for info,data in records:
                    tar.addfile(info,io.BytesIO(data) if data is not None else None)
            target=out/(name+'.wpbak');crypto.encrypt_file(plain,target,password)
            rejected_snapshot(target)

        # Spy on tar parsing without replacing cryptography: authentication must happen first.
        with mock.patch.object(archive,'_header',wraps=archive._header) as header:
            rejected_snapshot(encrypted,secrets.token_hex(24).encode())
            header.assert_not_called()
        damaged=out/'bad-aead.wpbak';changed=bytearray(encrypted.read_bytes());changed[-1]^=1;damaged.write_bytes(changed)
        with mock.patch.object(archive,'_header',wraps=archive._header) as header:
            rejected_snapshot(damaged)
            header.assert_not_called()
        rejected_snapshot(encrypted,max_total_bytes=16)
        rejected_snapshot(encrypted,max_files=1)
        # These are real authenticated encrypted tars; rejection must come from archive policy.
        for name,kind,link in [('symlink',tarfile.SYMTYPE,'database.sql'),('hardlink',tarfile.LNKTYPE,'database.sql'),('device',tarfile.CHRTYPE,'')]:
            info=tarfile.TarInfo('app_data/jobs/00000000-0000-4000-8000-000000000002.proof');info.type=kind;info.linkname=link;info.mode=0o600;info.uid=info.gid=10001
            bad_tar(name,members+[(info,None)])
        for name in ['../escape.sql','/absolute.sql','unknown.sql']:
            info=tarfile.TarInfo(name);info.mode=0o600;info.size=1
            bad_tar('path-'+str(count),members+[(info,b'x')])
        duplicate=next(record for record in members if record[0].name=='database.sql')
        bad_tar('duplicate',members+[duplicate])
        bad_tar('missing-sql',[record for record in members if record[0].name!='database.sql'])
        bad_tar('missing-credential',[record for record in members if record[0].name!='initial_account/account.json'])
        changed=[]
        for info,data in members:
            info=copy.copy(info)
            if info.name=='database.sql':data=bytes([data[0]^1])+data[1:]
            changed.append((info,data))
        bad_tar('hash-change',changed)
        changed=[]
        for info,data in members:
            info=copy.copy(info)
            if info.name=='app_config/application.json':info.mode=0o644
            changed.append((info,data))
        bad_tar('wide-mode',changed)
        changed=[]
        for info,data in members:
            info=copy.copy(info)
            if info.name=='app_config/application.json':info.uid=0
            changed.append((info,data))
        bad_tar('wrong-owner',changed)

        def rejected_source(name, mutation):
            nonlocal count
            source=fixture('invalid-'+name);mutation(source)
            target=out/('source-'+name+'.wpbak')
            before={item.name for item in out.iterdir()}
            try:create(source,target)
            except archive.SnapshotArchiveError:count+=1
            else:raise AssertionError('Unsafe source layout accepted')
            assert not target.exists()
            assert {item.name for item in out.iterdir()}==before, 'Failed source packaging retained a temporary archive'
            assert not list(out.glob('.workproof-crypto-*.partial'))

        rejected_source('missing-sql',lambda p:(p/'database.sql').unlink())
        rejected_source('missing-account',lambda p:(p/'initial_account/account.json').unlink())
        rejected_source('wide-file',lambda p:(p/'app_config/application.json').chmod(0o644))
        rejected_source('wrong-owner',lambda p:os.chown(p/'app_config/application.json',0,0))
        def symlink(p):
            target=p/'mysql_app_secret/password';target.unlink();target.symlink_to(p/'mysql_root_secret/password')
        rejected_source('symlink',symlink)
        def hardlink(p):
            os.link(p/'database.sql',p/'unexpected-hardlink')
        rejected_source('hardlink',hardlink)
        rejected_source('device',lambda p:os.mknod(p/'app_data/device',stat.S_IFCHR|0o600,os.makedev(1,3)))
        clean_work()
        print('PASS: real encrypted snapshot envelope, exact source bytes/hash/ownership, '+str(count)+' source/archive refusals and temporary plaintext cleanup; no SQL execution or restore')


if __name__=='__main__':main()
