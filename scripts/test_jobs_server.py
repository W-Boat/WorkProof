"""Actions-only real Compose V4 preparation/lifecycle and retained draft backup."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent/'deploy/institution'))
import backup_coordinator as backup
import jobs_prepare as jobs

PHASE='preflight'


def main():
    global PHASE
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.geteuid()==0
    parser=argparse.ArgumentParser()
    for name in ('project','backup','expected-image','expected-commit'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--password-stdin',action='store_true',required=True);args=parser.parse_args()
    assert re.fullmatch('workproof-server-ci-[0-9a-f]{12}',args.project)
    assert os.environ.get('COMPOSE_PROJECT_NAME')==args.project
    raw=sys.stdin.buffer.read(1026);assert raw.endswith(b'\n');password=raw[:-1]
    compose=['docker','compose','--file',str(pathlib.Path(jobs.__file__).with_name('compose.yaml'))]
    def service(name):
        return backup.inspect(backup.run(compose+['ps','--all','--quiet',name],capture_output=True).stdout.decode().strip())
    database=service('database')['Id']
    def query(sql):
        command='export MYSQL_PWD="$(cat /private/mysql-root/password)"; exec mysql --user=root --database=workproof --batch --skip-column-names'
        return backup.run(['docker','exec','-i',database,'bash','-ec',command],input=sql.encode(),capture_output=True).stdout
    def preserved():
        return [query('SELECT * FROM '+table+' ORDER BY 1,2;') for table in ('sys_user','sys_role','sys_user_role','sys_role_menu','wp_certificate')]
    before=preserved()
    assert query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='workproof' AND TABLE_NAME IN ('wp_certificate_job','wp_certificate_job_item');").strip()==b'0'
    PHASE='prepare';jobs.prepare(args.project,args.backup,password,args.expected_image,args.expected_commit)
    assert preserved()==before and not service('app')['State']['Running']
    config=backup.volume(service('app'),'/private/config');data=backup.volume(service('app'),'/var/lib/workproof')
    PHASE='receipt'
    check="import pathlib,hashlib,json,jobs_receipt as r,catalog_receipt as c;p=pathlib.Path('/private/config');v=r.read(p/r.PREPARED);assert not (p/r.PENDING).exists();assert v['catalogReceiptSha256']==hashlib.sha256((p/c.PREPARED).read_bytes()).hexdigest();assert v['migrationSha256']==hashlib.sha256(pathlib.Path('/opt/workproof/sql/V4__workproof_certificate_jobs.sql').read_bytes()).hexdigest();print(json.dumps(v))"
    receipt=json.loads(backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',
        f'type=volume,src={config},dst=/private/config,readonly',args.expected_image,'-c',check],capture_output=True).stdout)
    digest=hashlib.sha256()
    with pathlib.Path(args.backup).open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):digest.update(block)
    assert receipt['backupSha256']==digest.hexdigest()
    repeat=pathlib.Path(args.backup).with_name('must-not-repeat-jobs.enc')
    try:jobs.prepare(args.project,str(repeat),password,args.expected_image,args.expected_commit)
    except Exception:pass
    else:raise AssertionError('Repeated V4 preparation accepted')
    assert not repeat.exists() and preserved()==before
    base='http://127.0.0.1:'+os.environ.get('WORKPROOF_HTTP_PORT','18081')
    def request(path,body=None,token=None,method=None):
        headers={}
        if token:headers['Authorization']='Bearer '+token
        if isinstance(body,bytes):headers['Content-Type']='application/octet-stream';payload=body
        elif body is not None:headers['Content-Type']='application/json';payload=json.dumps(body).encode()
        else:payload=None
        try:response=urllib.request.urlopen(urllib.request.Request(base+path,data=payload,headers=headers,method=method),timeout=20)
        except urllib.error.HTTPError as error:response=error
        with response:return response.status,json.loads(response.read())
    account_name=args.project+'_initial_account'
    account=json.loads(backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',
        f'type=volume,src={account_name},dst=/account,readonly',args.expected_image,'-c',"import pathlib;print(pathlib.Path('/account/account.json').read_text())"],capture_output=True).stdout)
    def start_login():
        backup.run(compose+['up','--detach','app'])
        deadline=time.monotonic()+150
        while time.monotonic()<deadline:
            try:
                if request('/api/health')[0]==200:break
            except (urllib.error.URLError,TimeoutError,ConnectionError):pass
            time.sleep(1)
        else:raise AssertionError('Jobs application unhealthy')
        captcha=request('/api/auth/captcha')[1]['data']
        token=request('/api/auth/login',{'username':'admin','password':account['password'],'captchaUuid':captcha['uuid'],'captcha':captcha['code']})[1]['data']['token']
        for _ in range(40):
            value=request('/api/workproof/certificate-jobs/capabilities',token=token)[1]['data']
            if value['ready'] and value['enabled']:return token
            time.sleep(.5)
        raise AssertionError('Jobs not ready')
    prefix='/api/workproof/certificate-jobs'
    def api(path='',body=None,method=None):
        code,value=request(prefix+path,body,token,method)
        assert code==200 and value['code']==200
        return value['data']
    proof=(pathlib.Path(__file__).resolve().parent.parent/'apps/verifier/public/demo/essay.md.wproof').read_bytes()
    retained=None
    try:
        PHASE='lifecycle';token=start_login()
        body={'clientKey':str(uuid.uuid4()),'consent':True,'expectedItems':1}
        job=api(body=body);identity=job['id'];assert api(body=body)['id']==identity
        api('/'+identity+'/items/0',proof,'PUT')
        code,value=request(prefix+'/'+identity+'/items/0',b'changed',token,'PUT')
        assert code==409 and value['code']==409
        api('/'+identity+'/submit',{},'POST')
        for _ in range(100):
            result=api('/'+identity)
            if result['state']=='completed' and not result['cleanupPending']:break
            time.sleep(.3)
        else:raise AssertionError('Real native job did not complete and clean')
        assert result['items'][0]['state']=='saved' and result['items'][0]['cleanupState']=='deleted'
        assert query("SELECT COUNT(*) FROM wp_certificate_job_item WHERE job_id='"+identity+"' AND cleanup_state='deleted';").strip()==b'1'
        PHASE='retained-restart'
        retained=api(body={'clientKey':str(uuid.uuid4()),'consent':True,'expectedItems':1})['id']
        api('/'+retained+'/items/0',proof,'PUT')
        assert api('/'+retained)['state']=='draft'
        backup.run(compose+['stop','--timeout','60','app'])
        token=start_login()
        recovered=api('/'+retained)
        assert recovered['state']=='draft' and recovered['totalItems']==1
        # Keep this genuine uploaded but unsubmitted input for new-project restore
        # acceptance. Starting the app must not implicitly submit a draft.
        assert query("SELECT proof_hash FROM wp_certificate_job_item WHERE job_id='"+retained+"';").strip().decode()==hashlib.sha256(proof).hexdigest()
    finally:
        backup.run(compose+['stop','--timeout','60','app'])
    PHASE='retained-backup'
    # Simulate only the on-disk residual of interrupted upload, never a queued
    # database item. Archive must retain it without promoting it to .proof.
    temporary_token=str(uuid.uuid4())
    fixture="import pathlib,os;p=pathlib.Path('/var/lib/workproof/jobs')/"+repr(temporary_token+'.tmp')+";p.write_bytes(b'interrupted-upload-fixture');os.chmod(p,0o600)"
    backup.run(['docker','run','--rm','--network','none','--user','10001:10001','--entrypoint','python3','--mount',
        f'type=volume,src={data},dst=/var/lib/workproof',args.expected_image,'-c',fixture])
    output=pathlib.Path(args.backup).with_name('after-jobs.enc')
    backup.backup(output,password)
    verify="import sys,snapshot_archive as a;v=a.verify_encrypted_snapshot('/backup/after-jobs.enc',sys.stdin.buffer.readline().rstrip(b'\\n'),work_dir='/backup');p={e['path'] for e in v['entries']};assert 'app_config/jobs.json' in p;assert any(n.endswith('.proof') for n in p);assert any(n.endswith('.tmp') for n in p)"
    backup.run(['docker','run','--rm','-i','--network','none','--user','0:0','--entrypoint','python3','--mount',
        f'type=bind,src={output.parent},dst=/backup',args.expected_image,'-c',verify],input=password+b'\n')
    assert not service('app')['State']['Running']
    # Store only nonsecret fixture IDs privately for a subsequent restore test.
    record=pathlib.Path(args.backup).with_name('jobs-fixture.json')
    with record.open('x') as target:
        os.fchmod(target.fileno(),0o600)
        json.dump({'jobId':retained,'temporaryToken':temporary_token},target)
    print('PASS explicit backed V4 preparation; unchanged source security/catalog; real native job lifecycle; retained draft restart; authenticated proof/tmp backup; app stopped')


if __name__=='__main__':
    try:main()
    except BaseException:
        safe=PHASE if PHASE in {'preflight','prepare','receipt','lifecycle','retained-restart','retained-backup'} else 'unknown'
        print('JOBS_TEST_PHASE='+safe,file=sys.stderr);sys.exit(1)
