"""CI-only real JAR, MySQL and cache integration. Never target a user's DB."""
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

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
