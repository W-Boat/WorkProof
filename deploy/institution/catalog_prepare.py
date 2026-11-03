"""Explicit V3 only. Stop, authenticated backup, migrate, retain failure marker.

Linux root Docker host, administrator-exclusive maintenance window. No automatic
restart, grants, resets, replay, rollback or removal of existing deployment data.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import signal
import subprocess
import sys
import time

PHASE = 'preflight'
PHASES = {'preflight', 'backup', 'prepare-v3', 'verify-stopped'}
SQL_NAME = 'V3__workproof_certificate_catalog.sql'


def verify_schema(cursor):
    cursor.execute("SELECT COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH,COLLATION_NAME,IS_NULLABLE,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wp_certificate' ORDER BY ORDINAL_POSITION")
    columns = cursor.fetchall()
    expected = [('id','bigint',None),('owner_user_id','bigint',None),('dept_id','bigint',None),
        ('certificate_id','char',64),('proof_hash','char',64),('file_name','varchar',1024),
        ('artifact_hash','char',64),('record_scope','varchar',16),('disclosed_events','bigint',None),
        ('total_events','bigint',None),('demo','tinyint',None),('create_by','varchar',64),
        ('update_by','varchar',64),('create_time','datetime',None),('update_time','datetime',None)]
    if [(r[0],r[1],r[2]) for r in columns] != expected:
        raise RuntimeError('V3 columns differ')
    for row in columns:
        if row[0] in ('certificate_id','proof_hash','artifact_hash') and row[3] != 'ascii_bin':
            raise RuntimeError('V3 digest collation differs')
        nullable = row[0] in ('dept_id','create_by','update_by','create_time','update_time')
        if row[4] != ('YES' if nullable else 'NO'):
            raise RuntimeError('V3 nullability differs')
    if 'auto_increment' not in columns[0][5]:
        raise RuntimeError('V3 identity differs')
    cursor.execute("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wp_certificate'")
    if cursor.fetchone() != ('InnoDB',):
        raise RuntimeError('V3 engine differs')
    for name, names, unique in [('PRIMARY',['id'],0),('uk_wp_certificate_owner_proof',['owner_user_id','proof_hash'],0),
                                 ('idx_wp_certificate_dept',['dept_id','id'],1),('idx_wp_certificate_identity',['certificate_id'],1)]:
        cursor.execute("SELECT COLUMN_NAME,NON_UNIQUE,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wp_certificate' AND INDEX_NAME=%s ORDER BY SEQ_IN_INDEX", (name,))
        if list(cursor.fetchall()) != [(column,unique,None) for column in names]:
            raise RuntimeError('V3 index differs')
    cursor.execute('SELECT id,parent_id,permission,component FROM sys_menu WHERE id BETWEEN 81000 AND 81003 ORDER BY id')
    rows = cursor.fetchall()
    if (len(rows) != 4 or [row[0] for row in rows] != [81000,81001,81002,81003] or
            list(rows[0]) != [81000,0,'workproof:certificate:list','workproof/certificates/index']):
        raise RuntimeError('V3 menu differs')
    for row, suffix in zip(rows[1:], ('add','export','inspect')):
        if row[1] != 81000 or row[2] != 'workproof:certificate:' + suffix:
            raise RuntimeError('V3 permission differs')


def internal(commit, image, backup_digest):
    import catalog_receipt as receipt
    import manage
    import pymysql
    from pymysql.constants import CLIENT
    with manage.exclusive():
        config_dir = manage.CONFIG
        if any(os.path.lexists(config_dir / name) for name in ('.initializing', receipt.PENDING, receipt.PREPARED)):
            raise RuntimeError('Existing or interrupted preparation; refusing replay')
        initialized = manage.read_json(config_dir / 'initialized.json',10001)
        config = manage.read_json(config_dir / 'application.json',10001)
        schema = pathlib.Path('/opt/workproof/sql/V1__init_schema.sql').read_text(encoding='utf-8-sig')
        migration_bytes = pathlib.Path('/opt/workproof/sql',SQL_NAME).read_bytes()
        if initialized.get('schemaSha256') != hashlib.sha256(schema.encode()).hexdigest():
            raise RuntimeError('Initialization identity differs')
        connection = pymysql.connect(host='database',user='workproof',password=config['databasePassword'],
            database='workproof',charset='utf8mb4',autocommit=True,client_flag=CLIENT.MULTI_STATEMENTS,connect_timeout=10,read_timeout=300,write_timeout=30)
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT DATABASE(),CURRENT_USER()')
                identity = cursor.fetchone()
                if identity[0] != 'workproof' or not identity[1].startswith('workproof@'):
                    raise RuntimeError('Unexpected database identity')
                cursor.execute("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('wp_certificate','wp_certificate_job','wp_certificate_job_item')")
                if cursor.fetchone()[0] != 0:
                    raise RuntimeError('Unknown existing module tables')
                cursor.execute('SELECT COUNT(*) FROM sys_menu WHERE id BETWEEN 81000 AND 81003')
                if cursor.fetchone()[0] != 0:
                    raise RuntimeError('Menu identities occupied')
                # Read-only baseline: no account/role/grant changes are permitted.
                def baseline():
                    result = []
                    for table in ('sys_user','sys_role','sys_user_role','sys_role_menu'):
                        cursor.execute('SELECT * FROM ' + table + ' ORDER BY 1,2')
                        result.append(cursor.fetchall())
                    return result
                before = baseline()
                value = {'format':receipt.FORMAT,'status':'applying','sourceCommit':commit,'imageId':image,
                    'migrationSha256':hashlib.sha256(migration_bytes).hexdigest(),
                    'schemaSha256':initialized['schemaSha256'],'backupSha256':backup_digest,
                    'startedAt':int(time.time()),'completedAt':None}
                receipt.validate(json.dumps(value),True)
                manage.create_file(config_dir / receipt.PENDING,json.dumps(value))
                directory = os.open(config_dir,os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                    cursor.execute(migration_bytes.decode('utf-8-sig'))
                    while cursor.nextset():
                        pass
                    verify_schema(cursor)
                    if baseline() != before:
                        raise RuntimeError('Existing security records changed')
                    value.update(status='prepared',completedAt=int(time.time()))
                    receipt.validate(json.dumps(value))
                    manage.create_file(config_dir / receipt.PREPARED,json.dumps(value),owner=10001)
                    os.fsync(directory)
                    (config_dir / receipt.PENDING).unlink()
                    os.fsync(directory)
                finally:
                    os.close(directory)
        finally:
            connection.close()


def prepare(project, backup_path, password, expected_image, expected_commit):
    global PHASE
    import backup_coordinator as backup
    if not sys.platform.startswith('linux') or os.geteuid() != 0:
        raise RuntimeError('Linux root required')
    if not re.fullmatch('[a-z0-9][a-z0-9_-]*',project):
        raise RuntimeError('Invalid project')
    if os.environ.get('COMPOSE_PROJECT_NAME') != project:
        raise RuntimeError('Explicit Compose project environment must agree')
    compose = ['docker','compose','--file',str(pathlib.Path(__file__).with_name('compose.yaml'))]
    def service(name):
        identity = backup.run(compose + ['ps','--all','--quiet',name],capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{12,64}',identity):
            raise RuntimeError('Expected one service')
        value = backup.inspect(identity)
        if value['Config']['Labels'].get('com.docker.compose.project') != project:
            raise RuntimeError('Project differs')
        return value
    app, database = service('app'),service('database')
    if (app['Image'] != expected_image or not re.fullmatch('sha256:[0-9a-f]{64}',expected_image) or
            not re.fullmatch('[0-9a-f]{40}',expected_commit) or
            backup.inspect(expected_image)['Config']['Labels'].get('org.opencontainers.image.revision') != expected_commit):
        raise RuntimeError('Image identity differs')
    config_volume = backup.volume(app,'/private/config')
    # Read-only receipt preflight prevents a repeat attempt from even producing a
    # second backup. Absence remains rechecked under manage.exclusive before SQL.
    probe = "import pathlib,os; p=pathlib.Path('/private/config');assert not any(os.path.lexists(p/n) for n in ('.initializing','.catalog-preparing.json','catalog.json'));assert (p/'initialized.json').is_file()"
    backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3',
        '--mount',f'type=volume,src={config_volume},dst=/private/config,readonly',expected_image,'-c',probe],stdout=subprocess.DEVNULL)
    networks = database['NetworkSettings']['Networks']
    if len(networks) != 1:
        raise RuntimeError('Expected dedicated database network')
    network_name, network = next(iter(networks.items()))
    info = json.loads(backup.run(['docker','network','inspect',network['NetworkID']],capture_output=True).stdout)[0]
    if info.get('Labels',{}).get('com.docker.compose.project') != project:
        raise RuntimeError('Network project differs')
    PHASE = 'backup'
    backup.backup(backup_path,password)
    baseline = backup.stopped(service('app'))
    digest = hashlib.sha256()
    with pathlib.Path(backup_path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024**2),b''):
            digest.update(chunk)
    PHASE = 'prepare-v3'
    token = secrets.token_hex(32)
    helper = None
    try:
        args = ['docker','create','--network',network['NetworkID'],'--user','0:0','--read-only',
            '--label','org.workproof.catalog-owner='+token,'--entrypoint','python3',
            '--mount',f'type=volume,src={config_volume},dst=/private/config']
        for filename in ('catalog_prepare.py','catalog_receipt.py'):
            args += ['--mount',f'type=bind,src={pathlib.Path(__file__).with_name(filename).absolute()},dst=/opt/workproof/{filename},readonly']
        helper = backup.run(args + [expected_image,'/opt/workproof/catalog_prepare.py','_apply',expected_commit,expected_image,digest.hexdigest()],capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{64}',helper):
            raise RuntimeError('Invalid helper')
        value = backup.inspect(helper)
        if value['Id'] != helper or value['Config']['Labels'].get('org.workproof.catalog-owner') != token:
            raise RuntimeError('Helper ownership differs')
        if backup.stopped(service('app')) != baseline or service('database')['Id'] != database['Id']:
            raise RuntimeError('Service identity changed before migration')
        backup.run(['docker','start','--attach',helper],stdout=subprocess.DEVNULL,timeout=360)
        value = backup.inspect(helper)
        if value['State']['Running'] or value['State']['ExitCode'] != 0:
            raise RuntimeError('V3 preparation failed; preserve pending marker')
        PHASE = 'verify-stopped'
        if backup.stopped(service('app')) != baseline:
            raise RuntimeError('Application state changed')
    finally:
        previous = {sig:signal.signal(sig,signal.SIG_IGN) for sig in (signal.SIGTERM,signal.SIGINT)}
        try:
            if helper and re.fullmatch('[0-9a-f]{64}',helper):
                value = backup.inspect(helper)
                if value['Id'] == helper and value['Config']['Labels'].get('org.workproof.catalog-owner') == token:
                    backup.run(['docker','rm','--force',helper],stdout=subprocess.DEVNULL)
        finally:
            for sig, handler in previous.items():
                signal.signal(sig,handler)


def main():
    if sys.argv[1:2] == ['_apply']:
        internal(*sys.argv[2:])
        return
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project','backup','expected-image','expected-commit'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--password-stdin',action='store_true',required=True)
    args = parser.parse_args()
    raw = sys.stdin.buffer.read(1026)
    if not raw.endswith(b'\n'):
        raise RuntimeError('Passphrase line required')
    def cancel(signum,frame):
        raise RuntimeError('Cancelled')
    for sig in (signal.SIGTERM,signal.SIGINT):
        signal.signal(sig,cancel)
    prepare(args.project,args.backup,raw[:-1],args.expected_image,args.expected_commit)
    print('V3 prepared; application remains stopped. Jobs and AI remain disabled.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('CATALOG_PHASE='+ (PHASE if PHASE in PHASES else 'unknown') + '; failed; preserve backup and preparation state.',file=sys.stderr)
        sys.exit(1)
