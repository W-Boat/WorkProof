"""Read this deployment's private configuration; never initialize a database."""
import json
import hashlib
import os
import pathlib
import stat
import sys
import catalog_receipt
import jobs_receipt


def private_json(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 10001 or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError('Private deployment file has unexpected owner or permissions')
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    if os.getuid() != 10001:
        raise RuntimeError('The application must run as UID 10001')
    directory = pathlib.Path('/private/config')
    if ((directory / '.initializing').exists() or os.path.lexists(directory / catalog_receipt.PENDING)
            or os.path.lexists(directory / jobs_receipt.PENDING)):
        raise RuntimeError('Initialization is incomplete; preserve the database and inspect the preparation record')
    initialized = private_json(directory / 'initialized.json')
    config = private_json(directory / 'application.json')
    catalog = False
    jobs = False
    if os.path.lexists(directory / catalog_receipt.PREPARED):
        receipt = catalog_receipt.read(directory / catalog_receipt.PREPARED)
        migration = pathlib.Path('/opt/workproof/sql/V3__workproof_certificate_catalog.sql')
        if (receipt['schemaSha256'] != initialized['schemaSha256'] or
                receipt['migrationSha256'] != hashlib.sha256(migration.read_bytes()).hexdigest()):
            raise RuntimeError('Catalog preparation does not match installed migrations')
        import pymysql
        from catalog_prepare import verify_schema
        connection = pymysql.connect(host='database', user='workproof', password=config['databasePassword'],
                                     database='workproof', charset='utf8mb4', connect_timeout=10,
                                     read_timeout=10, write_timeout=10)
        try:
            with connection.cursor() as cursor:
                verify_schema(cursor)
        finally:
            connection.close()
        catalog = True
    if os.path.lexists(directory / jobs_receipt.PREPARED):
        if not catalog:
            raise RuntimeError('Jobs require prepared catalog')
        receipt = jobs_receipt.read(directory / jobs_receipt.PREPARED)
        catalog_bytes = (directory / catalog_receipt.PREPARED).read_bytes()
        if (receipt['schemaSha256'] != initialized['schemaSha256'] or
                receipt['catalogReceiptSha256'] != hashlib.sha256(catalog_bytes).hexdigest() or
                receipt['migrationSha256'] != hashlib.sha256(pathlib.Path('/opt/workproof/sql/V4__workproof_certificate_jobs.sql').read_bytes()).hexdigest()):
            raise RuntimeError('Jobs preparation differs from installed migrations')
        from jobs_prepare import verify_schema, verify_spool, verify_spool_references
        spool = pathlib.Path(jobs_receipt.SPOOL)
        verify_spool(spool)
        connection = pymysql.connect(host='database', user='workproof', password=config['databasePassword'],
                                     database='workproof', charset='utf8mb4', connect_timeout=10,
                                     read_timeout=10, write_timeout=10)
        try:
            with connection.cursor() as cursor:
                verify_schema(cursor)
                verify_spool_references(cursor, spool)
        finally:
            connection.close()
        jobs = True
    environment = dict(os.environ, JWT_SECRET=config['jwt'], DB_HOST='database', DB_PORT='3306',
                       DB_NAME='workproof', DB_USERNAME='workproof', DB_PASSWORD=config['databasePassword'],
                       DB_TIMEZONE='+08:00', REDIS_HOST='cache', REDIS_PORT='6379', REDIS_PASSWORD='',
                       WORKPROOF_VERIFIER_EXECUTABLE='/opt/workproof/workproof-inspector',
                       WORKPROOF_CATALOG_ENABLED='true' if catalog else 'false', WORKPROOF_JOBS_ENABLED='true' if jobs else 'false',
                       WORKPROOF_JOBS_SPOOL=jobs_receipt.SPOOL, WORKPROOF_AI_ENABLED='false')
    os.execvpe('java', ['java', '-Xms96m', '-Xmx384m', '-Djava.io.tmpdir=/tmp', '-jar', '/opt/workproof/app.jar',
                      '--server.address=0.0.0.0', '--server.port=8080'], environment)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('WorkProof 未启动：请先完成全新部署准备；若已准备，请检查私有配置、权限与初始化记录。未执行数据库初始化。', file=sys.stderr)
        sys.exit(1)
