"""One verified backbone shard -> explicit float16 derivative, Actions only."""
import gc
import hashlib
import json
import os
import pathlib
import resource
import sys
assert os.environ.get('GITHUB_ACTIONS') == 'true'
resource.setrlimit(resource.RLIMIT_AS, (32*1024**3, 32*1024**3))
import torch
from safetensors import safe_open
from safetensors.torch import save_file
torch.set_num_threads(2)
source, target = map(pathlib.Path, sys.argv[1:])
assert source.is_file() and not target.exists() and source.resolve() != target.resolve()
converted = {}
with safe_open(source, framework='pt', device='cpu') as reader:
    metadata = dict(reader.metadata() or {})
    for key in reader.keys():
        tensor = reader.get_tensor(key)
        assert tensor.dtype == torch.float32, 'Only the pinned float32 backbone is converted'
        converted[key] = tensor.to(torch.float16)
        assert torch.isfinite(converted[key]).all(), 'Float16 conversion produced nonfinite values'
        del tensor
save_file(converted, target, metadata=metadata)
total_bytes = sum(t.numel()*t.element_size() for t in converted.values())
del converted
gc.collect()
# Verify every shape and rounded value in bounded slices. No classifier changes,
# quantization, omitted tensors or modified head/SAE files are permitted.
with safe_open(source, framework='pt', device='cpu') as original, safe_open(target, framework='pt', device='cpu') as derived:
    assert set(original.keys()) == set(derived.keys())
    for key in original.keys():
        left, right = original.get_tensor(key), derived.get_tensor(key)
        assert left.shape == right.shape and right.dtype == torch.float16
        left, right = left.reshape(-1), right.reshape(-1)
        for start in range(0, left.numel(), 65536):
            assert torch.equal(left[start:start+65536].to(torch.float16), right[start:start+65536])
        del left, right
def sha(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()
print(json.dumps({'source_sha256':sha(source),'derived_sha256':sha(target),'derived_size':target.stat().st_size,
                  'tensor_bytes':total_bytes,'conversion':'float32-to-float16, round-to-nearest torch.to',
                  'all_values_verified':True,'peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
