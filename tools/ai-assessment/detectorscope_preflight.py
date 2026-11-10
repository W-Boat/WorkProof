"""Actions-only pinned metadata/source checks. No dependencies, weights or inference."""
import ast
import hashlib
import json
import os
import pathlib
import urllib.parse
import urllib.request

assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Run preflight on isolated Actions only'
root = pathlib.Path(__file__).resolve().parents[2]
inventory = json.loads((root/'docs/research/detectorscope-model-inventory-20261110.json').read_text())
assert inventory['revision'] == '9baaff9e2d1cdb79cafa90cdb27811b847e69dae'
source_commit = '52ecc87775154b35d4550911de22faad4fc68f40'

def read(url, limit):
    assert urllib.parse.urlsplit(url).scheme == 'https'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'WorkProof-DetectorScope-preflight'}), timeout=30) as response:
        body = response.read(limit+1)
        assert len(body) <= limit, 'Metadata/source exceeds explicit budget'
        return body

verified_small = {}
for name, expected in inventory['small_files'].items():
    url = 'https://huggingface.co/'+inventory['model']+'/resolve/'+inventory['revision']+'/'+name
    body = read(url, 65536)
    assert hashlib.sha256(body).hexdigest() == expected['sha256'], 'Pinned small file changed'
    verified_small[name] = expected['sha256']

source_path = 'detectorscope/model/detectors/auditable.py'
source = read('https://raw.githubusercontent.com/google-deepmind/detectorscope/'+source_commit+'/'+source_path, 262144)
tree = ast.parse(source)
classes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'AuditableDetector']
assert len(classes) == 1
loaders = [n for n in classes[0].body if isinstance(n, ast.FunctionDef) and n.name == '_from_pretrained']
assert len(loaders) == 1
arguments = [a.arg for a in loaders[0].args.args+loaders[0].args.kwonlyargs]
assert 'local_files_only' in arguments and 'revision' in arguments
config = json.loads(read('https://huggingface.co/'+inventory['model']+'/resolve/'+inventory['revision']+'/extractor/config.json',65536))
assert config['model_type'] == 'gemma2' and config['dtype'] == 'float32'
weights = [f for f in inventory['files'] if f['path'].endswith('.safetensors')]
assert weights and all(len(f['lfs']['oid']) == 64 and f['lfs']['size'] == f['size'] for f in weights)
report = {'scope':'pinned source AST and small-file metadata only', 'source_commit':source_commit,
          'source_sha256':hashlib.sha256(source).hexdigest(),'model_revision':inventory['revision'],
          'small_files_verified':verified_small,'inventory_files':len(inventory['files']),
          'declared_total_bytes':sum(f['size'] for f in inventory['files']),
          'weights_downloaded':False,'weights_verified':False,'inference_executed':False,
          'commercial_clearance':False,'production_enabled':False}
(root/'detectorscope-preflight.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
