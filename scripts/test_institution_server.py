"""Actions-only acceptance of the real prebuilt server image; no user database target."""
import copy, json, os, pathlib, re, secrets, subprocess, time, urllib.error, urllib.request

assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Isolated Actions runner required'
root = pathlib.Path(__file__).resolve().parents[1]
context = (root / '.ci-institution-server').resolve(strict=True)
assert context.parent == root
project = 'workproof-server-ci-' + secrets.token_hex(6)
env = dict(os.environ, COMPOSE_PROJECT_NAME=project, WORKPROOF_HTTP_PORT='18081')
compose = ['docker', 'compose', '--project-directory', str(context), '-f', str(context/'compose.yaml'), '-p', project]
base = 'http://127.0.0.1:18081'
checks = []

def run(*args, ok=True, timeout=180):
    invocation=list(compose)
    if args[0]=='down':
        assert re.fullmatch(r'workproof-server-ci-[0-9a-f]{12}',project)
        # Tool-only volumes (including initial_account) belong to a disabled
        # profile and must be included when removing this isolated CI fixture.
        invocation+=['--profile','tools']
    result = subprocess.run([*invocation, *args], env=env, text=True, capture_output=True, timeout=timeout)
    if ok and result.returncode:
        # Never dump subprocess output: an explicit account command contains a password.
        raise AssertionError('Compose operation failed: ' + args[0])
    return result

