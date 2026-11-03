"""Actual Actions-only new-project restore acceptance against a CI backup.

Requires a backup from the disposable workproof-server-ci-* source project. Never
selects a deployment implicitly. Creates and cleans only randomly named fixtures
whose exact ownership labels are verified. No secrets enter diagnostic output.
"""
import argparse
import json
import os
import pathlib
import re
import secrets
import signal
import stat
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'deploy/institution'))
import restore_new as restore

TEST_PHASE = 'preflight'
TEST_PHASES = {'preflight', 'guard-checks', 'restore', 'ready-stopped', 'database-start', 'explicit-start',
               'row-comparison', 'login', 'private-readback', 'refusal-existing-project',
               'refusal-wrong-passphrase', 'refusal-existing-volume', 'source-check', 'cleanup', 'completed',
               'jobs-ready', 'jobs-submit', 'jobs-complete', 'jobs-running-recovery', 'ai-disabled'}
RESTORE_PHASES = {'preflight', 'authenticate', 'create-owned-volumes', 'install-private-volumes',
                  'start-new-database', 'import-new-database', 'verify-restored-database'}


def guard_checks(parent):
    private = parent / 'invalid-json'
    for raw in (b'{"jwt":"first","jwt":"second"}', b'{"value":NaN}',
                b'{"nested":{"value":Infinity}}', b'{"value":1e999}'):
        private.write_bytes(raw)
        try:
            restore._read_private_json(private)
        except restore.RestoreNewError:
            pass
        else:
            raise AssertionError('Invalid private JSON was accepted')
    private.unlink()
    original = {signum: signal.getsignal(signum) for signum in restore.CANCEL_SIGNALS}
    previous = restore._set_cancel_handlers(restore._cancel)
    try:
        for signum in restore.CANCEL_SIGNALS:
            try:
                signal.raise_signal(signum)
            except restore.RestoreNewError:
                pass
            else:
                raise AssertionError('Cancellation signal was ignored')
    finally:
        restore._restore_cancel_handlers(previous)
    assert all(signal.getsignal(signum) == handler for signum, handler in original.items())


def rows(identity):
    script = 'export MYSQL_PWD="$(cat /private/mysql-root/password)"; exec mysqldump --user=root --skip-comments --compact --no-create-info --skip-triggers --skip-extended-insert --order-by-primary --hex-blob --set-gtid-purged=OFF --default-character-set=utf8mb4 workproof'
    return restore.run(['docker', 'exec', identity, 'bash', '-ec', script], capture=True)


