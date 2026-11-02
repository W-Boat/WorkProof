"""Read this deployment's private configuration; never initialize a database."""
import json
import os
import pathlib
import stat
import sys


def private_json(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 10001 or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError('Private deployment file has unexpected owner or permissions')
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    if os.getuid() != 10001:
        raise RuntimeError('The application must run as UID 10001')
    directory = pathlib.Path('/private/config')
    if (directory / '.initializing').exists():
        raise RuntimeError('Initialization is incomplete; preserve the database and inspect the preparation record')
    private_json(directory / 'initialized.json')
    config = private_json(directory / 'application.json')
    environment = dict(os.environ, JWT_SECRET=config['jwt'], DB_HOST='database', DB_PORT='3306',
                       DB_NAME='workproof', DB_USERNAME='workproof', DB_PASSWORD=config['databasePassword'],
                       DB_TIMEZONE='+08:00', REDIS_HOST='cache', REDIS_PORT='6379', REDIS_PASSWORD='',
                       WORKPROOF_VERIFIER_EXECUTABLE='/opt/workproof/workproof-inspector',
                       WORKPROOF_CATALOG_ENABLED='false', WORKPROOF_JOBS_ENABLED='false', WORKPROOF_AI_ENABLED='false')
    os.execvpe('java', ['java', '-Xms96m', '-Xmx384m', '-Djava.io.tmpdir=/tmp', '-jar', '/opt/workproof/app.jar',
                      '--server.address=0.0.0.0', '--server.port=8080'], environment)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('WorkProof 未启动：请先完成全新部署准备；若已准备，请检查私有配置、权限与初始化记录。未执行数据库初始化。', file=sys.stderr)
        sys.exit(1)
