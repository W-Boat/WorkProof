"""Explicit backed-up V4 migration; never start app or replay partial DDL."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import signal
import stat
import subprocess
import sys
import time

PHASE='preflight'
PHASES={'preflight','backup','prepare-v4','verify-stopped'}
SQL_NAME='V4__workproof_certificate_jobs.sql'


def verify_schema(cursor):
    tables = {
      'wp_certificate_job': [('id','char',36,False),('owner_user_id','bigint',None,False),('dept_id','bigint',None,True),
        ('owner_name','varchar',64,False),('client_key','char',36,False),('state','varchar',24,False),
        ('cancel_requested','tinyint',None,False),('expected_items','int',None,False),('total_bytes','bigint',None,False),
        ('manifest_hash','char',64,True),('create_by','varchar',64,True),('update_by','varchar',64,True),
        ('create_time','datetime',None,False),('update_time','datetime',None,False)],
      'wp_certificate_job_item': [('job_id','char',36,False),('item_index','int',None,False),('spool_token','char',36,False),
        ('proof_hash','char',64,False),('proof_bytes','bigint',None,False),('state','varchar',24,False),
        ('claim_token','char',36,True),('attempts','int',None,False),('entry_id','bigint',None,True),
        ('result_code','varchar',48,True),('cleanup_state','varchar',16,False),('create_by','varchar',64,True),
        ('update_by','varchar',64,True),('create_time','datetime',None,False),('update_time','datetime',None,False)]}
    indexes = {'wp_certificate_job': {'PRIMARY':(['id'],0),'uk_wp_job_owner_key':(['owner_user_id','client_key'],0),
          'idx_wp_job_state':(['state','create_time'],1),'idx_wp_job_owner':(['owner_user_id','create_time'],1)},
        'wp_certificate_job_item': {'PRIMARY':(['job_id','item_index'],0),'uk_wp_job_spool':(['spool_token'],0),
          'idx_wp_job_item_state':(['state','cleanup_state'],1)}}
    defaults = {'wp_certificate_job':{'state':'draft','cancel_requested':'0','total_bytes':'0'},
                'wp_certificate_job_item':{'state':'queued','attempts':'0','cleanup_state':'retained'}}
    for table,expected in tables.items():
        cursor.execute('SELECT COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH,IS_NULLABLE,COLLATION_NAME,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION',(table,))
        rows=cursor.fetchall()
        if [(r[0],r[1],r[2],r[3]=='YES') for r in rows] != expected:
            raise RuntimeError('V4 columns differ')
        for row in rows:
            if row[1]=='char' and row[4]!='ascii_bin':
                raise RuntimeError('V4 collation differs')
            if row[0] in defaults[table] and str(row[5]) != defaults[table][row[0]]:
                raise RuntimeError('V4 defaults differ')
            if row[0] in ('create_time','update_time'):
                if str(row[5]).lower() not in ('current_timestamp()','current_timestamp'):
                    raise RuntimeError('V4 timestamp default differs')
                if row[0]=='update_time' and 'on update current_timestamp' not in row[6].lower():
                    raise RuntimeError('V4 update timestamp differs')
        cursor.execute('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s',(table,))
        if cursor.fetchone()!=('InnoDB',):
            raise RuntimeError('V4 engine differs')
        cursor.execute('SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s ORDER BY INDEX_NAME,SEQ_IN_INDEX',(table,))
        actual={}
        for name,column,non_unique,prefix in cursor.fetchall():
            actual.setdefault(name,[]).append((column,non_unique,prefix))
        wanted={name:[(column,unique,None) for column in columns] for name,(columns,unique) in indexes[table].items()}
        if actual!=wanted:
            raise RuntimeError('V4 indexes differ')
    cursor.execute("SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='wp_certificate_job_item' AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.ORDINAL_POSITION")
    if cursor.fetchall() != (('fk_wp_job_item','job_id','workproof','wp_certificate_job','id','NO ACTION','NO ACTION'),):
        raise RuntimeError('V4 foreign key differs')


def verify_spool(path, create=False):
    parent=path.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=10001 or parent.st_gid!=10001 or stat.S_IMODE(parent.st_mode)!=0o700):
        raise RuntimeError('Unsafe application data volume')
    if not os.path.lexists(path) and create:
        path.mkdir(mode=0o700)
        os.chown(path,10001,10001);path.chmod(0o700)
    info=path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid!=10001 or info.st_gid!=10001 or stat.S_IMODE(info.st_mode)!=0o700):
        raise RuntimeError('Unsafe existing spool')
    for entry in path.iterdir():
        info=entry.lstat()
        if (entry.name!='.queue.lock' and not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(proof|tmp)',entry.name)):
            raise RuntimeError('Unknown spool entry')
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=10001 or info.st_gid!=10001 or
                stat.S_IMODE(info.st_mode)!=0o600 or info.st_dev!=path.stat().st_dev):
            raise RuntimeError('Unsafe spool entry')


def verify_spool_references(cursor,path):
    """Read-only restore/startup check before the worker can recover running work.

    Pending/error cleanup can legitimately lack a file after deletion but before
    its DB update. Retained inputs must exist and match; orphan .tmp is never used.
    """
    verify_spool(path)
    cursor.execute("SELECT spool_token,proof_hash,proof_bytes FROM wp_certificate_job_item WHERE cleanup_state='retained'")
    root=os.open(path,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for token,digest,length in cursor.fetchall():
            if (not isinstance(token,str) or not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',token) or
                    not isinstance(digest,str) or not re.fullmatch('[0-9a-f]{64}',digest) or
                    type(length) is not int or not 0<=length<=32*1024**2):
                raise RuntimeError('Invalid retained input identity')
            fd=os.open(token+'.proof',os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,dir_fd=root)
            with os.fdopen(fd,'rb') as source:
                before=os.fstat(source.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_size!=length:
                    raise RuntimeError('Retained input size differs')
                actual=hashlib.sha256()
                remaining=length
                while remaining:
                    block=source.read(min(1024**2,remaining))
                    if not block:raise RuntimeError('Retained input truncated')
                    actual.update(block);remaining-=len(block)
                after=os.fstat(source.fileno())
                if (source.read(1) or actual.hexdigest()!=digest or
                        (before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=
                        (after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)):
                    raise RuntimeError('Retained input changed')
    finally:os.close(root)


def internal(commit,image,backup_digest):
    import catalog_receipt as catalog
    import catalog_prepare
    import jobs_receipt as receipt
    import manage
    import pymysql
    from pymysql.constants import CLIENT
    with manage.exclusive():
        config_dir=manage.CONFIG
        if any(os.path.lexists(config_dir/name) for name in ('.initializing',catalog.PENDING,receipt.PENDING,receipt.PREPARED)):
            raise RuntimeError('Interrupted or existing preparation')
        v3=catalog.read(config_dir/catalog.PREPARED)
        v3bytes=(config_dir/catalog.PREPARED).read_bytes()
        initialized=manage.read_json(config_dir/'initialized.json',10001)
        v1=pathlib.Path('/opt/workproof/sql/V1__init_schema.sql').read_text(encoding='utf-8-sig')
        if (v3['schemaSha256']!=initialized['schemaSha256'] or v3['schemaSha256']!=hashlib.sha256(v1.encode()).hexdigest() or
                v3['migrationSha256']!=hashlib.sha256(pathlib.Path('/opt/workproof/sql',catalog_prepare.SQL_NAME).read_bytes()).hexdigest()):
            raise RuntimeError('V3 provenance differs')
        config=manage.read_json(config_dir/'application.json',10001)
        spool=pathlib.Path(receipt.SPOOL)
        if os.path.lexists(spool):verify_spool(spool)
        migration=pathlib.Path('/opt/workproof/sql',SQL_NAME).read_bytes()
        connection=pymysql.connect(host='database',user='workproof',password=config['databasePassword'],database='workproof',
            charset='utf8mb4',autocommit=True,client_flag=CLIENT.MULTI_STATEMENTS,connect_timeout=10,read_timeout=300,write_timeout=30)
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT DATABASE(),CURRENT_USER()');identity=cursor.fetchone()
                if identity[0]!='workproof' or not identity[1].startswith('workproof@'):raise RuntimeError('Database differs')
                catalog_prepare.verify_schema(cursor)
                cursor.execute("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('wp_certificate_job','wp_certificate_job_item')")
                if cursor.fetchone()[0]!=0:raise RuntimeError('Unknown existing V4 tables')
                def baseline():
                    values=[]
                    for table in ('sys_user','sys_role','sys_user_role','sys_role_menu','wp_certificate'):
                        cursor.execute('SELECT * FROM '+table+' ORDER BY 1,2');values.append(cursor.fetchall())
                    return values
                before=baseline()
                value={'format':receipt.FORMAT,'status':'applying','sourceCommit':commit,'imageId':image,
                    'migrationSha256':hashlib.sha256(migration).hexdigest(),'schemaSha256':initialized['schemaSha256'],
                    'catalogReceiptSha256':hashlib.sha256(v3bytes).hexdigest(),'backupSha256':backup_digest,
                    'spoolPath':receipt.SPOOL,'startedAt':int(time.time()),'completedAt':None}
                receipt.validate(json.dumps(value),True)
                manage.create_file(config_dir/receipt.PENDING,json.dumps(value))
                directory=os.open(config_dir,os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                    verify_spool(spool,create=True)
                    cursor.execute(migration.decode('utf-8-sig'))
                    while cursor.nextset():pass
                    verify_schema(cursor)
                    if baseline()!=before or (config_dir/catalog.PREPARED).read_bytes()!=v3bytes:raise RuntimeError('Existing data changed')
                    value.update(status='prepared',completedAt=int(time.time()))
                    receipt.validate(json.dumps(value))
                    manage.create_file(config_dir/receipt.PREPARED,json.dumps(value),owner=10001)
                    os.fsync(directory);(config_dir/receipt.PENDING).unlink();os.fsync(directory)
                finally:os.close(directory)
        finally:connection.close()


def prepare(project,backup_path,password,expected_image,expected_commit):
    global PHASE
    import backup_coordinator as backup
    if not sys.platform.startswith('linux') or os.geteuid()!=0 or not re.fullmatch('[a-z0-9][a-z0-9_-]*',project):
        raise RuntimeError('Linux root and explicit project required')
    if os.environ.get('COMPOSE_PROJECT_NAME')!=project:raise RuntimeError('Project environment differs')
    compose=['docker','compose','--file',str(pathlib.Path(__file__).with_name('compose.yaml'))]
    def service(name):
        identity=backup.run(compose+['ps','--all','--quiet',name],capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{12,64}',identity):raise RuntimeError('Expected one service')
        value=backup.inspect(identity)
        if value['Config']['Labels'].get('com.docker.compose.project')!=project:raise RuntimeError('Service project differs')
        return value
    app,database=service('app'),service('database')
    if (app['Image']!=expected_image or not re.fullmatch('sha256:[0-9a-f]{64}',expected_image) or
            not re.fullmatch('[0-9a-f]{40}',expected_commit) or
            backup.inspect(expected_image)['Config']['Labels'].get('org.opencontainers.image.revision')!=expected_commit):raise RuntimeError('Image identity differs')
    config=backup.volume(app,'/private/config');data=backup.volume(app,'/var/lib/workproof')
    networks=database['NetworkSettings']['Networks']
    if len(networks)!=1:raise RuntimeError('Expected dedicated network')
    network=next(iter(networks.values()))['NetworkID']
    info=json.loads(backup.run(['docker','network','inspect',network],capture_output=True).stdout)[0]
    if info.get('Labels',{}).get('com.docker.compose.project')!=project:raise RuntimeError('Network differs')
    probe="import pathlib,os,catalog_receipt as c; p=pathlib.Path('/private/config');c.read(p/c.PREPARED);assert not any(os.path.lexists(p/n) for n in ('.initializing',c.PENDING,'.jobs-preparing.json','jobs.json'))"
    backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',
        f'type=volume,src={config},dst=/private/config,readonly',expected_image,'-c',probe])
    PHASE='backup';backup.backup(backup_path,password)
    baseline=backup.stopped(service('app'))
    digest=hashlib.sha256()
    with pathlib.Path(backup_path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024**2),b''):digest.update(chunk)
    PHASE='prepare-v4';helper=None;token=secrets.token_hex(32)
    try:
        args=['docker','create','--network',network,'--user','0:0','--read-only','--label','org.workproof.jobs-owner='+token,
              '--entrypoint','python3','--mount',f'type=volume,src={config},dst=/private/config','--mount',f'type=volume,src={data},dst=/var/lib/workproof']
        for name in ('jobs_prepare.py','jobs_receipt.py'):
            args+=['--mount',f'type=bind,src={pathlib.Path(__file__).with_name(name).absolute()},dst=/opt/workproof/{name},readonly']
        helper=backup.run(args+[expected_image,'/opt/workproof/jobs_prepare.py','_apply',expected_commit,expected_image,digest.hexdigest()],capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{64}',helper):raise RuntimeError('Helper identity invalid')
        value=backup.inspect(helper)
        if value['Id']!=helper or value['Config']['Labels'].get('org.workproof.jobs-owner')!=token:raise RuntimeError('Helper ownership differs')
        if backup.stopped(service('app'))!=baseline or service('database')['Id']!=database['Id']:raise RuntimeError('Service identity changed')
        backup.run(['docker','start','--attach',helper],timeout=360)
        value=backup.inspect(helper)
        if value['State']['Running'] or value['State']['ExitCode']!=0:raise RuntimeError('V4 failed; retain pending marker')
        PHASE='verify-stopped'
        if backup.stopped(service('app'))!=baseline:raise RuntimeError('App changed')
    finally:
        handlers={sig:signal.signal(sig,signal.SIG_IGN) for sig in (signal.SIGINT,signal.SIGTERM)}
        try:
            if helper and re.fullmatch('[0-9a-f]{64}',helper):
                value=backup.inspect(helper)
                if value['Id']==helper and value['Config']['Labels'].get('org.workproof.jobs-owner')==token:
                    backup.run(['docker','rm','--force',helper])
        finally:
            for sig,handler in handlers.items():signal.signal(sig,handler)


def main():
    if sys.argv[1:2]==['_apply']:internal(*sys.argv[2:]);return
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('project','backup','expected-image','expected-commit'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--password-stdin',action='store_true',required=True);args=parser.parse_args()
    raw=sys.stdin.buffer.read(1026)
    if not raw.endswith(b'\n'):raise RuntimeError('Passphrase line required')
    def cancel(signum,frame):raise RuntimeError('Cancelled')
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,cancel)
    prepare(args.project,args.backup,raw[:-1],args.expected_image,args.expected_commit)
    print('V4 prepared; application remains stopped. No automatic startup.')


if __name__=='__main__':
    try:main()
    except Exception:
        print('JOBS_PHASE='+(PHASE if PHASE in PHASES else 'unknown')+'; failed; retain backup and preparation state.',file=sys.stderr)
        sys.exit(1)
