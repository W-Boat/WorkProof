"""Isolated Actions only: explicit V4, real JAR/MySQL/native worker and crash recovery.
Run after institution runtime fixture initialized V1/V2/V3. No user database allowed.
"""
import hashlib,json,os,pathlib,re,secrets,subprocess,time,urllib.request,urllib.error,uuid,tempfile
assert os.environ.get('GITHUB_ACTIONS')=='true'
assert os.environ.get('DB_NAME')=='workproof_ci'
assert os.environ.get('DB_HOST')=='127.0.0.1'
root=pathlib.Path(__file__).resolve().parents[1]
mysql=['docker','exec','-i','-e','MYSQL_PWD='+os.environ['DB_PASSWORD'],os.environ['MYSQL_CONTAINER_ID'],'mysql','--user=workproof_ci','--default-character-set=utf8mb4','--batch','--skip-column-names','workproof_ci']
def sql(query):return subprocess.run(mysql,input=query,text=True,capture_output=True,check=True).stdout
# Read-only identity and existing V3 inspection before the first V4 write.
assert sql('SELECT DATABASE(),CURRENT_USER();').startswith('workproof_ci\tworkproof_ci@')
ddl=sql('SHOW CREATE TABLE wp_certificate;')
assert all(name in ddl for name in ['owner_user_id','dept_id','proof_hash','uk_wp_certificate_owner_proof','ascii_bin'])
assert re.search(r'UNIQUE KEY `uk_wp_certificate_owner_proof` \(`owner_user_id`,`proof_hash`\)',ddl)
before=sql('SELECT id,username,password,status,deleted FROM sys_user ORDER BY id;')
migration=(root/'services/institution/scaffold-system/sql/V4__workproof_certificate_jobs.sql').read_text()
sql(migration);sql(migration)
assert before==sql('SELECT id,username,password,status,deleted FROM sys_user ORDER BY id;')
jar=next((root/'services/institution/scaffold-system/scaffold-admin/target').glob('scaffold-admin-*.jar'))
password=secrets.token_hex(24)
hashed=subprocess.run(['java','-Dloader.main=com.scaffold.admin.util.LocalPasswordHasher','-cp',str(jar),'org.springframework.boot.loader.launch.PropertiesLauncher'],input=password,text=True,capture_output=True,check=True).stdout.strip()
assert re.fullmatch(r'\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}',hashed)
# Dedicated fixture accounts only; existing credentials remain untouched.
sql("INSERT INTO sys_user(id,username,password,nickname,status,deleted) VALUES(98761,'job_fixture_a','"+hashed+"','job fixture',1,0),(98762,'job_fixture_b','"+hashed+"','job fixture',1,0);INSERT INTO sys_user_role(user_id,role_id) SELECT 98761,id FROM sys_role WHERE role_code='super_admin';INSERT INTO sys_user_role(user_id,role_id) SELECT 98762,id FROM sys_role WHERE role_code='super_admin';")
origin='http://127.0.0.1:18091';base='/api/workproof/certificate-jobs'
process=None
def request(path,token=None,data=None,method=None):
 headers={'Content-Type':'application/octet-stream' if isinstance(data,bytes) else 'application/json'}
 if token:headers['Authorization']='Bearer '+token
 payload=data if isinstance(data,bytes) else json.dumps(data).encode() if data is not None else None
 try:response=urllib.request.urlopen(urllib.request.Request(origin+path,data=payload,headers=headers,method=method),timeout=45)
 except urllib.error.HTTPError as error:response=error
 with response:return response.status,json.loads(response.read())
def login(name):
 captcha=request('/api/auth/captcha')[1]['data']
 return request('/api/auth/login',data=dict(username=name,password=password,captchaUuid=captcha['uuid'],captcha=captcha['code']))[1]['data']['token']
def get(id,token):return request(base+'/'+id,token)[1]['data']
def wait(id,token):
 for _ in range(120):
  result=get(id,token)
  if result['state'] in ['completed','partial','cancelled']:return result
  time.sleep(.5)
 raise AssertionError('Persistent task did not finish')
