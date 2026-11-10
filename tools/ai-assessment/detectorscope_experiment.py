"""Actions-only synthetic resource probe, not accuracy evaluation or a production detector."""
import hashlib
import json
import math
import os
import pathlib
import resource
import shutil
import subprocess
import sys
import time

assert os.environ.get('GITHUB_ACTIONS') == 'true'
root = pathlib.Path(__file__).resolve().parents[2]
inventory = json.loads((root/'docs/research/detectorscope-model-inventory-20261110.json').read_text())

if len(sys.argv) > 1 and sys.argv[1] == '--infer':
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    resource.setrlimit(resource.RLIMIT_AS, (16*1024**3, 16*1024**3))
    import torch
    from detectorscope import AuditableDetector
    torch.set_num_threads(2)
    started = time.monotonic()
    detector = AuditableDetector.from_pretrained(sys.argv[2], local_files_only=True, torch_dtype='float16')
    loaded = time.monotonic()-started
    samples = {'en':'This synthetic document describes a student revising a paragraph after reading feedback. It is a runtime fixture, not a labelled accuracy example.',
               'zh':'这是一段用于检查程序运行的合成文本。学生阅读反馈后修改段落，并保留原来的讨论。它不是用于衡量误报的真实人工样本。'}
    results = {}
    for language, text in samples.items():
        tokens = detector.extractor.tokenizer(text, truncation=False)['input_ids']
        assert 8 <= len(tokens) <= 256, 'Synthetic input exceeds explicit token budget'
        begin = time.monotonic()
        with torch.inference_mode(): out = detector(text, return_highlights=False)
        probability, logit, bias = float(out.p_ai), float(out.logit), float(out.bias)
        assert all(math.isfinite(v) for v in (probability, logit, bias)) and 0 <= probability <= 1
        contributions = [float(feature.importance) for feature in out.features]
        assert all(math.isfinite(v) for v in contributions)
        assert math.isclose(logit, bias+sum(contributions), abs_tol=0.02, rel_tol=0.01)
        results[language] = {'tokens':len(tokens),'seconds':time.monotonic()-begin,'p_ai':probability,
                             'logit':logit,'feature_count':len(contributions)}
    print(json.dumps({'dtype':'float16','load_seconds':loaded,'peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                      'synthetic_results':results,'accuracy_evaluated':False,'production_enabled':False}))
    sys.exit(0)

temporary = pathlib.Path(os.environ['RUNNER_TEMP'])
memory = int(next(line.split()[1] for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
free = shutil.disk_usage(temporary).free
assert memory >= 12*1024**3, 'At least 12 GiB available RAM required before model download'
assert free >= 16*1024**3, 'At least 16 GiB free disk required before model download'
model_path = temporary/'workproof-detectorscope-fixed-model'
assert not model_path.exists(), 'Fresh isolated model directory required'
from huggingface_hub import snapshot_download
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
snapshot_download(inventory['model'], revision=inventory['revision'], local_dir=model_path, token=False, max_workers=2)
for item in inventory['files']:
    path = model_path/item['path']
    assert path.is_file() and not path.is_symlink() and path.stat().st_size == item['size']
    hashed = hashlib.sha256() if item['lfs'] else hashlib.sha1()
    if not item['lfs']: hashed.update(b'blob '+str(item['size']).encode()+b'\0')
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024), b''): hashed.update(chunk)
    assert hashed.hexdigest() == (item['lfs']['oid'] if item['lfs'] else item['git_oid']), 'Fixed model payload digest mismatch'
environment = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
child = subprocess.run([sys.executable, __file__, '--infer', str(model_path)], env=environment, capture_output=True, text=True, timeout=240)
if child.returncode:
    print(child.stderr[-4000:], file=sys.stderr)  # Synthetic-only input, no user documents or credentials.
    raise RuntimeError('Fixed-model synthetic inference failed')
report = json.loads(child.stdout)
report.update(model_revision=inventory['revision'], verified_files=len(inventory['files']), source_commit='52ecc87775154b35d4550911de22faad4fc68f40',
              scope='two synthetic resource probes; float16 differs from original float32; no Chinese/English accuracy conclusion')
(root/'detectorscope-synthetic-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
