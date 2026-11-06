"""Summarize Actions-only synthetic editor stress cases and actual export bytes.

This utility never executes a model, editor, build, test, or signature verifier.
Proof reports must come from the Rust readback helper run by the workflow.
"""
from __future__ import annotations
import argparse
from html.parser import HTMLParser
import json
import math
from pathlib import Path, PurePosixPath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

MAX_BYTES = 32 * 1024 * 1024
FORMATS = {"html": (".html",), "markdown": (".md",), "docx": (".docx",)}


def bounded_file(case: Path, relative: str, suffixes: tuple[str, ...]) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("file path must be a relative fixture path")
    name = PurePosixPath(relative)
    if name.is_absolute() or ".." in name.parts or ":" in relative:
        raise ValueError("fixture path escapes its case")
    path = case.joinpath(*name.parts)
    if path.is_symlink() or not path.resolve().is_relative_to(case.resolve()):
        raise ValueError("fixture path escapes its case")
    if path.suffix.lower() not in suffixes or not path.is_file():
        raise ValueError("fixture file is missing or has an unsupported type")
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("fixture exceeds 32 MiB")
    return path


def read_json(case: Path, name: str):
    return json.loads(bounded_file(case, name, (".json",)).read_text(encoding="utf-8"))


class BodyText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.body = False
        self.seen_body = False
        self.ignored = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.body = True
            self.seen_body = True
        if tag in ("head", "style", "script"):
            self.ignored += 1

    def handle_endtag(self, tag):
        if tag == "body":
            self.body = False
        if tag in ("head", "style", "script") and self.ignored:
            self.ignored -= 1

    def handle_data(self, data):
        if self.body and not self.ignored:
            # Ignore only pretty-print whitespace text nodes between elements.
            # Spaces within actual text nodes remain part of the comparison.
            if data.strip():
                self.chunks.append(data)


def html_text(path: Path) -> str:
    parser = BodyText()
    parser.feed(path.read_text(encoding="utf-8-sig"))
    parser.close()
    if not parser.seen_body:
        raise ValueError("HTML export has no body")
    return "".join(parser.chunks)


def markdown_text(path: Path) -> str:
    text = path.read_text(encoding="utf-8-sig")
    # The stress fixture uses plain paragraphs, never rich Markdown. Preserve
    # every paragraph character, removing only paragraph/line layout newlines.
    paragraphs = re.split(r"\n[ \t]*\n", text.replace("\r\n", "\n"))
    plain = "".join(part.replace("\n", "") for part in paragraphs)
    return re.sub(r"\\([!\"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])", r"\1", plain)


def docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 1024 or sum(item.file_size for item in entries) > MAX_BYTES:
            raise ValueError("DOCX expanded contents exceed the bounded fixture limit")
        for item in entries:
            name = PurePosixPath(item.filename)
            if name.is_absolute() or ".." in name.parts or "\\" in item.filename or ":" in item.filename:
                raise ValueError("DOCX contains an unsafe entry path")
            if item.flag_bits & 1:
                raise ValueError("encrypted DOCX entries are unsupported")
        documents = [item for item in entries if item.filename == "word/document.xml"]
        if len(documents) != 1:
            raise ValueError("DOCX must have exactly one document.xml")
        payload = archive.read(documents[0])
    if b"<!DOCTYPE" in payload.upper() or b"<!ENTITY" in payload.upper():
        raise ValueError("DOCX XML declarations are unsupported")
    root = ET.fromstring(payload)
    return "".join(node.text or "" for node in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))


