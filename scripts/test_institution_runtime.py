"""CI-only real JAR, MySQL and cache integration. Never target a user's DB."""
import json
import hashlib
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

assert os.environ.get("GITHUB_ACTIONS") == "true", "Only run in the isolated Actions fixture"
assert os.environ.get("DB_NAME") == "workproof_ci", "Refusing non-fixture database"
root = Path(__file__).resolve().parents[1]
jar = next((root / "services/institution/scaffold-system/scaffold-admin/target").glob("scaffold-admin-*.jar"))
password = secrets.token_hex(24)
hasher = ["java", "-Dloader.main=com.scaffold.admin.util.LocalPasswordHasher", "-cp", str(jar), "org.springframework.boot.loader.launch.PropertiesLauncher"]
result = subprocess.run(hasher, input=password, text=True, capture_output=True, check=True)
hashed = result.stdout.strip()
assert re.fullmatch(r"\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}", hashed), "Unexpected password hasher output"
rejected = subprocess.run(hasher, input="short", text=True, capture_output=True)
assert rejected.returncode != 0, "Hasher must reject invalid input"
schema = (root / "services/institution/scaffold-system/sql/V1__init_schema.sql").read_text(encoding="utf-8")
seed = (root / "services/institution/scaffold-system/sql/V2__seed_data.sql").read_text(encoding="utf-8")
seed = re.sub(r"\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}", lambda _: hashed, seed)
mysql = ["docker", "exec", "-i", "-e", "MYSQL_PWD=" + os.environ["DB_PASSWORD"], os.environ["MYSQL_CONTAINER_ID"], "mysql", "--user=workproof_ci", "--default-character-set=utf8mb4", "workproof_ci"]
subprocess.run(mysql, input=schema + "\n" + seed + "\nUPDATE sys_user SET status=0 WHERE username<>'admin';", text=True, capture_output=True, check=True)
catalog_migration = (root/'services/institution/scaffold-system/sql/V3__workproof_certificate_catalog.sql').read_text(encoding='utf-8')
for _ in range(2):
    subprocess.run(mysql, input=catalog_migration, text=True, capture_output=True, check=True)
environment = dict(os.environ, JWT_SECRET=secrets.token_hex(32), WORKPROOF_VERIFIER_EXECUTABLE=str(root / 'target/release/workproof-inspector'), WORKPROOF_CATALOG_ENABLED='true')
if os.environ.get('WORKPROOF_TEST_REAL_AI')=='1':
    environment.update(WORKPROOF_AI_ENABLED='true',WORKPROOF_AI_PYTHON=sys.executable,WORKPROOF_AI_SCRIPT=str(root/'tools/ai-assessment/detector.py'),WORKPROOF_AI_MODELS=str(root/'.ci-institution-ai'))
port = 18089
base = f"http://127.0.0.1:{port}"