with tempfile.TemporaryDirectory(prefix='workproof-jobs-ci-') as directory:
 spool=pathlib.Path(directory)/'spool'
 # A real inspector wrapper delays execution to expose a live crash/cancel window.
 native=root/'target/release/workproof-inspector';assert native.is_file()
 wrapper=pathlib.Path(directory)/'workproof-inspector'
 wrapper.write_text('#!/bin/sh\nsleep 2\nexec "'+str(native)+'"\n');wrapper.chmod(0o700)
 environment=dict(os.environ,JWT_SECRET=secrets.token_hex(32),WORKPROOF_CATALOG_ENABLED='true',WORKPROOF_JOBS_ENABLED='true',WORKPROOF_JOBS_SPOOL=str(spool),WORKPROOF_VERIFIER_EXECUTABLE=str(wrapper))
 def start():
  global process
  process=subprocess.Popen(['java','-Xms96m','-Xmx384m','-jar',str(jar),'--server.address=127.0.0.1','--server.port=18091'],env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for _ in range(180):
   assert process.poll() is None
   try:
    if request('/api/health')[0]==200:return
   except (urllib.error.URLError,TimeoutError):pass
   time.sleep(.5)
  raise AssertionError('Jobs fixture startup failed')
 try:
  start();token=login('job_fixture_a');other=login('job_fixture_b')
  for _ in range(30):
   if request(base+'/capabilities',token)[1]['data']['ready']:break
   time.sleep(.5)
  else:raise AssertionError('Jobs not ready')
  proof=(root/'apps/verifier/public/demo/sample.wproof')
  if not proof.exists():proof=next((root/'apps/verifier/public/demo').glob('*.wproof'))
  raw=proof.read_bytes();assert len(raw)<32*1024*1024
  subprocess.run(['node',str(root/'scripts/test_institution_jobs_ui.cjs')],env=dict(os.environ,WORKPROOF_TEST_ORIGIN=origin,WORKPROOF_TEST_TOKEN=token,WORKPROOF_TEST_REAL_JOBS='1',WORKPROOF_JOB_FIXTURE=str(proof)),check=True)
  key=str(uuid.uuid4());body=dict(clientKey=key,consent=True,expectedItems=2)
  job=request(base,token,body)[1]['data'];id=job['id'];assert request(base,token,body)[1]['data']['id']==id
  assert request(base+'/'+id,other)[1]['code']==404
  request(base+'/'+id+'/items/0',token,raw,'PUT')
  assert request(base+'/'+id+'/submit',token,{},'POST')[0]==400
  assert request(base+'/'+id+'/items/0',token,b'changed','PUT')[1]['code']==409
  request(base+'/'+id+'/items/1',token,raw,'PUT');request(base+'/'+id+'/submit',token,{},'POST')
  for _ in range(40):
   if any(item['state']=='running' for item in get(id,token)['items']):break
   time.sleep(.1)
  else:raise AssertionError('No live persisted running item')
  process.kill();process.wait(timeout=15);start();token=login('job_fixture_a')
  result=wait(id,token);assert result['state']=='completed'
  assert len({item['catalogId'] for item in result['items']})==1
  assert all(item['cleanupState']=='deleted' for item in result['items'])
  assert not list(spool.glob('*.proof'))
  cancelled=request(base,token,dict(clientKey=str(uuid.uuid4()),consent=True,expectedItems=1))[1]['data']['id']
  request(base+'/'+cancelled+'/items/0',token,raw,'PUT');request(base+'/'+cancelled+'/submit',token,{},'POST');request(base+'/'+cancelled,token,method='DELETE')
  assert wait(cancelled,token)['state']=='cancelled'
  revoked=request(base,token,dict(clientKey=str(uuid.uuid4()),consent=True,expectedItems=1))[1]['data']['id']
  request(base+'/'+revoked+'/items/0',token,raw,'PUT');sql("UPDATE sys_user SET status=0 WHERE id=98761;")
  # Seal via SQL only to model durable accepted work immediately before revocation.
  sql("UPDATE wp_certificate_job SET state='queued' WHERE id='"+revoked+"';")
  for _ in range(60):
   if 'PERMISSION_REVOKED' in sql("SELECT result_code FROM wp_certificate_job_item WHERE job_id='"+revoked+"';"):break
   time.sleep(.5)
  else:raise AssertionError('Revoked owner work was not refused')
  for _ in range(30):
   if not list(spool.glob('*.proof')):break
   time.sleep(.2)
  assert not list(spool.glob('*.proof'))
  assert int(sql("SELECT COUNT(*) FROM sys_oper_log WHERE module='证书后台任务' AND request_method='BACKGROUND' AND action='后台任务结束';").strip())>=1,'No completed background audit event'
  assert int(sql("SELECT COUNT(*) FROM sys_oper_log WHERE module='证书后台任务' AND request_method='BACKGROUND' AND (request_params IS NULL OR request_params<>'[]');").strip())==0,'Background audit copied unexpected input'
  print('PASS: V4 isolated identity checks, durable real-native recovery, owner isolation, immutable upload, expected count, deduplication, cancellation, permission revocation and cleanup')
 finally:
  if process and process.poll() is None:process.terminate();process.wait(timeout=35)
