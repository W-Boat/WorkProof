"""Freeze fresh grouped bilingual partitions before any DetectorScope scoring."""
import argparse
import collections
import hashlib
import json
import os
import pathlib
import tempfile
import benchmark_data as bd
import calibration_data as selection
import evaluate as ev
from observed_samples import load_exclusions

def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Isolated Actions preparation only'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    runner = pathlib.Path(os.environ['RUNNER_TEMP']).resolve()
    assert args.output.resolve().is_relative_to(runner) and args.output.resolve() != runner
    assert not args.output.exists(), 'Fresh private output required'
    index_path = root/'docs/research/detectorscope-prior-sample-index.json'
    excluded, receipts = load_exclusions(root, ev.strict_json(index_path.read_bytes()))
    assert len(receipts) == 13
    namespace, quota = 'workproof-detectorscope-calibration-v1', 8
    with tempfile.TemporaryDirectory(prefix='workproof-detectorscope-data-', dir=runner) as temporary:
        source = pathlib.Path(temporary)/'source.json'
        bd.download(source)
        with source.open(encoding='utf-8') as stream:
            partitions, counts, cells = selection.select_rows(stream, excluded, quota, namespace)
    assert counts['source_rows'] == 124800 and len(cells) == 96 and set(cells.values()) == {quota}
    manifests, hashes, manifest_digests = {}, {}, {}
    for part in selection.PARTITIONS:
        for language in ('en','zh'):
            key = part+'-'+language
            subset = [row for row in partitions[part] if row['language'] == language]
            assert len(subset) == 384 and collections.Counter(row['truth'] for row in subset) == {'human':192,'ai':192}
            manifests[key] = [{'id':row['id'],'input_hash':ev.digest(row['text'].encode()),'truth':row['truth'],
                               'language':language,'domain':row['domain'],'generator':row['generator']} for row in subset]
            hashes[key] = {row['input_hash'] for row in manifests[key]}
            assert len(hashes[key]) == len(subset) and not hashes[key] & excluded
            raw = json.dumps(manifests[key],sort_keys=True,separators=(',',':')).encode()
            manifest_digests[key] = hashlib.sha256(raw).hexdigest()
    seen = set()
    for values in hashes.values():
        assert not seen & values; seen.update(values)
    args.output.mkdir(mode=0o700)
    for part in selection.PARTITIONS:
        for language in ('en','zh'):
            key = part+'-'+language
            rows = [row for row in partitions[part] if row['language'] == language]
            bd.write_private(args.output/(key+'.jsonl'), ''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows))
    receipt = {'protocol':'workproof-detectorscope-selection/1','source_commit':os.environ['GITHUB_SHA'],
        'namespace':namespace,'quota_per_cell':quota,'dataset_revision':bd.REVISION,'dataset_file':bd.FILE,
        'dataset_file_sha256':bd.SHA256,'prior_index_sha256':hashlib.sha256(index_path.read_bytes()).hexdigest(),
        'prior_reports':receipts,'excluded_unique_inputs':len(excluded),'counts':counts,'cells':cells,
        'manifest_sha256':manifest_digests,'manifests':manifests,'scoring_executed':False,
        'limitations':['Public-source declared labels only; no independent ground-truth verification.',
        'Exact bytes and identified human groups excluded; semantic overlap and training contamination remain possible.',
        'No token-length selection; scoring must report unsupported inputs without truncation.',
        'No accuracy or commercial-clearance conclusion; raw text must not be archived.']}
    (root/'detectorscope-data-selection.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'partitions':{key:len(value) for key,value in manifests.items()},'excluded_inputs':len(excluded),'scoring_executed':False}))

if __name__ == '__main__': main()
