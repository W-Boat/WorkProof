"""Actions-only actual V3 preparation against disposable server Compose project."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent/'deploy/institution'))
import backup_coordinator as backup
import catalog_prepare as catalog

PHASE = 'preflight'


def main():
    global PHASE
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.geteuid() == 0
    parser = argparse.ArgumentParser()
    for name in ('project','backup','expected-image','expected-commit'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--password-stdin',action='store_true',required=True)
    args = parser.parse_args()
    assert re.fullmatch('workproof-server-ci-[0-9a-f]{12}',args.project)
    assert os.environ.get('COMPOSE_PROJECT_NAME') == args.project
    raw = sys.stdin.buffer.read(1026)
    assert raw.endswith(b'\n')
    password = raw[:-1]
    compose = ['docker','compose','--file',str(pathlib.Path(catalog.__file__).with_name('compose.yaml'))]
    def service(name):
        identity = backup.run(compose+['ps','--all','--quiet',name],capture_output=True).stdout.decode().strip()
        return backup.inspect(identity)
    database = service('database')['Id']
    def query(sql):
        command = 'export MYSQL_PWD="$(cat /private/mysql-root/password)"; exec mysql --user=root --database=workproof --batch --skip-column-names'
        return backup.run(['docker','exec','-i',database,'bash','-ec',command],input=sql.encode(),capture_output=True).stdout
    def security():
        return b'\0'.join(query('SELECT * FROM '+table+' ORDER BY 1,2;') for table in ('sys_user','sys_role','sys_user_role','sys_role_menu'))
    before = security()
    assert query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='workproof' AND TABLE_NAME='wp_certificate';").strip() == b'0'
    PHASE = 'backup-refusal'
    # Existing output is an actual backup failure before migration, not a mocked
    # command. Only an acceptance-owned sentinel is used as the refused target.
    refused = pathlib.Path(args.backup).with_name('catalog-refused-backup.enc')
    with refused.open('xb') as output:
        output.write(b'acceptance-owned-existing-target')
    try:
        try:
            catalog.prepare(args.project,str(refused),password,args.expected_image,args.expected_commit)
        except Exception:
            pass
        else:
            raise AssertionError('Existing backup target accepted')
        assert refused.read_bytes() == b'acceptance-owned-existing-target'
        assert query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='workproof' AND TABLE_NAME='wp_certificate';").strip() == b'0'
        assert security() == before
    finally:
        refused.unlink()
    PHASE = 'prepare'
    catalog.prepare(args.project,args.backup,password,args.expected_image,args.expected_commit)
    assert security() == before
    assert not service('app')['State']['Running']
    assert query('SELECT COUNT(*) FROM wp_certificate;').strip() == b'0'
    assert query('SELECT COUNT(*) FROM sys_menu WHERE id BETWEEN 81000 AND 81003;').strip() == b'4'
    PHASE = 'receipt'
    config = backup.volume(service('app'),'/private/config')
    check = "import catalog_receipt as r,hashlib,pathlib,json;v=r.read(pathlib.Path('/private/config')/r.PREPARED);assert not (pathlib.Path('/private/config')/r.PENDING).exists();assert v['migrationSha256']==hashlib.sha256(pathlib.Path('/opt/workproof/sql/V3__workproof_certificate_catalog.sql').read_bytes()).hexdigest();print(json.dumps(v))"
    result = backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3',
        '--mount',f'type=volume,src={config},dst=/private/config,readonly',args.expected_image,'-c',check],capture_output=True).stdout
    receipt = json.loads(result)
    digest = hashlib.sha256()
    with pathlib.Path(args.backup).open('rb') as source:
        for chunk in iter(lambda:source.read(1024**2),b''):
            digest.update(chunk)
    assert receipt['backupSha256'] == digest.hexdigest()
    assert receipt['sourceCommit'] == args.expected_commit and receipt['imageId'] == args.expected_image
    PHASE = 'repeat-refusal'
    repeat = str(pathlib.Path(args.backup).with_name('must-not-create-repeat.enc'))
    try:
        catalog.prepare(args.project,repeat,password,args.expected_image,args.expected_commit)
    except Exception:
        pass
    else:
        raise AssertionError('Repeated preparation was accepted')
    assert not pathlib.Path(repeat).exists()
    assert security() == before
    assert json.loads(backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3',
        '--mount',f'type=volume,src={config},dst=/private/config,readonly',args.expected_image,'-c',check],capture_output=True).stdout) == receipt
    PHASE = 'startup'
    backup.run(compose+['up','--detach','app'])
    base = 'http://127.0.0.1:' + os.environ.get('WORKPROOF_HTTP_PORT','18081')
    def request(path,data=None,token=None):
        headers = {'Content-Type':'application/json'}
        if token:
            headers['Authorization'] = 'Bearer '+token
        payload = json.dumps(data).encode() if data is not None else None
        try:
            response = urllib.request.urlopen(urllib.request.Request(base+path,data=payload,headers=headers),timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status,response.read()
    try:
        deadline = time.monotonic()+150
        while time.monotonic()<deadline:
            try:
                if request('/api/health')[0] == 200:
                    break
            except (urllib.error.URLError,TimeoutError,ConnectionError):
                pass
            time.sleep(1)
        else:
            raise AssertionError('Prepared catalog app not healthy')
        PHASE = 'login'
        account_volume = args.project+'_initial_account'
        account_code = "import pathlib;print(pathlib.Path('/account/account.json').read_text())"
        account = json.loads(backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3',
            '--mount',f'type=volume,src={account_volume},dst=/account,readonly',args.expected_image,'-c',account_code],capture_output=True).stdout)
        captcha = json.loads(request('/api/auth/captcha')[1])['data']
        code,body = request('/api/auth/login',{'username':'admin','password':account['password'],
            'captchaUuid':captcha['uuid'],'captcha':captcha['code']})
        assert code == 200
        token = json.loads(body)['data']['token']
        PHASE = 'catalog-api'
        def api(path='',data=None):
            code,body = request('/api/workproof/certificates'+path,data,token)
            value = json.loads(body)
            assert code == 200 and value['code'] == 200
            return value['data']
        status = api('/status')
        assert status['enabled'] and status['schemaPrepared'] and status['ready']
        code,jobs_body = request('/api/workproof/certificate-jobs/capabilities',token=token)
        jobs_status = json.loads(jobs_body)['data']
        assert code == 200 and not jobs_status['enabled'] and not jobs_status['ready']
        root = pathlib.Path(__file__).resolve().parent.parent
        proof = json.loads((root/'apps/verifier/public/demo/essay.md.wproof').read_text(encoding='utf-8'))
        saved = api(data=proof)['entry']
        assert saved['artifactChecked'] is False and saved['identityVerified'] is False
        assert api(data=proof)['entry']['id'] == saved['id']
        listing = api()
        assert listing['total'] == 1 and listing['rows'][0]['id'] == saved['id']
        assert api('/'+str(saved['id']))['proofHash'] == saved['proofHash']
        assert api('?keyword=not-present')['total'] == 0
        code,exported = request('/api/workproof/certificates/export',token=token)
        assert code == 200 and exported.decode('utf-8').count(saved['certificateId']) == 1
        # No ordinary-role grant is introduced by migration or API usage.
        grant_tables = ('sys_role','sys_user_role','sys_role_menu')
        # Users may receive last-login updates; verify role/grant records directly.
        after_grants = b'\0'.join(query('SELECT * FROM '+table+' ORDER BY 1,2;') for table in grant_tables)
        assert after_grants == before.split(b'\0',1)[1]
    finally:
        backup.run(compose+['stop','--timeout','60','app'])
    before = security()  # Login updates are valid; preserve this baseline in backup.
    PHASE = 'new-backup'
    post = str(pathlib.Path(args.backup).with_name('after-catalog.enc'))
    backup.backup(post,password)
    verify = "import snapshot_archive as a,sys;v=a.verify_encrypted_snapshot('/backup/after-catalog.enc',sys.stdin.buffer.readline().rstrip(b'\\n'),work_dir='/backup');assert 'app_config/catalog.json' in {e['path'] for e in v['entries']}"
    backup.run(['docker','run','--rm','-i','--network','none','--user','0:0','--entrypoint','python3',
        '--mount',f'type=bind,src={pathlib.Path(post).parent},dst=/backup',args.expected_image,'-c',verify],input=password+b'\n')
    assert not service('app')['State']['Running'] and security() == before
    print('PASS actual V3 backup failure refusal, preparation and receipt; unchanged grants; enabled catalog save/dedup/list/detail/export; repeated refusal and authenticated enabled backup; app stopped')


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        safe = PHASE if PHASE in {'preflight','backup-refusal','prepare','receipt','repeat-refusal','startup','login','catalog-api','new-backup'} else 'unknown'
        print('CATALOG_TEST_PHASE='+safe,file=sys.stderr)
        sys.exit(1)
