"""Actions-only native Windows MySQL + Garnet fixture; never uses a service/user DB."""
import hashlib, os, pathlib, re, runpy, secrets, socket, subprocess, tempfile, time

assert os.name == 'nt' and os.environ.get('GITHUB_ACTIONS') == 'true'
root = pathlib.Path(__file__).resolve().parents[1]
runner = pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
mysql = pathlib.Path(os.environ['WORKPROOF_CI_MYSQL']).resolve(strict=True)
cache = pathlib.Path(os.environ['WORKPROOF_CI_GARNET']).resolve(strict=True)
wrapper = pathlib.Path(os.environ['WORKPROOF_TEST_DELAY_INSPECTOR']).resolve(strict=True)
assert all(p.is_relative_to(runner) for p in (mysql, cache, wrapper))
for port in (33309,36389,18091):
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1',port)) != 0, 'Fixture port already occupied'

def run(args, text=None, env=None):
    return subprocess.run(args,input=text,text=True,encoding='utf-8',capture_output=True,check=True,env=env).stdout

with tempfile.TemporaryDirectory(prefix='workproof-queue-',dir=runner) as directory:
    work=pathlib.Path(directory)
    data=work/'mysql-data'
    password=secrets.token_hex(24)
    server=mysql/'bin/mysqld.exe'
    client=mysql/'bin/mysql.exe'
    base=[str(client),'--protocol=TCP','--host=127.0.0.1','--port=33309','--user=root','--default-character-set=utf8mb4','--batch','--skip-column-names']
    # The shared test sets MYSQL_PWD for its restricted account. Keep the
    # isolated bootstrap/shutdown client independent of that mutable environment.
    admin_environment=dict(os.environ,MYSQL_PWD='')
    run([str(server),'--initialize-insecure','--basedir='+str(mysql),'--datadir='+str(data)])
    processes=[]
    with (work/'mysql.log').open('wb') as db_log, (work/'cache.log').open('wb') as cache_log:
        try:
            processes.append(subprocess.Popen([str(server),'--basedir='+str(mysql),'--datadir='+str(data),'--bind-address=127.0.0.1','--port=33309','--mysqlx=OFF','--innodb-buffer-pool-size=64M'],stdout=db_log,stderr=subprocess.STDOUT))
            processes.append(subprocess.Popen([str(cache),'--bind','127.0.0.1','--port','36389','--memory','32m','--index','4m','--page','1m','--no-obj'],cwd=work,stdout=cache_log,stderr=subprocess.STDOUT))
            for port in (33309,36389):
                for _ in range(120):
                    assert all(p.poll() is None for p in processes), 'Native fixture process exited'
                    with socket.socket() as probe:
                        if probe.connect_ex(('127.0.0.1',port))==0:break
                    time.sleep(.5)
                else:raise AssertionError('Native fixture did not listen')
            run(base,"CREATE DATABASE workproof_ci CHARACTER SET utf8mb4; CREATE USER 'workproof_ci'@'127.0.0.1' IDENTIFIED BY '"+password+"'; GRANT ALL ON workproof_ci.* TO 'workproof_ci'@'127.0.0.1';",env=admin_environment)
            jar=next((root/'services/institution/scaffold-system/scaffold-admin/target').glob('scaffold-admin-*.jar'))
            hashed=run(['java','-Dloader.main=com.scaffold.admin.util.LocalPasswordHasher','-cp',str(jar),'org.springframework.boot.loader.launch.PropertiesLauncher'],secrets.token_hex(24)).strip()
            assert re.fullmatch(r'\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}',hashed)
            sql=root/'services/institution/scaffold-system/sql'
            schema=(sql/'V1__init_schema.sql').read_text(encoding='utf-8')
            seed=(sql/'V2__seed_data.sql').read_text(encoding='utf-8')
            seed=re.sub(r'\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}',lambda _:hashed,seed)
            run(base+['workproof_ci'],schema+'\n'+seed+'\nUPDATE sys_user SET status=0 WHERE username<>\'admin\';',env=admin_environment)
            migration=(sql/'V3__workproof_certificate_catalog.sql').read_text(encoding='utf-8')
            run(base+['workproof_ci'],migration,env=admin_environment)
            os.environ.update(DB_HOST='127.0.0.1',DB_PORT='33309',DB_NAME='workproof_ci',DB_USERNAME='workproof_ci',DB_PASSWORD=password,REDIS_HOST='127.0.0.1',REDIS_PORT='36389',WORKPROOF_WINDOWS_QUEUE_FIXTURE='isolated-runner-temp',WORKPROOF_TEST_MYSQL_CLIENT=str(client))
            runpy.run_path(str(root/'scripts/test_institution_jobs.py'),run_name='__main__')
        finally:
            try:
                # On Windows mysqld may spawn a monitor/worker pair. Terminating
                # only Popen's PID can leave the worker holding InnoDB files.
                # Ask the exact isolated server to stop, after checking its data
                # directory; never stop a process merely by executable name.
                if processes:
                    actual=run(base,'SELECT @@datadir;',env=admin_environment).strip()
                    assert pathlib.Path(actual).resolve()==data.resolve(), 'Unexpected MySQL data directory during shutdown'
                    run(base,'SHUTDOWN;',env=admin_environment)
                    for _ in range(120):
                        with socket.socket() as probe:
                            if probe.connect_ex(('127.0.0.1',33309))!=0:break
                        time.sleep(.25)
                    else:raise AssertionError('Isolated MySQL still listening after shutdown')
            finally:
                for process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=35)
            # Private SQL, spool and logs are intentionally not artifacts.
            time.sleep(3)
