"""Explicit tools for a fresh isolated deployment. No automatic migration or reset."""
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import sys
import time

CONFIG = pathlib.Path('/private/config')
ACCOUNT = pathlib.Path('/private/account')
ROOT_SECRET = pathlib.Path('/private/mysql-root')
DB_SECRET = pathlib.Path('/private/mysql-app')


def create_file(path, data, mode=0o600, owner=0):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        os.fchmod(output.fileno(), mode)
        os.fchown(output.fileno(), owner, owner)
        output.write(data.encode('utf-8'))
        output.flush()
        os.fsync(output.fileno())


def read_json(path, owner):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != owner or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError('Unexpected private file permissions')
    return json.loads(path.read_text(encoding='utf-8'))


@contextlib.contextmanager
def exclusive():
    info = CONFIG.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, 10001):
        raise RuntimeError('Unexpected configuration volume owner')
    fd = os.open(CONFIG / '.setup.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise RuntimeError('Unexpected setup lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def prepare():
    with exclusive():
        for directory in (CONFIG, ACCOUNT, ROOT_SECRET, DB_SECRET):
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, 10001):
                raise RuntimeError('Unexpected deployment directory')
            allowed = {'.setup.lock'} if directory == CONFIG else set()
            if set(os.listdir(directory)) - allowed:
                raise RuntimeError('Existing credentials or files found; refusing to replace this deployment')
        # Only the explicitly prepared empty volumes are assigned ownership.
        os.chown(CONFIG, 10001, 10001)
        os.chmod(CONFIG, 0o700)
        os.chmod(ACCOUNT, 0o700)
        for directory in (ROOT_SECRET, DB_SECRET):
            os.chmod(directory, 0o755)
        db_password = secrets.token_hex(32)
        create_file(ROOT_SECRET / 'password', secrets.token_hex(32), 0o444)
        create_file(DB_SECRET / 'password', db_password, 0o444)
        create_file(ACCOUNT / 'account.json', json.dumps({'username': 'admin', 'password': secrets.token_hex(24)}))
        create_file(CONFIG / 'application.json', json.dumps({'jwt': secrets.token_hex(32), 'databasePassword': db_password}), owner=10001)
    print('全新部署凭据已生成。请启动 database/cache，再显式运行 initialize。密码未输出。')


def initialize():
    import pymysql
    from pymysql.constants import CLIENT
    with exclusive():
        if (CONFIG / 'initialized.json').exists() or (CONFIG / '.initializing').exists():
            raise RuntimeError('Already initialized or an earlier attempt needs inspection; refusing to replay SQL')
        config = read_json(CONFIG / 'application.json', 10001)
        account = read_json(ACCOUNT / 'account.json', 0)
        connection = pymysql.connect(host='database', port=3306, user='workproof', password=config['databasePassword'],
                                     database='workproof', charset='utf8mb4', autocommit=True,
                                     client_flag=CLIENT.MULTI_STATEMENTS, connect_timeout=10)
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=%s", ('workproof',))
                if cursor.fetchone()[0] != 0:
                    raise RuntimeError('The database is not empty; refusing initialization')
                result = subprocess.run(['java', '-Dloader.main=com.scaffold.admin.util.LocalPasswordHasher', '-cp',
                                         '/opt/workproof/app.jar', 'org.springframework.boot.loader.launch.PropertiesLauncher'],
                                        input=account['password'], text=True, capture_output=True, timeout=30, check=True)
                hashed = result.stdout.strip()
                if not re.fullmatch(r'\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}', hashed):
                    raise RuntimeError('Password hasher returned an invalid result')
                schema = pathlib.Path('/opt/workproof/sql/V1__init_schema.sql').read_text(encoding='utf-8-sig')
                seed = pathlib.Path('/opt/workproof/sql/V2__seed_data.sql').read_text(encoding='utf-8-sig')
                seed, replacements = re.subn(r'\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}', lambda _: hashed, seed)
                if replacements < 1:
                    raise RuntimeError('No seeded password found; refusing unknown seed format')
                # This marker intentionally survives any DDL or later failure.
                record = {'schemaSha256': hashlib.sha256(schema.encode()).hexdigest(), 'startedAt': int(time.time())}
                create_file(CONFIG / '.initializing', json.dumps(record))
                cursor.execute("SET time_zone='+08:00'")
                cursor.execute(schema + '\n' + seed + "\nUPDATE sys_user SET status=0 WHERE username<>'admin';")
                while cursor.nextset():
                    pass
                cursor.execute("SELECT password,status FROM sys_user WHERE username='admin'")
                row = cursor.fetchone()
                if not row or row[0] != hashed or row[1] != 1:
                    raise RuntimeError('Initialized administrator does not match the prepared account')
                create_file(CONFIG / 'initialized.json', json.dumps({'initializedAt': int(time.time()), 'schemaSha256': record['schemaSha256']}), owner=10001)
                (CONFIG / '.initializing').unlink()
        finally:
            connection.close()
    print('空库初始化完成。示例普通账号已禁用；目录、持久任务和 AI 均未启用。')


def account():
    read_json(CONFIG / 'initialized.json', 10001)
    print(json.dumps(read_json(ACCOUNT / 'account.json', 0), ensure_ascii=False))


if __name__ == '__main__':
    try:
        if os.getuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ('prepare', 'initialize', 'account'):
            raise RuntimeError('Explicit deployment tool command required')
        {'prepare': prepare, 'initialize': initialize, 'account': account}[sys.argv[1]]()
    except Exception as error:
        if isinstance(error, RuntimeError):
            print(str(error), file=sys.stderr)
        print('WorkProof 准备未完成：已拒绝覆盖凭据、非空库或不安全目录。请检查服务就绪状态及私有准备记录；保留已有数据，不要重放初始化或删除数据卷。', file=sys.stderr)
        sys.exit(1)