def request(path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    payload = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(base + path, data=payload, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(), response.headers


log_path = root / "institution-runtime.log"
with log_path.open("wb") as log:
    process = subprocess.Popen(["java", "-Xms96m", "-Xmx384m", "-jar", str(jar), "--server.address=127.0.0.1", f"--server.port={port}"], env=environment, stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            assert process.poll() is None, "Institution process exited; inspect runtime log"
            try:
                if request("/api/health")[0] == 200:
                    break
            except (urllib.error.URLError, TimeoutError):
                pass
            time.sleep(0.5)
        else:
            raise AssertionError("Institution startup timed out")
        html = request("/")
        assert html[0] == 200 and b'<div id="app">' in html[1], "Real Vue entry was not embedded"
        scripts = re.findall(rb'src="(/assets/[^\"]+\.js)"', html[1])
        assert scripts, "No real production JavaScript asset"
        assert request(scripts[0].decode())[0] == 200
        for path in ("/login", "/system/user", "/monitor/oper-log", "/tool/generator", "/workproof/certificates"):
            assert request(path)[0:2] == html[0:2], "Deep link did not serve Vue: " + path
        for path in ("/api/auth/me", "/api/auth/routes", "/api/system/users", "/api/monitor/oper-log"):
            assert request(path)[0] == 401, "Public UI configuration exposed protected API: " + path
        assert request("/office/index.html")[0] == 200
        assert request("/office/manifest-word.xml")[0] == 503, "Unconfigured HTTPS origin should not produce a fake installation URL"
        captcha = json.loads(request("/api/auth/captcha")[1])["data"]
        login_status, login_body, _ = request("/api/auth/login", {"username": "admin", "password": password, "captchaUuid": captcha["uuid"], "captcha": captcha["code"]})
        login = json.loads(login_body)
        assert login_status == 200 and login["code"] == 200, "Generated password failed real MySQL/BCrypt login"
        token = login["data"]["token"]
        me_status, me_body, _ = request("/api/auth/me", token=token)
        assert me_status == 200 and '*' in json.loads(me_body)['data']['permissions'], 'Superadmin frontend permissions must match backend access'
        assert request("/api/auth/routes", token=token)[0] == 200
        assert request('/api/workproof/certificates/capabilities')[0] == 401
        capability = json.loads(request('/api/workproof/certificates/capabilities', token=token)[1])['data']
        assert capability['configured'] is True and capability['artifactChecked'] is False
        proof = json.loads((root/'apps/verifier/public/demo/essay.md.wproof').read_text(encoding='utf-8'))
        def inspect_certificate(certificate):
            code, body, _ = request('/api/workproof/certificates/inspect', certificate, token)
            assert code == 200, body[:200]
            report = json.loads(body)['data']
            assert report['artifact_checked'] is False and report['identity_verified'] is False and report['time_verified'] is False
            assert 'file_match' not in report and 'records' not in report and 'signature' not in report
            return report
        report = inspect_certificate(proof)
        fingerprint = hashlib.sha256(bytes.fromhex(proof['signature'])).hexdigest()
        assert report['certificate_valid'] is True and report['certificateId'] == fingerprint
        bad_proof = json.loads(json.dumps(proof)); bad_proof['records'][1]['event']['inserted'] += 1
        assert inspect_certificate(bad_proof)['certificate_valid'] is False
        selected = root/'test-institution-selected.wproof'
        subprocess.run([str(root/'target/release/workproof-engine'), 'disclose', str(root/'apps/verifier/public/demo/essay.md.wproof'), str(selected), '5'], check=True, capture_output=True)
        selected_report = inspect_certificate(json.loads(selected.read_text(encoding='utf-8')))
        assert selected_report['scope'] == 'selective' and selected_report['chain_valid'] is False and selected_report['certificateId'] == fingerprint
        assert inspect_certificate(b'not JSON')['certificate_valid'] is False
        limited_username = 'inspect_' + secrets.token_hex(5)
        limited_password = secrets.token_hex(16)
        create_code, created, _ = request('/api/system/users', {'username': limited_username, 'nickname': '证书检查权限夹具', 'password': limited_password, 'phone':'', 'email':limited_username+'@example.com', 'deptId':6, 'status':1, 'roleIds':[4], 'postIds':[6]}, token)
        assert create_code == 200 and json.loads(created)['code'] == 200
        limited_captcha = json.loads(request('/api/auth/captcha')[1])['data']
        limited_login = json.loads(request('/api/auth/login', {'username':limited_username,'password':limited_password,'captchaUuid':limited_captcha['uuid'],'captcha':limited_captcha['code']})[1])
        limited_token = limited_login['data']['token']
        limited_me = json.loads(request('/api/auth/me', token=limited_token)[1])['data']
        assert '*' not in limited_me['permissions'], 'Ordinary roles must not receive superadmin permissions'
        assert request('/api/workproof/certificates/capabilities', token=limited_token)[0] == 403
        assert request('/api/workproof/analysis/capabilities', token=limited_token)[0] == 403
        assert request('/api/workproof/certificates/inspect', proof, limited_token)[0] == 403
        assert request('/api/workproof/certificates', proof, limited_token)[0] == 403
        assert request('/api/workproof/certificates/status')[0] == 401
        assert request('/api/workproof/certificates/status', token=limited_token)[0] == 403
        assert json.loads(request('/api/workproof/certificates/status', token=token)[1])['data']['ready'] is True
        subprocess.run(mysql, input='RENAME TABLE wp_certificate TO wp_certificate_readiness_fixture;', text=True, capture_output=True, check=True)
        try:
            missing_status=json.loads(request('/api/workproof/certificates/status', token=token)[1])['data']
            assert missing_status['enabled'] and not missing_status['ready'] and not missing_status['schemaPrepared']
            assert request('/api/workproof/certificates', token=token)[0] == 503
            assert request('/api/workproof/certificates', proof, token)[0] == 503
            assert inspect_certificate(proof)['certificate_valid'] is True
            subprocess.run(['node', str(root/'scripts/test_institution_catalog_readiness.cjs')],env=dict(os.environ,WORKPROOF_TEST_TOKEN=token),check=True)
        finally:
            subprocess.run(mysql,input='RENAME TABLE wp_certificate_readiness_fixture TO wp_certificate;',text=True,capture_output=True,check=True)
        subprocess.run(mysql,input='ALTER TABLE wp_certificate DROP INDEX uk_wp_certificate_owner_proof;',text=True,capture_output=True,check=True)
        try:
            assert json.loads(request('/api/workproof/certificates/status',token=token)[1])['data']['ready'] is False
            assert request('/api/workproof/certificates',proof,token)[0] == 503
        finally:
            subprocess.run(mysql,input='ALTER TABLE wp_certificate ADD UNIQUE KEY uk_wp_certificate_owner_proof(owner_user_id,proof_hash);',text=True,capture_output=True,check=True)
        assert json.loads(request('/api/workproof/certificates/status',token=token)[1])['data']['ready'] is True
        def catalog(path='', data=None, actor=token):
            code, body, _ = request('/api/workproof/certificates'+path, data, actor)
            parsed = json.loads(body)
            assert code == 200 and parsed['code'] == 200, 'Catalog request failed: '+str(code)
            return parsed['data']
        saved = catalog(data=proof)['entry']
        assert catalog(data=proof)['entry']['id'] == saved['id'], 'Duplicate must reuse entry'
        partial_entry = catalog(data=selected.read_bytes())['entry']
        assert partial_entry['id'] != saved['id'] and partial_entry['certificateId'] == saved['certificateId']
        assert partial_entry['proofHash'] != saved['proofHash']
        assert request('/api/workproof/certificates', bad_proof, token)[0] == 400
        assert catalog()['total'] == 2
        assert catalog('?scope=selective')['total'] == 1
        assert catalog('?keyword=not-present')['total'] == 0
        assert request('/api/workproof/certificates/export', token=token)[0] == 200
        # Grant only catalog capabilities to the existing SELF fixture role, not inspection.
        subprocess.run(mysql, input='INSERT INTO sys_role_menu(role_id,menu_id) VALUES (4,81000),(4,81001),(4,81002);', text=True, capture_output=True, check=True)
        assert catalog(actor=limited_token)['total'] == 0
        assert request('/api/workproof/certificates/'+str(saved['id']), token=limited_token)[0] == 400
        own = catalog(data=proof, actor=limited_token)['entry']
        assert own['ownerUserId'] == limited_me['userId'] and own['deptId'] == 6
        assert catalog(actor=limited_token)['total'] == 1 and catalog()['total'] == 3
        assert catalog('/'+str(own['id']), actor=limited_token)['id'] == own['id']
        export_code, export_body, _ = request('/api/workproof/certificates/export', token=limited_token)
        assert export_code == 200 and export_body.decode('utf-8').count(fingerprint) == 1
        # Synthetic index rows exercise department visibility; no original certificate is rewritten.
        def fixture_sql(sql):
            return subprocess.run(mysql, input=sql, text=True, capture_output=True, check=True).stdout
        columns='owner_user_id,dept_id,certificate_id,proof_hash,file_name,artifact_hash,record_scope,disclosed_events,total_events,demo,create_by,update_by'
        for department, marker in [(6,'a'),(7,'b')]:
            fixture_sql(f"INSERT INTO wp_certificate ({columns}) SELECT owner_user_id,{department},certificate_id,REPEAT('{marker}',64),file_name,artifact_hash,record_scope,disclosed_events,total_events,demo,create_by,update_by FROM wp_certificate WHERE id={int(saved['id'])};")
        def visible(expected):
            result=catalog(actor=limited_token)
            assert result['total']==expected and len(result['rows'])==expected, 'Department scope count/list mismatch'
            code, body, _=request('/api/workproof/certificates/export',token=limited_token)
            assert code==200 and body.decode('utf-8').count(fingerprint)==expected, 'Export scope mismatch'
        fixture_sql("UPDATE sys_role SET data_scope='DEPT' WHERE id=4;")
        visible(2)
        fixture_sql(f"UPDATE sys_role SET data_scope='DEPT_AND_CHILD' WHERE id=4; UPDATE sys_user SET dept_id=2 WHERE id={int(limited_me['userId'])};")
        visible(5)  # Parent department 2 also includes the original admin's department 5.
        fixture_sql("UPDATE sys_role SET data_scope='CUSTOM' WHERE id=4; DELETE FROM sys_role_dept WHERE role_id=4; INSERT INTO sys_role_dept(role_id,dept_id) VALUES(4,7);")
        visible(2)
        fixture_sql("DELETE FROM sys_role_dept WHERE role_id=4;")
        visible(1)
        assert request('/api/workproof/certificates/'+str(saved['id']),token=limited_token)[0]==400
        fixture_sql(f"UPDATE sys_role SET data_scope='SELF' WHERE id=4; UPDATE sys_user SET dept_id=6 WHERE id={int(limited_me['userId'])}; DELETE FROM wp_certificate WHERE proof_hash IN (REPEAT('a',64),REPEAT('b',64));")
        print('PASS: real DEPT, DEPT_AND_CHILD, CUSTOM and empty-custom list/export isolation with live role changes')
        print('PASS: opt-in catalog, repeatable migration, original-byte deduplication, partial scope, failed-save rejection and SELF list/detail/export isolation')
        request('/api/auth/logout', {}, limited_token)
        audit = subprocess.run(mysql, input="SELECT request_params FROM sys_oper_log WHERE module='证书核验';", text=True, capture_output=True, check=True).stdout
        audit_lines = [line.strip() for line in audit.splitlines() if line.strip() and line.strip() != 'request_params']
        assert audit_lines and all(line == '[]' for line in audit_lines), 'Certificate contents must not be copied into audit records'
        subprocess.run(['node', str(root/'scripts/test_institution_inspection_ui.cjs')], env=dict(os.environ, WORKPROOF_TEST_ORIGIN=base, WORKPROOF_TEST_TOKEN=token), check=True)
        subprocess.run(['node', str(root/'scripts/test_institution_ai_ui.cjs')], env=dict(os.environ, WORKPROOF_TEST_ORIGIN=base, WORKPROOF_TEST_TOKEN=token), check=True)
        print('PASS: real Rust certificate inspection through authenticated Java, full/partial scope, tamper rejection, low-permission denial and content-free audit')
        assert request("/api/auth/logout", {}, token)[0] == 200
        assert request("/api/auth/me", token=token)[0] == 401, "Logout did not revoke cache token"
        print("PASS: real bundled Vue/deep links/assets, API authentication boundaries, generated admin login, cache-backed logout and Office bootstrap")
    finally:
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        # CI fixture credentials/tokens do not enter retained logs.
        text = log_path.read_text(encoding="utf-8", errors="replace")
        for value in (password, hashed, environment["JWT_SECRET"], locals().get("token", ""), locals().get("limited_password", ""), locals().get("limited_token", "")):
            if value:
                text = text.replace(value, "[REDACTED]")
        log_path.write_text(text, encoding="utf-8")

# A separate real process verifies the optional HTTPS listener without ever
# adding a certificate to the operating system trust store or disabling TLS.
tls_root = root / ".ci-local-tls"
tls_root.mkdir(exist_ok=True)
certificate = tls_root / "localhost.crt"
key = tls_root / "localhost.key"
subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(certificate), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "extendedKeyUsage=serverAuth"], capture_output=True, check=True)
https_base = "https://localhost:18449"
context = ssl.create_default_context(cafile=str(certificate))


def secure_request(path, trusted=True):
    try:
        response = urllib.request.urlopen(https_base + path, context=context if trusted else ssl.create_default_context(), timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(), response.headers


tls_log_path = root / "institution-https.log"
with tls_log_path.open("wb") as log:
    arguments = ["java", "-Xms96m", "-Xmx384m", "-jar", str(jar), "--server.address=127.0.0.1", "--server.port=18449", "--server.ssl.enabled=true", "--server.ssl.bundle=local", "--spring.ssl.bundle.pem.local.keystore.certificate=" + certificate.as_uri(), "--spring.ssl.bundle.pem.local.keystore.private-key=" + key.as_uri(), "--workproof.local-http.enabled=true", f"--workproof.local-http.port={port}", "--workproof.public-origin=" + https_base]
    process = subprocess.Popen(arguments, env=environment, stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            assert process.poll() is None, "HTTPS process exited; inspect HTTPS runtime log"
            try:
                if secure_request("/api/health")[0] == 200 and request("/api/health")[0] == 200:
                    break
            except (urllib.error.URLError, TimeoutError):
                pass
            time.sleep(0.5)
        else:
            raise AssertionError("Dual HTTP/HTTPS startup timed out")
        manifest = secure_request("/office/manifest-word.xml")
        assert manifest[0] == 200
        document = ET.fromstring(manifest[1])
        location = document.find("{*}DefaultSettings/{*}SourceLocation")
        assert location is not None and location.attrib["DefaultValue"] == https_base + "/office/index.html"
        office = secure_request("/office/index.html")
        assert office[0] == 200 and "frame-ancestors" in office[2]["Content-Security-Policy"]
        assert secure_request("/office/addin.js")[0] == 200
        assert secure_request("/api/auth/me")[0] == 401
        assert request("/api/auth/me")[0] == 401
        assert request("/login")[0] == 200
        try:
            secure_request("/office/index.html", trusted=False)
            raise AssertionError("Untrusted self-signed certificate was unexpectedly accepted")
        except urllib.error.URLError as error:
            assert isinstance(error.reason, ssl.SSLCertVerificationError), "Expected certificate verification rejection"
        print("PASS: real HTTP+HTTPS listeners, trusted certificate and hostname validation, Word installation manifest/resources, authentication boundaries and untrusted certificate rejection")
    finally:
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        text = tls_log_path.read_text(encoding="utf-8", errors="replace")
        for value in (password, hashed, environment["JWT_SECRET"]):
            text = text.replace(value, "[REDACTED]")
        tls_log_path.write_text(text, encoding="utf-8")