def request(path, data=None, token=None):
    headers = {'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    payload=json.dumps(data).encode() if data is not None else None
    try: response=urllib.request.urlopen(urllib.request.Request(base+path,data=payload,headers=headers),timeout=15)
    except urllib.error.HTTPError as error: response=error
    with response: return response.status,response.read()

def login(password):
    captcha=json.loads(request('/api/auth/captcha')[1])['data']
    return json.loads(request('/api/auth/login',{'username':'admin','password':password,'captchaUuid':captcha['uuid'],'captcha':captcha['code']})[1])

def healthy():
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        try:
            if request('/api/health')[0]==200:return
        # Docker can publish the port before Java accepts HTTP connections.
        # A transient reset is not readiness; continue until a real HTTP 200.
        except (urllib.error.URLError,TimeoutError,ConnectionError):pass
        time.sleep(1)
    raise AssertionError('Server container did not become healthy')

try:
    before=run('run','--rm','--no-deps','-T','app',ok=False,timeout=45)
    assert before.returncode != 0 and '未执行数据库初始化' in before.stderr, 'Unprepared app did not reject initialization state'
    run('run','--rm','-T','prepare')
    run('up','-d','database','cache')
    run('run','--rm','-T','initialize',timeout=240)
    account=json.loads(run('run','--rm','-T','account').stdout.strip())
    password=account['password']
    assert account['username']=='admin' and len(password)>=24 and password!='admin123'
    run('up','-d','app');healthy()
    checks.append('Explicit new deployment; random credentials; no implicit app initialization')
    html=request('/')
    assert html[0]==200 and b'<div id="app">' in html[1]
    scripts=re.findall(rb'src="(/assets/[^\"]+\.js)"',html[1]);assert scripts
    assert request(scripts[0].decode())[0]==200
    assert request('/office/index.html')[0]==200
    assert request('/office/manifest-word.xml')[0]==503
    for path in ['/api/auth/me','/api/system/users','/api/workproof/certificates/capabilities']:
        assert request(path)[0]==401
    token=login(password)['data']['token']
    rejected=login('admin123');assert rejected.get('code')!=200 and not (rejected.get('data') or {}).get('token')
    users=json.loads(request('/api/system/users?pageNum=1&pageSize=100',token=token)[1])['data']['rows']
    assert users and any(user['username']=='admin' for user in users)
    assert all(str(user['status'])=='0' for user in users if user['username']!='admin')
    checks.append('Real Vue/Office resources, protected API, random login and default-password refusal')
    proof=json.loads((root/'apps/verifier/public/demo/essay.md.wproof').read_text(encoding='utf-8'))
    report=json.loads(request('/api/workproof/certificates/inspect',proof,token)[1])['data']
    assert report['certificate_valid'] is True and report['artifact_checked'] is False
    bad=copy.deepcopy(proof);bad['records'][1]['event']['inserted']+=1
    assert json.loads(request('/api/workproof/certificates/inspect',bad,token)[1])['data']['certificate_valid'] is False
    status=run('exec','-T','app','cat','/proc/1/status').stdout
    uid=re.search(r'^Uid:\s+(\d+)\s+(\d+)',status,re.M);assert uid and uid.group(1)==uid.group(2)=='10001'
    for service in ['database','cache']:
        identifier=run('ps','-q',service).stdout.strip();assert identifier
        info=json.loads(subprocess.run(['docker','inspect',identifier],capture_output=True,text=True,check=True).stdout)[0]
        assert not any(info['NetworkSettings']['Ports'].values()), 'Data service exposed a host port'
    checks.append('Actual inspector accepts signed proof and rejects tampering; nonroot Java; private database/cache ports')
    repeated=run('run','--rm','-T','prepare',ok=False)
    assert repeated.returncode!=0 and 'Existing credentials or files found' in repeated.stderr
    repeated=run('run','--rm','-T','initialize',ok=False)
    assert repeated.returncode!=0 and 'Already initialized or an earlier attempt' in repeated.stderr
    assert json.loads(run('run','--rm','-T','account').stdout.strip())==account
    run('restart','app');healthy();assert login(password)['data']['token']
    assert json.loads(run('run','--rm','-T','account').stdout.strip())==account
    checks.append('Repeated preparation/import rejected; credentials and database retained across app restart')
    # Capture fixture secrets without placing them in argv or diagnostic output.
    secret_code="import json,pathlib; c=json.loads(pathlib.Path('/private/config/application.json').read_text());print(json.dumps([c['jwt'],c['databasePassword'],pathlib.Path('/private/mysql-root/password').read_text()]))"
    private_values=json.loads(run('run','--rm','--no-deps','-T','--entrypoint','python3','prepare','-c',secret_code).stdout)
    ordinary_logs=run('logs','--no-color','app','database','cache').stdout
    assert all(value not in ordinary_logs for value in [password,*private_values]), 'A generated secret appeared in ordinary service logs'
    checks.append('Generated passwords and JWT absent from ordinary service logs')
    # Include an actual signed proof in the application volume, not just empty
    # directories and configuration files, in the subsequent restore comparison.
    proof_fixture="import os,pathlib; p=pathlib.Path('/var/lib/workproof/jobs');p.mkdir(mode=0o700,exist_ok=True);os.chmod(p,0o700);f=p/'00000000-0000-4000-8000-000000000001.proof';f.write_bytes("+repr(json.dumps(proof,ensure_ascii=False).encode('utf-8'))+");os.chmod(f,0o600)"
    run('exec','-T','app','python3','-c',proof_fixture)
    # Real native dump roundtrip, still confined to this disposable CI database.
    fixture_code="import json,pathlib,pymysql;c=json.loads(pathlib.Path('/private/config/application.json').read_text());db=pymysql.connect(host='database',user='workproof',password=c['databasePassword'],database='workproof',autocommit=True,charset='utf8mb4');cur=db.cursor();cur.execute('CREATE TABLE dump_fixture (id INT PRIMARY KEY, note TEXT NULL, payload BLOB) ENGINE=InnoDB');cur.executemany('INSERT INTO dump_fixture VALUES (%s,%s,%s)',[(1,None,bytes(range(256))),(2,'中文与表情🙂',b'\\x00\\xff')]);db.close()"
    run('run','--rm','-T','--entrypoint','python3','initialize','-c',fixture_code)
    exported=subprocess.run(['bash',str(context/'dump-stopped.sh')],env=env,capture_output=True,timeout=120)
    assert exported.returncode==0 and exported.stdout, 'Stopped native dump failed'
    # Password stays inside the DB container; no SQL dump is written to the runner disk.
    root_access='export MYSQL_PWD="$(cat /private/mysql-root/password)"; '
    restore=root_access+"mysql --user=root --execute='CREATE DATABASE workproof_dump_restore CHARACTER SET utf8mb4'; mysql --user=root --default-character-set=utf8mb4 workproof_dump_restore"
    imported=subprocess.run([*compose,'exec','-T','database','bash','-ec',restore],env=env,input=exported.stdout,capture_output=True,timeout=120)
    assert imported.returncode==0, 'Dump import to the isolated empty schema failed'
    def rows(database):
        assert database in ('workproof','workproof_dump_restore')
        command=root_access+'exec mysqldump --user=root --skip-comments --compact --no-create-info --skip-triggers --skip-extended-insert --order-by-primary --hex-blob --set-gtid-purged=OFF --default-character-set=utf8mb4 '+database
        result=subprocess.run([*compose,'exec','-T','database','bash','-ec',command],env=env,capture_output=True,timeout=120)
        assert result.returncode==0, 'Row comparison could not read the isolated schema'
        return result.stdout
    assert rows('workproof')==rows('workproof_dump_restore'), 'Restored rows differ from stopped source'
    identifier=run('ps','--all','-q','app').stdout.strip()
    assert subprocess.check_output(['docker','inspect','--format','{{.State.Running}}',identifier],text=True).strip()=='false'
    checks.append('Native MySQL dump/import preserves every row including NULL, UTF-8 and binary; app remains stopped')
    # Exercise the host coordinator against this disposable Compose deployment.
    # Output is root-private; no password, SQL or config becomes a public artifact.
    private_backup=subprocess.check_output(['sudo','mktemp','-d','/tmp/workproof-server-backup-ci.XXXXXXXX'],text=True).strip()
    assert re.fullmatch(r'/tmp/workproof-server-backup-ci\.[A-Za-z0-9]{8}',private_backup)
    backup_password=secrets.token_urlsafe(32).encode()
    backup_env=['sudo','env','COMPOSE_PROJECT_NAME='+project]
    try:
        destination=private_backup+'/deployment.wproofbackup'
        backed=subprocess.run([*backup_env,'python3',str(context/'backup_coordinator.py'),'--password-stdin','--output',destination],input=backup_password+b'\n',capture_output=True,timeout=240)
        stage_match=re.search(rb'BACKUP_STAGE=([a-z-]{1,40})',backed.stderr)
        stage=stage_match.group(1).decode() if stage_match else 'unknown'
        assert backed.returncode==0, 'Actual encrypted backup coordinator failed at stage: '+stage
        assert backup_password not in backed.stdout+backed.stderr
        inspect_backup="import pathlib,os,json,sys;import snapshot_archive as s;p=pathlib.Path('/private-backup/deployment.wproofbackup');assert p.stat().st_mode & 0o777 == 0o600;password=sys.stdin.buffer.read().rstrip(b'\\n');m=s.verify_encrypted_snapshot(p,password,work_dir='/private-backup');print(json.dumps({'format':m.get('format'),'source_commit':m.get('source_commit'),'paths':[e['path'] for e in m['entries']]}))"
        verified=subprocess.run(['docker','run','--rm','-i','--user','0:0','--network','none','--mount','type=bind,src='+private_backup+',dst=/private-backup','--entrypoint','python3','workproof-institution:local','-c',inspect_backup],input=backup_password+b'\n',capture_output=True,timeout=120)
        assert verified.returncode==0, 'Encrypted coordinator output did not authenticate and verify'
        inventory=json.loads(verified.stdout)
        assert {'database.sql','app_config/application.json','initial_account/account.json','mysql_root_secret/password','mysql_app_secret/password'}<=set(inventory['paths'])
        assert subprocess.check_output(['docker','inspect','--format','{{.State.Running}}',identifier],text=True).strip()=='false'
        repeated=subprocess.run([*backup_env,'python3',str(context/'backup_coordinator.py'),'--password-stdin','--output',destination],input=backup_password+b'\n',capture_output=True,timeout=30)
        assert repeated.returncode!=0, 'Backup coordinator overwrote an existing snapshot'
        listing=subprocess.check_output(['sudo','find',private_backup,'-mindepth','1','-maxdepth','1','-printf','%f\\n'],text=True).splitlines()
        assert listing==['deployment.wproofbackup'], 'Private staging plaintext remained after backup'
        checks.append('Actual stopped host coordinator publishes authenticated encrypted snapshot, preserves existing output, cleans staging and keeps app stopped; no deployment restore claim')
        image_id=subprocess.check_output(['docker','image','inspect','workproof-institution:local','--format','{{.Id}}'],text=True).strip()
        restored=subprocess.run(['sudo','env','GITHUB_ACTIONS=true','python3',str(root/'scripts/test_restore_new.py'),
            '--input',destination,'--expected-image',image_id,'--expected-commit',os.environ['GITHUB_SHA'],
            '--source-project',project,'--password-stdin'],input=backup_password+b'\n',capture_output=True,timeout=900)
        assert backup_password not in restored.stdout+restored.stderr
        restore_phase=re.search(rb'RESTORE_PHASE=([a-z-]{1,40}); RESTORE_TEST_PHASE=([a-z-]{1,40})',restored.stderr)
        restore_stage='/'.join(part.decode() for part in restore_phase.groups()) if restore_phase else 'unknown'
        assert restored.returncode==0, 'Actual new-project restore acceptance failed at stage: '+restore_stage
        checks.append('Actual new-project restore: authenticated SQL/private volumes, stopped ready state, explicit startup and original login, every-row comparison, collision and wrong-password refusal, source unchanged')
    finally:
        cleanup="import pathlib,shutil,sys; p=pathlib.Path(sys.argv[1]);assert p.parent==pathlib.Path('/tmp') and p.name.startswith('workproof-server-backup-ci.');shutil.rmtree(p)"
        subprocess.run(['sudo','python3','-c',cleanup,private_backup],check=True,capture_output=True)
    # Recreate only this random CI project to exercise a genuinely nonempty database,
    # independently of the already-initialized marker refusal above.
    assert re.fullmatch(r'workproof-server-ci-[0-9a-f]{12}',project)
    run('down','--volumes','--remove-orphans',timeout=120)
    remaining=subprocess.run(['docker','volume','ls','--quiet','--filter','label=com.docker.compose.project='+project],capture_output=True,text=True,check=True).stdout.strip()
    assert not remaining, 'Isolated project volumes remained after full-profile cleanup'
    run('run','--rm','-T','prepare')
    run('up','-d','database','cache')
    connection_code="import json,pathlib,pymysql;c=json.loads(pathlib.Path('/private/config/application.json').read_text());db=pymysql.connect(host='database',user='workproof',password=c['databasePassword'],database='workproof',autocommit=True);cur=db.cursor();"
    run('run','--rm','-T','--entrypoint','python3','initialize','-c',connection_code+"cur.execute('CREATE TABLE setup_sentinel (id INT PRIMARY KEY)');cur.execute('INSERT INTO setup_sentinel VALUES (73)');db.close()",timeout=240)
    occupied=run('run','--rm','-T','initialize',ok=False)
    assert occupied.returncode!=0 and 'The database is not empty' in occupied.stderr
    preserved=run('run','--rm','-T','--entrypoint','python3','initialize','-c',connection_code+"cur.execute('SELECT id FROM setup_sentinel');print(cur.fetchone()[0]);cur.execute('SHOW TABLES');assert len(cur.fetchall())==1;db.close()")
    assert preserved.stdout.strip()=='73'
    checks.append('Nonempty database refused before schema import; original table and row preserved')
    (root/'test-institution-server-results.json').write_text(json.dumps({'scope':'Linux amd64 new deployment only; catalog/jobs/AI disabled; no production or user database touched','checks':checks},indent=2)+'\n',encoding='utf-8')
    print('PASS: real server image, explicit initialization, login, API, inspector, restart and isolation checks')
finally:
    assert re.fullmatch(r'workproof-server-ci-[0-9a-f]{12}',project)
    run('down','--volumes','--remove-orphans',ok=False,timeout=120)
