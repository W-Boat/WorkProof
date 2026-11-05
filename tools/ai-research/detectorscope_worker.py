"""Offline research adapter; not registered in production engines.

Requires separately reviewed DetectorScope 0.0.1 and model artifacts. This file
does not prepare/download models or accept Gemma terms on anybody's behalf.
"""
from __future__ import annotations
import argparse
import contextlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys

MAX_BYTES = 65536
MODEL_REVISION = "9baaff9e2d1cdb79cafa90cdb27811b847e69dae"


def fail(code: str) -> int:
    print(json.dumps({"status": "unavailable", "error": code}))
    return 2


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        return fail("INPUT_TOO_LARGE")
    try:
        request = json.loads(raw)
        if not isinstance(request, dict) or set(request) != {"text"}:
            return fail("INVALID_INPUT")
        text = request["text"]
        if not isinstance(text, str) or not 256 <= len(text) <= 12000:
            return fail("TEXT_LENGTH_OUT_OF_RANGE")
        root = args.model_dir.resolve(strict=True)
        # Preparation must be a separate reviewed process. Do not pretend a
        # caller-supplied directory name authenticates the model revision.
        if not root.is_dir() or not (root / "config.json").is_file():
            return fail("MODEL_NOT_PREPARED")
        if importlib.metadata.version("detectorscope") != "0.0.1":
            return fail("UNSUPPORTED_RUNTIME")
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["TOKENIZERS_PARALLELISM"] = "false"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        # Third-party diagnostic output must not reflect the submitted text.
        with open(os.devnull, "w", encoding="utf-8") as silent:
            with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
                import torch
                from detectorscope import AuditableDetector
                torch.set_num_threads(2)
                detector = AuditableDetector.from_pretrained(str(root), local_files_only=True, token=False)
                detector.to("cpu").eval()
                with torch.inference_mode():
                    output = detector(text, return_highlights=False)
        probability = float(output.p_ai)
        if not math.isfinite(probability) or not 0 <= probability <= 1:
            return fail("INVALID_MODEL_OUTPUT")
        # Scores describe this research model, not a human-authorship verdict.
        print(json.dumps({"status": "research_only", "method": "detectorscope-sae-2026",
            "model_score": probability, "scope": "uncalibrated; no individual decision",
            "model_artifacts_verified": False, "chinese_evaluated": False,
            "english_evaluated": False, "production_available": False}))
        return 0
    except (ValueError, UnicodeError, KeyError, TypeError):
        return fail("INVALID_INPUT_OR_OUTPUT")
    except Exception:
        return fail("RESEARCH_RUNTIME_NOT_READY")


if __name__ == "__main__":
    raise SystemExit(main())
