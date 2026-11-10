"""Build exclusion hashes from pinned observed reports, without using their scores."""
import hashlib
import json
import pathlib
import re
import evaluate as ev

def load_exclusions(root, index):
    root = pathlib.Path(root).resolve()
    if index.get('protocol') != 'workproof-observed-sample-index/1' or not index.get('reports'):
        raise ValueError('OBSERVED_INDEX_INVALID')
    excluded, receipts, seen = set(), {}, set()
    for entry in index['reports']:
        relative = entry['path']
        if not isinstance(relative, str) or pathlib.PurePosixPath(relative).is_absolute() or '..' in pathlib.PurePosixPath(relative).parts or relative in seen:
            raise ValueError('OBSERVED_PATH_INVALID')
        seen.add(relative)
        path = root/relative
        if path.is_symlink() or not path.resolve().is_relative_to(root): raise ValueError('OBSERVED_PATH_INVALID')
        if not re.fullmatch(r'[0-9a-f]{64}', entry['sha256']) or type(entry['samples']) is not int or entry['samples'] <= 0:
            raise ValueError('OBSERVED_ENTRY_INVALID')
        with path.open('rb') as stream: raw = stream.read(8*1024*1024+1)
        if len(raw) > 8*1024*1024 or hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError('OBSERVED_REPORT_CHANGED')
        report = ev.strict_json(raw)
        rows = report if isinstance(report, list) else report.get('samples')
        if not isinstance(rows, list) or len(rows) != entry['samples']: raise ValueError('OBSERVED_COUNT_INVALID')
        for row in rows:
            value = row.get('input_hash') if isinstance(row, dict) else None
            if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value): raise ValueError('OBSERVED_HASH_INVALID')
            excluded.add(value)  # All outcomes, including unscored/unsupported cases.
        receipts[relative] = entry['sha256']
    return excluded, receipts

if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[2]
    index_path = root/'docs/research/detectorscope-prior-sample-index.json'
    excluded, receipts = load_exclusions(root, ev.strict_json(index_path.read_bytes()))
    print(json.dumps({'scope':'pinned prior exact-byte exclusion only; no inference or new sample selection',
        'report_count':len(receipts),'unique_input_hashes':len(excluded),
        'index_sha256':hashlib.sha256(index_path.read_bytes()).hexdigest(),'quality_evaluated':False}))
