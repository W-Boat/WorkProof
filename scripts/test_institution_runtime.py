"""CI-only real JAR, MySQL and cache integration. Never target a user's DB."""
import json
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
environment = dict(os.environ, JWT_SECRET=secrets.token_hex(32))
port = 18089
base = f"http://127.0.0.1:{port}"


def request(path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
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
        assert request("/api/auth/me", token=token)[0] == 200
        assert request("/api/auth/routes", token=token)[0] == 200
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
        for value in (password, hashed, environment["JWT_SECRET"], locals().get("token", "")):
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
