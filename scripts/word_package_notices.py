"""CI-only portable Word kit dependency evidence. Not commercial-use clearance."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tomllib

NOTICE = re.compile(r"^(licen[cs]e|notice|copying|copyright|authors)([.\-_]|$)", re.I)
ROOT = Path(__file__).resolve().parents[1]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inside(path: Path, parent: Path) -> bool:
    return path.resolve().is_relative_to(parent.resolve())


def notices(source: Path, destination: Path, extra: list[Path]) -> tuple[list[dict], list[str]]:
    evidence, issues = [], []
    candidates = set(extra)
    # Never traverse dependency links or nested dependency copies belonging to other packages.
    local_workspace = inside(source, ROOT) and "node_modules" not in source.relative_to(ROOT).parts
    for folder, dirs, files in os.walk(source, followlinks=False):
        if local_workspace:
            # A workspace/root manifest owns its own top-level notices, not every
            # unrelated project's notices or untracked research elsewhere in the repo.
            dirs[:] = []
        dirs[:] = sorted(d for d in dirs if d not in {"node_modules", ".git", "target"}
                         and not (Path(folder) / d).is_symlink())
        for name in files:
            if NOTICE.match(name):
                candidates.add(Path(folder) / name)
    for path in sorted(candidates):
        if not inside(path, source) or path.is_symlink():
            issues.append(f"notice outside package or symlink: {path.name}")
            continue
        if not path.is_file():
            issues.append(f"declared notice missing: {path.name}")
            continue
        relative = path.relative_to(source)
        try:
            data = path.read_bytes()
        except OSError as exc:
            issues.append(f"notice unreadable: {relative}: {type(exc).__name__}")
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)  # Preserve original bytes, including encoding and line endings.
        evidence.append({"original_relative_path": relative.as_posix(),
                         "file": target.relative_to(destination.parent.parent).as_posix(),
                         "sha256": digest(data), "bytes": len(data)})
    return evidence, issues


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cargo-metadata", type=Path)
    parser.add_argument("--target", default="x86_64-pc-windows-msvc")
    parser.add_argument("--strict", action="store_true", help="Fail on any missing declaration/text/installed package")
    args = parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true":
        parser.error("This collector runs only in GitHub Actions; local builds/tests are not required.")
    output = args.output.resolve()
    if output == ROOT or inside(ROOT, output) or (output.exists() and any(output.iterdir())):
        parser.error("Output must be a new or empty dedicated directory, outside repository ancestors.")
    output.mkdir(parents=True, exist_ok=True)
    npm_lock_path = ROOT / "package-lock.json"
    cargo_lock_path = ROOT / "Cargo.lock"
    npm_lock_bytes = npm_lock_path.read_bytes()
    cargo_lock_bytes = cargo_lock_path.read_bytes()
    lock = json.loads(npm_lock_bytes)
    if lock.get("lockfileVersion") != 3:
        raise RuntimeError("Expected npm lockfile version 3")
    inventory, missing = [], []

    def append(record: dict, source: Path | None, extras: list[Path] | None = None) -> None:
        slot = f"{len(inventory):05d}-" + re.sub(r"[^a-zA-Z0-9_.-]", "_", record["name"])
        record["evidence_directory"] = "packages/" + slot
        evidence, issues = ([], []) if source is None else notices(source, output / "packages" / slot, extras or [])
        record["notices"] = evidence
        record["installed_evidence_available"] = source is not None
        if source is None:
            issues.append("locked package is not installed on this runner; optional/platform inventory absence does not establish a missing runtime dependency")
        if not record.get("declared_license"):
            issues.append("no license declaration")
        if not evidence:
            issues.append("no actual license/notice text located")
        record["evidence_issues"] = issues
        if issues:
            missing.append({"ecosystem": record["ecosystem"], "name": record["name"],
                            "version": record.get("version"), "lock_path": record.get("lock_path"), "issues": issues})
        inventory.append(record)

    for lock_path, entry in sorted(lock["packages"].items()):
        source = (ROOT / lock_path).resolve()
        if not inside(source, ROOT):
            raise RuntimeError(f"npm package path escapes repository: {lock_path}")
        manifest_path = source / "package.json"
        installed = manifest_path.is_file()
        package = json.loads(manifest_path.read_bytes()) if installed else {}
        if installed and entry.get("version") and package.get("version") != entry["version"]:
            raise RuntimeError(f"Installed version differs from lock: {lock_path}")
        name = package.get("name") or entry.get("name") or lock_path.split("node_modules/")[-1] or lock["name"]
        append({"ecosystem": "npm", "name": name, "version": package.get("version", entry.get("version")),
                "lock_path": lock_path, "source": entry.get("resolved", "workspace" if entry.get("link") or "node_modules" not in lock_path else None),
                "integrity": entry.get("integrity"), "declared_license": package.get("license", entry.get("license")),
                "author": package.get("author"), "contributors": package.get("contributors"),
                "copyright": package.get("copyright"), "repository": package.get("repository"),
                "dev": bool(entry.get("dev")), "optional": bool(entry.get("optional")),
                "os": entry.get("os"), "cpu": entry.get("cpu"), "workspace_link": bool(entry.get("link"))},
               source if installed else None)

    if args.cargo_metadata:
        metadata_bytes = args.cargo_metadata.read_bytes()
    else:
        metadata_bytes = subprocess.check_output(["cargo", "metadata", "--offline", "--locked", "--format-version", "1", "--filter-platform", args.target,
                                                  "--manifest-path", str(ROOT / "Cargo.toml")], cwd=ROOT)
    metadata = json.loads(metadata_bytes)
    cargo_lock = tomllib.loads(cargo_lock_bytes.decode("utf-8"))
    locked = {(p["name"], p["version"], p.get("source")): p for p in cargo_lock["package"]}
    workspace_ids = set(metadata["workspace_members"])
    for package in sorted(metadata["packages"], key=lambda p: p["id"]):
        key = (package["name"], package["version"], package.get("source"))
        if key not in locked:
            raise RuntimeError(f"Cargo metadata package absent from lock: {package['id']}")
        source = Path(package["manifest_path"]).resolve().parent
        extras = [source / package["license_file"]] if package.get("license_file") else []
        append({"ecosystem": "cargo", "name": package["name"], "version": package["version"], "package_id": (package["id"] if package.get("source") else "workspace:" + str(Path(package["manifest_path"]).resolve().parent.relative_to(ROOT).as_posix())),
                "source": package.get("source"), "archive_checksum": locked[key].get("checksum"),
                "declared_license": package.get("license"), "declared_license_file": package.get("license_file"),
                "authors": package.get("authors"), "repository": package.get("repository"),
                "workspace_member": package["id"] in workspace_ids}, source, extras)
    report = {"schema": 1, "scope": "Superset of portable Word kit dependencies: all npm lock entries including workspaces, development and optional platform packages; all Cargo metadata packages including development and optional packages for the selected platform. Not a linked-binary SBOM.",
              "commercial_clearance": False, "target": args.target, "notes": "Declarations and copied original texts are evidence only. Missing platform packages are reported, not silently excluded. No third-party files are executed or downloaded by this collector.",
              "inputs": {"package-lock.json_sha256": digest(npm_lock_bytes), "Cargo.lock_sha256": digest(cargo_lock_bytes), "cargo_metadata_sha256": digest(metadata_bytes)},
              "packages": inventory, "missing_license_evidence": missing}
    (output / "inventory.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "README.txt").write_text(report["scope"] + "\n\n" + report["notes"] + "\nSee inventory.json for unresolved evidence. This inventory does not grant commercial-use rights.\n", encoding="utf-8")
    print(f"Collected {len(inventory)} package records; {len(missing)} require additional evidence.")
    if args.strict and missing:
        raise SystemExit("Missing evidence remains; see inventory.json")


if __name__ == "__main__":
    main()