def duration(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0:
        return round(value, 3)
    return None


def keypress_summary(values):
    if not isinstance(values, list):
        values = []
    values = sorted(value for value in map(duration, values) if value is not None)
    if not values:
        return {"samples": 0, "p50": None, "p95": None, "max": None}
    def percentile(fraction):
        position = (len(values) - 1) * fraction
        lower, upper = math.floor(position), math.ceil(position)
        return round(values[lower] + (values[upper] - values[lower]) * (position - lower), 3)
    return {"samples": len(values), "p50": percentile(.5), "p95": percentile(.95), "max": values[-1]}


def compare(expected: str, actual: str, marker: str):
    same = expected == actual
    common = 0
    if not same:
        for before, after in zip(expected, actual):
            if before != after:
                break
            common += 1
    return {"match": same, "expected_chars": len(expected), "actual_chars": len(actual),
            "tail_marker_present": bool(marker) and actual.endswith(marker),
            "first_mismatch_index": None if same else common}


def summarize_case(case: Path):
    result = {"case": case.name, "passed": False, "errors": [], "exports": {}}
    try:
        metrics = read_json(case, "metrics.json")
        if not isinstance(metrics, dict):
            raise ValueError("metrics must be an object")
        result.update({key: metrics.get(key) for key in ("target_chars", "actual_chars", "timeout")})
        result.update({key: duration(metrics.get(key)) for key in ("open_ms", "save_ms")})
        result["keypress_ms"] = keypress_summary(metrics.get("keypress_ms", []))
        exports = metrics.get("exports", {})
        if not isinstance(exports, dict):
            raise ValueError("export measurements must be an object")
        for kind in FORMATS:
            entry = exports.get(kind, {})
            if not isinstance(entry, dict):
                entry = {}
            result["exports"][kind] = {"passed": False, "ms": duration(entry.get("ms")), "timeout": bool(entry.get("timeout")), "error": str(entry["error"])[:1000] if entry.get("error") else None}
        if metrics.get("target_chars") != int(case.name.removeprefix("case-")):
            result["errors"].append("target_chars does not match the case directory")
        result["errors"].extend(str(error)[:1000] for error in metrics.get("errors", [])[:40])
        if metrics.get("error"):
            result["errors"].append(str(metrics["error"])[:1000])
        if metrics.get("timeout"):
            result["errors"].append("case timed out")
        expected = bounded_file(case, "expected_text.txt", (".txt",)).read_text(encoding="utf-8")
        marker = metrics.get("tail_marker")
        if not isinstance(marker, str) or not marker or not expected.endswith(marker):
            raise ValueError("expected final saved text lacks its declared tail marker")
        result["expected_chars"] = len(expected)
        if len(expected) < int(case.name.removeprefix("case-")):
            result["errors"].append("saved text is shorter than the requested stress size")
        if metrics.get("actual_chars") != len(expected):
            result["errors"].append("actual_chars differs from final saved text")
        if duration(metrics.get("open_ms")) is None or duration(metrics.get("save_ms")) is None or not result["keypress_ms"]["samples"]:
            result["errors"].append("required timing measurements are missing")
        try:
            proofs = read_json(case, "proof-verification.json")
            if isinstance(proofs, dict) and isinstance(proofs.get("exports"), dict):
                proofs = proofs["exports"]
        except Exception as error:
            proofs = {}
            result["errors"].append("proof readback: " + str(error)[:1000])
        for kind, suffixes in FORMATS.items():
            exported = result["exports"][kind]
            try:
                entry = exports.get(kind, {})
                exported.update({"ms": duration(entry.get("ms")), "timeout": bool(entry.get("timeout")), "error": entry.get("error")})
                if exported["timeout"] or exported["error"]:
                    raise ValueError("export failed or timed out")
                path = bounded_file(case, entry.get("path"), suffixes)
                exported["bytes"] = path.stat().st_size
                actual = {"html": html_text, "markdown": markdown_text, "docx": docx_text}[kind](path)
                exported["content"] = compare(expected, actual, marker)
                proof = proofs.get(kind, {}) if isinstance(proofs, dict) else {}
                # Display results from the real verifier, never infer them from
                # filenames, content equality, or frontend success indicators.
                exported["proof"] = {key: proof.get(key) is True for key in ("valid", "file_match", "signature_valid")}
                exported["passed"] = exported["content"]["match"] and exported["content"]["tail_marker_present"] and all(exported["proof"].values()) and exported["ms"] is not None
                if not exported["passed"]:
                    result["errors"].append(kind + ": full text, tail marker, timing or Rust proof readback failed")
            except Exception as error:
                exported["error"] = str(error)[:1000]
                result["errors"].append(kind + ": " + str(error)[:1000])
        result["passed"] = not result["errors"] and all(item["passed"] for item in result["exports"].values())
    except Exception as error:
        result["errors"].append(str(error)[:1000])
    return result


def markdown_report(report):
    lines = ["# Editor synthetic stress report", "", "All timings are actual measurements in milliseconds. No performance threshold is inferred.",
             "Content checks compare the entire final saved text and final tail marker. Proof fields are read from the Rust helper output.", "",
             "| Target chars | Actual chars | Open | Keypress p50 / p95 / max | Save | HTML ms / bytes | MD ms / bytes | DOCX ms / bytes | Result |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    def value(item):
        return "—" if item is None else str(item)
    for case in report["cases"]:
        keys = case.get("keypress_ms", {})
        exports = case.get("exports", {})
        cells = [value(case.get("target_chars")), value(case.get("actual_chars")), value(case.get("open_ms")),
                 " / ".join(value(keys.get(key)) for key in ("p50", "p95", "max")), value(case.get("save_ms"))]
        cells.extend(" / ".join(value(exports.get(kind, {}).get(key)) for key in ("ms", "bytes")) for kind in FORMATS)
        cells.append("PASS" if case["passed"] else "FAIL")
        lines.append("| " + " | ".join(cells) + " |")
    for case in report["cases"]:
        lines.extend(["", "## " + case["case"], ""])
        for kind, item in case["exports"].items():
            content = item.get("content", {})
            lines.append(f"- {kind}: full text {content.get('match', False)}, characters {content.get('actual_chars', 'unknown')} / {content.get('expected_chars', 'unknown')}, tail marker {content.get('tail_marker_present', False)}, Rust proof {item.get('proof', {})}.")
        for error in case["errors"]:
            lines.append("- Error: " + str(error).replace("\n", " ").replace("|", "\\|"))
    if report["errors"]:
        lines.extend(["", "## Report errors", ""] + ["- " + error for error in report["errors"]])
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--output", required=True, help="Report basename inside the synthetic stress root")
    args = parser.parse_args()
    allowed = (Path.cwd() / "test-results" / "editor-stress").resolve()
    root = Path(args.root).resolve()
    if root != allowed or not root.is_dir() or Path(args.root).is_symlink():
        parser.error("--root must be the existing test-results/editor-stress fixture directory")
    output = Path(args.output).resolve()
    if output.suffix in (".json", ".md"):
        output = output.with_suffix("")
    if not output.is_relative_to(root) or output == root:
        parser.error("--output must be a basename inside the fixture root")
    for suffix in (".json", ".md"):
        target = output.with_suffix(suffix)
        if target.is_symlink() or not target.resolve().is_relative_to(root):
            parser.error("report destination must stay inside the fixture root")
    cases = []
    for path in sorted(root.glob("case-*")):
        if not path.is_symlink() and path.is_dir() and re.fullmatch(r"case-(100000|150000|200000|300000)", path.name):
            cases.append(summarize_case(path))
    present = {case["case"] for case in cases}
    errors = ["missing required case-" + str(size) for size in (100000, 150000, 200000, 300000) if "case-" + str(size) not in present]
    report = {"scope": "synthetic editor fixtures only", "cases": cases, "errors": errors,
              "passed": len(cases) == 4 and not errors and all(case["passed"] for case in cases)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    output.with_suffix(".md").write_text(markdown_report(report), encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "cases": len(cases), "reports": [str(output.with_suffix('.json')), str(output.with_suffix('.md'))]}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
