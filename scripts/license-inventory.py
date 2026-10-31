"""Read-only dependency license inventory. Does not install or build packages.

Registry declarations are evidence, not a legal clearance or a substitute for
the license text shipped with a release. Cargo includes all locked targets and
features; npm includes development/optional packages. Maven reads a built JAR.
"""
import argparse
import concurrent.futures
import io
import json
import hashlib
from pathlib import Path
import re
import time
import tomllib
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


def fetch(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "WorkProof-license-inventory/1.0 (read-only compliance audit)"})
            with urllib.request.urlopen(request, timeout=35) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def maven_license(pom, depth=0):
    ns = {"m": "http://maven.apache.org/POM/4.0.0"}
    licenses = [{"name": item.findtext("m:name", namespaces=ns), "url": item.findtext("m:url", namespaces=ns)} for item in pom.findall("m:licenses/m:license", ns)]
    if licenses or depth >= 6:
        return licenses
    parent = pom.find("m:parent", ns)
    if parent is None:
        return []
    group, artifact, version = [parent.findtext("m:" + key, namespaces=ns) for key in ("groupId", "artifactId", "version")]
    if not all((group, artifact, version)) or any("${" in value for value in (group, artifact, version)):
        return []
    url = "https://repo.maven.apache.org/maven2/" + group.replace(".", "/") + "/" + artifact + "/" + version + "/" + artifact + "-" + version + ".pom"
    try:
        with urllib.request.urlopen(url, timeout=25) as response:
            result = maven_license(ET.fromstring(response.read()), depth + 1)
        return [dict(item, inherited_from=url) for item in result]
    except Exception:
        return []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    rows = []
    for lock in (root / "package-lock.json", root / "services/institution/scaffold-vue/package-lock.json"):
        for location, package in json.loads(lock.read_text(encoding="utf-8")).get("packages", {}).items():
            if not location or package.get("link") or "node_modules/" not in location:
                continue
            rows.append({"ecosystem": "npm", "name": package.get("name") or location.rsplit("node_modules/", 1)[-1], "version": package.get("version"), "license": package.get("license"), "development": bool(package.get("dev")), "source": str(lock.relative_to(root)).replace("\\", "/"), "location": location, "evidence": "lockfile metadata; license text not independently checked"})
    packages = tomllib.loads((root / "Cargo.lock").read_text(encoding="utf-8"))["package"]
    cache_path = args.output.with_suffix(".cargo-cache.json")
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}

    def crate(package):
        key = package["name"] + "@" + package["version"]
        url = "https://crates.io/api/v1/crates/" + package["name"] + "/" + package["version"]
        row = {"ecosystem": "cargo", "name": package["name"], "version": package["version"], "source": "Cargo.lock", "evidence_url": url, "evidence": "version-specific registry metadata; all locked targets/features"}
        try:
            value = cache.get(key) or fetch(url)["version"]
            cache[key] = {"license": value.get("license"), "repository": value.get("repository")}
            row.update(cache[key])
        except Exception as error:
            row.update({"license": None, "error": str(error)})
        return row

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows.extend(pool.map(crate, [p for p in packages if p.get("source", "").startswith("registry+")]))
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.jar:
        ns = {"m": "http://maven.apache.org/POM/4.0.0"}
        with zipfile.ZipFile(args.jar) as jar:
            for name in jar.namelist():
                if not name.startswith("BOOT-INF/lib/") or not name.endswith(".jar"):
                    continue
                with zipfile.ZipFile(io.BytesIO(jar.read(name))) as library:
                    licenses, coordinates, notices = [], [], []
                    for path in library.namelist():
                        if path.startswith("META-INF/maven/") and path.endswith("/pom.xml"):
                            try:
                                pom = ET.fromstring(library.read(path))
                                coordinates.append(path.removeprefix("META-INF/maven/").removesuffix("/pom.xml"))
                                for item in pom.findall("m:licenses/m:license", ns):
                                    licenses.append({"name": item.findtext("m:name", namespaces=ns), "url": item.findtext("m:url", namespaces=ns)})
                                if not licenses:
                                    licenses.extend(maven_license(pom))
                            except ET.ParseError:
                                pass
                        if not path.endswith(("/", ".class")) and any(part in Path(path).name.upper() for part in ("LICENSE", "NOTICE", "COPYING")):
                            notices.append(path)
                    texts = {path: library.read(path).decode("utf-8", errors="replace") for path in notices}
                    explicit_spdx = sorted({match.group(1).strip() for value in texts.values() for match in re.finditer(r"SPDX-License-Identifier:\s*([^\r\n]+)", value)})
                    detected = []
                    for text in texts.values():
                        if "Apache License" in text and ("Version 2.0" in text or "version 2.0" in text):
                            detected.append("Apache-2.0")
                        if "Eclipse Public License" in text and ("2.0" in text):
                            detected.append("EPL-2.0")
                        if "GNU GENERAL PUBLIC LICENSE" in text and "Universal FOSS Exception" in text:
                            detected.append("GPL-2.0 with Universal-FOSS-exception-1.0 (review full text)")
                        if "Permission is hereby granted, free of charge" in text:
                            detected.append("MIT-like (review full text)")
                    if not licenses and detected:
                        licenses = [{"name": value, "evidence": "embedded text identification; may include bundled third-party licenses"} for value in sorted(set(detected))]
                    if not licenses and coordinates and all(value.startswith("com.scaffold/") for value in coordinates):
                        licenses = [{"name": "MIT", "evidence": "services/institution/LICENSE; imported upstream source"}]
                    if not licenses and Path(name).name == "reactive-streams-1.0.4.jar":
                        url = "https://repo.maven.apache.org/maven2/org/reactivestreams/reactive-streams/1.0.4/reactive-streams-1.0.4.pom"
                        with urllib.request.urlopen(url, timeout=25) as response:
                            licenses = maven_license(ET.fromstring(response.read()))
                        licenses = [dict(item, evidence_url=url) for item in licenses]
                    rows.append({"ecosystem": "maven-jar", "name": Path(name).name, "coordinates": coordinates, "license": licenses or None, "embedded_spdx": explicit_spdx, "notice_files": notices, "source": "GitHub Actions institution-baseline JAR", "evidence": "embedded POM, inherited parent or embedded text; not a license-expression compatibility decision"})
                    notice_root = args.output.parent / "maven-notices" / Path(name).name
                    for path, value in texts.items():
                        target = notice_root / path
                        if not target.resolve().is_relative_to(notice_root.resolve()):
                            raise ValueError("Unsafe notice path in JAR: " + path)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(library.read(path))
    hashes = {str(path.relative_to(root)).replace("\\", "/"): hashlib.sha256(path.read_bytes()).hexdigest() for path in (root / "Cargo.lock", root / "package-lock.json", root / "services/institution/scaffold-vue/package-lock.json")}
    if args.jar:
        hashes[args.jar.name] = hashlib.sha256(args.jar.read_bytes()).hexdigest()
    report = {"audit_date": "2026-10-31", "input_sha256": hashes, "limits": ["Metadata inventory is not full-text legal clearance", "Cargo all locked targets/features; npm includes dev/optional", "Maven only supplied built JAR, not all build/test tools", "Missing or custom licenses require manual review"], "packages": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = {key: sum(row["ecosystem"] == key for row in rows) for key in ("npm", "cargo", "maven-jar")}
    print(json.dumps({"counts": counts, "missing_license": sum(not row.get("license") for row in rows), "output": str(args.output)}, ensure_ascii=False))
    if any(not row.get("license") for row in rows):
        raise SystemExit("Incomplete license metadata; review report before claiming coverage")


if __name__ == "__main__":
    main()
