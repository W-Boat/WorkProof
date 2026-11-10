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

def bounded_probe(arguments, environment):
    child = subprocess.Popen(arguments, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline, observed_rss = time.monotonic()+240, 0
    try:
        while True:
            try:
                stdout, stderr = child.communicate(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                try:
                    values = [int(line.split()[1])*1024 for line in pathlib.Path(f'/proc/{child.pid}/status').read_text().splitlines() if line.startswith('VmRSS:')]
                    if values: observed_rss = max(observed_rss, values[0])
                except (FileNotFoundError, ProcessLookupError): pass
                if observed_rss > 10*1024**3: raise RuntimeError('Probe exceeded 10 GiB observed RSS budget')
                if time.monotonic() > deadline: raise RuntimeError('Probe exceeded 240 second budget')
    finally:
        if child.poll() is None:
            child.kill(); child.communicate(timeout=15)
    assert len(stdout)+len(stderr) <= 1024*1024, 'Probe output exceeds report budget'
    if child.returncode:
        print(stderr[-4000:], file=sys.stderr)
        raise RuntimeError('Bounded research child failed')
    result = json.loads(stdout)
    assert result['peak_rss_kib']*1024 <= 10*1024**3
    result['parent_observed_peak_rss_bytes'] = observed_rss
    return result

if len(sys.argv) > 1 and sys.argv[1] == '--infer':
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    # Mapped float32 checkpoint shards coexist with converted float16 tensors.
    # Virtual mappings are not physical residency; the parent separately watches RSS.
    resource.setrlimit(resource.RLIMIT_AS, (32*1024**3, 32*1024**3))
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
assert free >= 22*1024**3, 'At least 22 GiB free disk required for original and derived shards'
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
derived_path = temporary/'workproof-detectorscope-float16-derivative'
derived_path.mkdir()  # No reuse or overwrite of previous experiments.
shards = [f for f in inventory['files'] if f['path'].startswith('extractor/model-') and f['path'].endswith('.safetensors')]
assert len(shards) == 3
modified = {f['path'] for f in shards} | {'extractor/config.json','extractor/model.safetensors.index.json'}
for item in inventory['files']:
    target = derived_path/item['path']; target.parent.mkdir(parents=True, exist_ok=True)
    if item['path'] not in modified: os.link(model_path/item['path'], target)
conversions = []
for item in shards:
    converted = bounded_probe([sys.executable, str(root/'tools/ai-assessment/detectorscope_convert.py'),
        str(model_path/item['path']), str(derived_path/item['path'])], environment)
    assert converted['source_sha256'] == item['lfs']['oid']
    conversions.append(dict(path=item['path'], **converted))
config = json.loads((model_path/'extractor/config.json').read_text());config['dtype'] = 'float16';config['torch_dtype'] = 'float16'
(derived_path/'extractor/config.json').write_text(json.dumps(config))
index = json.loads((model_path/'extractor/model.safetensors.index.json').read_text())
index['metadata']['total_size'] = sum(c['tensor_bytes'] for c in conversions)
(derived_path/'extractor/model.safetensors.index.json').write_text(json.dumps(index))
for filename in ['extractor/config.json','extractor/model.safetensors.index.json']:
    conversions.append({'path':filename,'source_sha256':hashlib.sha256((model_path/filename).read_bytes()).hexdigest(),
                        'derived_sha256':hashlib.sha256((derived_path/filename).read_bytes()).hexdigest()})
report = bounded_probe([sys.executable, __file__, '--infer', str(derived_path)], environment)
report['derived_files'] = conversions
report.update(model_revision=inventory['revision'], verified_files=len(inventory['files']), source_commit='52ecc87775154b35d4550911de22faad4fc68f40',
              scope='two synthetic resource probes; float16 differs from original float32; no Chinese/English accuracy conclusion')
(root/'detectorscope-synthetic-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