def request(base, path, data=None, token=None, method=None):
    encoded = data if isinstance(data,bytes) else json.dumps(data).encode() if data is not None else None
    headers = {'Content-Type': 'application/octet-stream' if isinstance(data,bytes) else 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    try:
        response = urllib.request.urlopen(urllib.request.Request(base + path, data=encoded,
            headers=headers, method=method), timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read()


def read_jobs_fixture(path):
    parent, absolute = restore._path_parent(path,private=True)
    try:
        fd=os.open(absolute.name,os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,dir_fd=parent)
    finally:
        os.close(parent)
    with os.fdopen(fd,'rb') as source:
        info=os.fstat(source.fileno())
        assert (stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==0 and info.st_gid==0 and
                stat.S_IMODE(info.st_mode)==0o600 and info.st_size<=4096)
        raw=source.read(4097)
        assert len(raw)<=4096
    value=json.loads(raw,object_pairs_hook=restore._unique_json,parse_constant=restore._nonfinite_json)
    assert type(value) is dict and set(value)=={'jobId','temporaryToken','runningJobId'}
    for item in value.values():
        assert isinstance(item,str) and re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',item)
    return value


def main():
    global TEST_PHASE
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and sys.platform.startswith('linux') and os.geteuid() == 0
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('input', 'expected-image', 'expected-commit', 'source-project'):
        parser.add_argument('--' + option, required=True)
    parser.add_argument('--password-stdin', action='store_true', required=True)
    parser.add_argument('--jobs-fixture')
    args = parser.parse_args()
    jobs_fixture=read_jobs_fixture(args.jobs_fixture) if args.jobs_fixture else None
    assert re.fullmatch('workproof-server-ci-[0-9a-f]{12}', args.source_project), 'Only isolated CI source accepted'
    raw = sys.stdin.buffer.read(1026)
    assert raw.endswith(b'\n')
    password = raw[:-1]
    source_ids = restore.run(['docker', 'ps', '--all', '--no-trunc', '--quiet', '--filter',
                             'label=com.docker.compose.project=' + args.source_project,
                             '--filter', 'label=com.docker.compose.service=database'], capture=True).decode().splitlines()
    assert len(source_ids) == 1
    source_rows = rows(source_ids[0])
    source_apps = restore.run(['docker', 'ps', '--all', '--no-trunc', '--quiet', '--filter',
                              'label=com.docker.compose.project=' + args.source_project,
                              '--filter', 'label=com.docker.compose.service=app'], capture=True).decode().splitlines()
    assert len(source_apps) == 1 and not restore.inspect(source_apps[0])['State']['Running']
    project = 'workproof-restore-ci-' + secrets.token_hex(6)
    wrong_project = 'workproof-restore-ci-' + secrets.token_hex(6)
    collision_project = 'workproof-restore-ci-' + secrets.token_hex(6)
    token = None
    state = None
    collision_name = collision_project + '_app_config'
    collision_token = secrets.token_hex(32)
    previous_port = os.environ.get('WORKPROOF_HTTP_PORT')
    os.environ['WORKPROOF_HTTP_PORT'] = '18082'
    with tempfile.TemporaryDirectory(prefix='workproof-new-restore-ci-') as temporary:
        parent = pathlib.Path(temporary)
        parent.chmod(0o700)
        try:
            TEST_PHASE = 'guard-checks'
            guard_checks(parent)
            TEST_PHASE = 'restore'
            state = parent / 'restored'
            record = restore.restore_new(args.input, project, state, password, args.expected_image, args.expected_commit)
            token = record['owner']
            has_jobs=(state/'stage/app_config/jobs.json').exists()
            assert not has_jobs or jobs_fixture is not None, 'Jobs restore requires explicit private fixture'
            assert not jobs_fixture or has_jobs, 'Jobs fixture requires jobs-enabled backup'
            if has_jobs:
                spool=state/'stage/app_data/jobs'
                assert (spool/(jobs_fixture['temporaryToken']+'.tmp')).read_bytes()==b'interrupted-upload-fixture'
                assert not (spool/(jobs_fixture['temporaryToken']+'.proof')).exists()
            TEST_PHASE = 'ready-stopped'
            assert record['status'] == 'ready-to-start'
            assert json.loads((state / 'state.json').read_text()) == record
            assert state.stat().st_uid == 0 and state.stat().st_mode & 0o777 == 0o700
            values = restore.owned_containers(project, token)
            assert len(values) == 1 and not values[0]['State']['Running']
            assert values[0]['Config']['Labels']['com.docker.compose.service'] == 'database'
            pinned = json.loads((state / 'compose.json').read_text())['services']
            assert set(record['runtime_image_ids']) == {'database', 'cache', 'app'}
            assert record['runtime_image_ids']['app'] == args.expected_image
            for name, service in pinned.items():
                assert service['image'] == record['runtime_image_ids'][name]
                assert re.fullmatch('sha256:[0-9a-f]{64}', service['image'])
                assert service['pull_policy'] == 'never'
            assert values[0]['Image'] == record['runtime_image_ids']['database']
            target_db = values[0]['Id']
            volume_ids = restore.run(['docker', 'volume', 'ls', '--quiet', '--filter',
                                     'label=com.docker.compose.project=' + project], capture=True).decode().splitlines()
            assert set(volume_ids) == {project + '_' + role for role in restore.ROLES}
            for name in volume_ids:
                assert restore.inspect(name, 'volume')['Labels'][restore.LABEL] == token
            # Product performs no application startup. This explicit acceptance
            # step starts only the verified disposable target, on another port.
            compose = ['docker', 'compose', '--file', str(state / 'compose.json'), '--project-name', project]
            # Compare the restored snapshot before application startup can add
            # audit rows or run background work. Login is verified afterwards.
            TEST_PHASE = 'database-start'
            restore.run(compose + ['up', '--detach', '--no-deps', 'database'])
            database_deadline = time.monotonic() + 120
            while time.monotonic() < database_deadline:
                if restore.inspect(target_db)['State'].get('Health', {}).get('Status') == 'healthy':
                    break
                time.sleep(1)
            else:
                raise AssertionError('Restored database did not become healthy')
            TEST_PHASE = 'row-comparison'
            assert rows(target_db) == source_rows, 'Every restored SQL row must match stopped source'
            if has_jobs:
                running_id=jobs_fixture['runningJobId']
                running_sql="SELECT state,attempts,cleanup_state,spool_token,proof_hash,proof_bytes FROM wp_certificate_job_item WHERE job_id='"+running_id+"' AND item_index=0"
                def raw_query(database,sql):
                    command='export MYSQL_PWD="$(cat /private/mysql-root/password)"; exec mysql --user=root --database=workproof --batch --skip-column-names --execute="'+sql+'"'
                    return restore.run(['docker','exec',database,'bash','-ec',command],capture=True).strip()
                source_running=raw_query(source_ids[0],running_sql)
                assert raw_query(target_db,running_sql)==source_running
                running_fields=source_running.decode().split('\t')
                assert len(running_fields)==6 and running_fields[0]=='running' and int(running_fields[1])>=1 and running_fields[2]=='retained'
                assert re.fullmatch('[0-9a-f-]{36}',running_fields[3]) and re.fullmatch('[0-9a-f]{64}',running_fields[4])
                source_proof_check="import pathlib,hashlib;f=pathlib.Path('/data/jobs')/"+repr(running_fields[3]+'.proof')+";assert f.stat().st_size=="+str(int(running_fields[5]))+";assert hashlib.sha256(f.read_bytes()).hexdigest()=="+repr(running_fields[4])
                source_app=restore.inspect(source_apps[0])
                source_data=[mount['Name'] for mount in source_app['Mounts'] if mount['Destination']=='/var/lib/workproof' and mount['Type']=='volume']
                assert len(source_data)==1
            # Read back every installed private volume object and compare its
            # content/ownership/mode to the authenticated stage, without logging it.
            verify = """import hashlib,os,pathlib,stat
import snapshot_archive as a
s=pathlib.Path('/stage')
for role in a.ROOTS:
 expected={p.relative_to(s/role).as_posix() for p in (s/role).rglob('*')}
 actual={p.relative_to(pathlib.Path('/target')/role).as_posix() for p in (pathlib.Path('/target')/role).rglob('*')}
 assert actual==expected
 for source in [s/role,*sorted((s/role).rglob('*'))]:
  target=pathlib.Path('/target')/source.relative_to(s)
  x,y=source.lstat(),target.lstat()
  assert (x.st_uid,x.st_gid,stat.S_IMODE(x.st_mode),stat.S_ISDIR(x.st_mode))==(y.st_uid,y.st_gid,stat.S_IMODE(y.st_mode),stat.S_ISDIR(y.st_mode))
  if source.is_file():assert source.read_bytes()==target.read_bytes()
"""
            mounts = [f'type=bind,src={state / "stage"},dst=/stage,readonly']
            TEST_PHASE = 'private-readback'
            mounts += [f'type=volume,src={project}_{role},dst=/target/{role},readonly' for role in restore.ROLES]
            command = ['docker', 'run', '--rm', '--network', 'none', '--user', '0:0', '--entrypoint', 'python3']
            for mount in mounts:
                command += ['--mount', mount]
            restore.run(command + [args.expected_image, '-c', verify])
            TEST_PHASE = 'explicit-start'
            restore.run(compose + ['up', '--detach', 'database', 'cache', 'app'])
            base = 'http://127.0.0.1:18082'
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                try:
                    if request(base, '/api/health')[0] == 200:
                        break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    pass
                time.sleep(1)
            else:
                raise AssertionError('Explicitly started restored application did not become healthy')
            TEST_PHASE = 'login'
            account = json.loads((state / 'stage/initial_account/account.json').read_text())
            captcha = json.loads(request(base, '/api/auth/captcha')[1])['data']
            result = json.loads(request(base, '/api/auth/login', {'username': 'admin', 'password': account['password'],
                'captchaUuid': captcha['uuid'], 'captcha': captcha['code']})[1])
            assert (result.get('data') or {}).get('token'), 'Restored original credentials did not log in'
            if (state / 'stage/app_config/ai.json').exists():
                TEST_PHASE = 'ai-disabled'
                status, payload = request(base, '/api/workproof/analysis/capabilities', token=result['data']['token'])
                envelope = json.loads(payload)
                assert status == 200 and envelope['code'] == 200
                capabilities = envelope['data']
                assert {engine['id'] for engine in capabilities['engines']} == {'mpu-en-v3','mpu-zh-v3','desklib-en-v1.01'}
                assert all(engine['configured'] is False for engine in capabilities['engines'])
                restored_compose = json.loads((state / 'compose.json').read_text())
                assert 'WORKPROOF_AI_ACTIVATE' not in restored_compose['services']['app'].get('environment', {})
                # The public API exposes per-engine configured, not a global
                # enabled field. Also prove a consented submission is refused.
                status, payload = request(base, '/api/workproof/analysis/tasks/mpu-en-v3/txt?consent=true',
                    data=b'Synthetic disabled-engine refusal fixture.', token=result['data']['token'])
                refused = json.loads(payload)
                assert status == 503 and refused['code'] == 503 and not refused.get('data')
            if (state / 'stage/app_config/catalog.json').exists():
                status, payload = request(base, '/api/workproof/certificates/status', token=result['data']['token'])
                assert status == 200 and json.loads(payload)['data']['ready'] is True
            if has_jobs:
                actor=result['data']['token']
                def jobs_api(path,body=None,method=None):
                    status,payload=request(base,'/api/workproof/certificate-jobs'+path,body,actor,method)
                    parsed=json.loads(payload)
                    assert status==200 and parsed['code']==200
                    return parsed['data']
                TEST_PHASE='jobs-ready'
                deadline=time.monotonic()+30
                while time.monotonic()<deadline:
                    capability=jobs_api('/capabilities')
                    if capability['enabled'] and capability['ready']:break
                    time.sleep(.5)
                else:raise AssertionError('Restored Java jobs not ready')
                TEST_PHASE='jobs-running-recovery'
                deadline=time.monotonic()+45
                while time.monotonic()<deadline:
                    recovered=jobs_api('/'+jobs_fixture['runningJobId'])
                    if recovered['state']=='completed' and not recovered['cleanupPending']:break
                    time.sleep(.3)
                else:raise AssertionError('Restored running item did not automatically recover')
                assert len(recovered['items'])==1 and recovered['items'][0]['state']=='saved'
                assert recovered['items'][0]['cleanupState']=='deleted' and recovered['items'][0]['catalogId'] is not None
                recovered_fields=raw_query(target_db,running_sql).decode().split('\t')
                assert recovered_fields[0]=='saved' and int(recovered_fields[1])>=2 and recovered_fields[2]=='deleted'
                # No submit call has been made for runningJobId. Only the retained
                # draft below receives explicit submit after recovery is verified.
                job=jobs_fixture['jobId'];temporary_token=jobs_fixture['temporaryToken']
                original=jobs_api('/'+job)
                assert original['state']=='draft' and original['totalItems']==1 and original['expectedItems']==1
                assert len(original['items'])==1 and original['items'][0]['state']=='queued'
                TEST_PHASE='jobs-submit'
                jobs_api('/'+job+'/submit',{},'POST')
                TEST_PHASE='jobs-complete'
                deadline=time.monotonic()+45
                while time.monotonic()<deadline:
                    completed=jobs_api('/'+job)
                    if completed['state']=='completed' and not completed['cleanupPending']:break
                    time.sleep(.3)
                else:raise AssertionError('Restored retained job did not finish real native check')
                assert completed['items'][0]['state']=='saved' and completed['items'][0]['cleanupState']=='deleted'
                # temporary_token is validated canonical UUID before entering this
                # fixed query. No receipt/input supplies executable SQL text.
                sql="SELECT COUNT(*) FROM wp_certificate_job_item WHERE spool_token='"+temporary_token+"'"
                command='export MYSQL_PWD="$(cat /private/mysql-root/password)"; exec mysql --user=root --database=workproof --batch --skip-column-names --execute="'+sql+'"'
                assert restore.run(['docker','exec',target_db,'bash','-ec',command],capture=True).strip()==b'0'
                check_tmp="import pathlib;p=pathlib.Path('/data/jobs');assert not (p/"+repr(temporary_token+'.proof')+").exists();f=p/"+repr(temporary_token+'.tmp')+";assert not f.exists() or f.read_bytes()==b'interrupted-upload-fixture'"
                restore.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',
                    f'type=volume,src={project}_app_data,dst=/data,readonly',args.expected_image,'-c',check_tmp])
            for value in restore.owned_containers(project, token):
                service = value['Config']['Labels']['com.docker.compose.service']
                assert value['Image'] == record['runtime_image_ids'][service]
            # Stop the disposable target app before taking the refusal baseline:
            # asynchronous audit writes must settle before equality comparisons.
            restore.run(compose + ['stop', '--timeout', '60', 'app'])
            applications = [value for value in restore.owned_containers(project, token)
                            if value['Config']['Labels'].get('com.docker.compose.service') == 'app']
            assert len(applications) == 1 and not applications[0]['State']['Running']
            post_login_rows = rows(target_db)
            # Reusing a project is rejected before any destination-state write.
            refused_state = parent / 'must-not-exist'
            TEST_PHASE = 'refusal-existing-project'
            try:
                restore.restore_new(args.input, project, refused_state, password, args.expected_image, args.expected_commit)
            except restore.RestoreNewError:
                pass
            else:
                raise AssertionError('Existing restored project was accepted')
            assert not refused_state.exists()
            assert rows(target_db) == post_login_rows
            # A bad passphrase creates only a retained private failure marker;
            # it must create no project container, volume or network.
            wrong_state = parent / 'wrong-passphrase'
            TEST_PHASE = 'refusal-wrong-passphrase'
            try:
                restore.restore_new(args.input, wrong_project, wrong_state, b'wrong-long-passphrase-value', args.expected_image, args.expected_commit)
            except restore.RestoreNewError:
                pass
            else:
                raise AssertionError('Wrong passphrase was accepted')
            wrong_record = json.loads((wrong_state / 'state.json').read_text())
            assert wrong_record['status'] == 'failed-retained'
            assert not (wrong_state / 'stage').exists()
            restore.preflight(wrong_project)
            # Refuse even an unlabelled existing deterministic target volume.
            TEST_PHASE = 'refusal-existing-volume'
            restore.run(['docker', 'volume', 'create', '--label', restore.LABEL + '=' + collision_token, collision_name])
            try:
                restore.restore_new(args.input, collision_project, parent / 'collision', password, args.expected_image, args.expected_commit)
            except restore.RestoreNewError:
                pass
            else:
                raise AssertionError('Existing target volume was accepted')
            assert not (parent / 'collision').exists()
            assert restore.inspect(collision_name, 'volume')['Labels'][restore.LABEL] == collision_token
            TEST_PHASE = 'source-check'
            assert rows(source_ids[0]) == source_rows
            assert not restore.inspect(source_apps[0])['State']['Running']
            if has_jobs:
                assert raw_query(source_ids[0],running_sql)==source_running
                restore.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',
                    f'type=volume,src={source_data[0]},dst=/data,readonly',args.expected_image,'-c',source_proof_check])
            print('PASS new-project authenticated SQL/private-volume restore; stopped ready state; explicit startup and original login; every SQL row; existing-project/volume and wrong-passphrase refusal; source untouched')
        finally:
            # Preserve the primary failing phase when cleanup succeeds. Cleanup
            # errors receive their own fixed code without printing exception text.
            failing_phase = TEST_PHASE
            TEST_PHASE = 'cleanup'
            if previous_port is None:
                os.environ.pop('WORKPROOF_HTTP_PORT', None)
            else:
                os.environ['WORKPROOF_HTTP_PORT'] = previous_port
            # This cleanup is solely for random Actions acceptance fixtures,
            # separate from the product's deliberate failure-retention policy.
            if state and (state / 'state.json').exists():
                record = json.loads((state / 'state.json').read_text())
                token = record['owner']
                assert record['project'] == project and re.fullmatch('workproof-restore-ci-[0-9a-f]{12}', project)
                values = restore.owned_containers(project, token)
                for value in values:
                    restore.run(['docker', 'rm', '--force', value['Id']])
                network_ids = restore.run(['docker', 'network', 'ls', '--quiet', '--filter',
                                          'label=com.docker.compose.project=' + project], capture=True).decode().splitlines()
                for identity in network_ids:
                    value = restore.inspect(identity, 'network')
                    assert value['Name'] == project + '_default' and value['Labels'][restore.LABEL] == token
                    restore.run(['docker', 'network', 'rm', identity])
                for role in restore.ROLES:
                    name = project + '_' + role
                    present = restore.run(['docker', 'volume', 'ls', '--format', '{{.Name}}'], capture=True).decode().splitlines()
                    if name in present:
                        assert restore.inspect(name, 'volume')['Labels'][restore.LABEL] == token
                        restore.run(['docker', 'volume', 'rm', name])
            present = restore.run(['docker', 'volume', 'ls', '--format', '{{.Name}}'], capture=True).decode().splitlines()
            if collision_name in present:
                assert restore.inspect(collision_name, 'volume')['Labels'][restore.LABEL] == collision_token
                restore.run(['docker', 'volume', 'rm', collision_name])
            TEST_PHASE = failing_phase
    TEST_PHASE = 'completed'


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        phase = restore.PHASE if restore.PHASE in RESTORE_PHASES else 'unknown'
        test_phase = TEST_PHASE if TEST_PHASE in TEST_PHASES else 'unknown'
        print('RESTORE_PHASE=' + phase + '; RESTORE_TEST_PHASE=' + test_phase, file=sys.stderr)
        sys.exit(1)
