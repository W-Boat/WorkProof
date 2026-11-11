"""Measure frozen input eligibility with the pinned tokenizer and no model weights."""
import argparse
import hashlib
import json
import os
import pathlib
import tempfile
import urllib.request

import evaluate as ev

ROOT = pathlib.Path(__file__).resolve().parents[2]
SELECTION = ROOT / 'docs/evidence/detectorscope-selection-70beaf5/selection-receipt.json'
INVENTORY = ROOT / 'docs/research/detectorscope-model-inventory-20261110.json'
TOKENIZER_FILES = ('config.json', 'tokenizer.json', 'tokenizer.model', 'tokenizer_config.json')


def frozen_rows(inputs, key, frozen):
    rows, _ = ev.load_dataset(inputs / (key + '.jsonl'))
    manifest = [
        {**{name: row[name] for name in ('id', 'truth', 'language', 'domain', 'generator')},
         'input_hash': ev.digest(row['text'].encode())}
        for row in rows
    ]
    digest = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if digest != frozen['manifest_sha256'][key] or manifest != frozen['manifests'][key]:
        raise ValueError('FROZEN_INPUT_MANIFEST_MISMATCH')
    return rows


def prepare_tokenizer(inventory, destination):
    files = {entry['path']: entry for entry in inventory['files']}
    verified = {}
    for name in TOKENIZER_FILES:
        path = 'extractor/' + name
        expected = files[path]
        address = 'https://huggingface.co/' + inventory['model'] + '/resolve/' + inventory['revision'] + '/' + path
        with urllib.request.urlopen(address, timeout=45) as response:
            raw = response.read(expected['size'] + 1)
        if len(raw) != expected['size']:
            raise ValueError('TOKENIZER_FILE_SIZE')
        lfs = expected['lfs']
        digest = hashlib.sha256(raw).hexdigest() if lfs else hashlib.sha1(
            b'blob ' + str(len(raw)).encode() + b'\0' + raw
        ).hexdigest()
        if digest != (lfs['oid'] if lfs else expected['git_oid']):
            raise ValueError('TOKENIZER_FILE_DIGEST')
        (destination / name).write_bytes(raw)
        verified[path] = hashlib.sha256(raw).hexdigest()
    return verified


def measure(tokenizer, rows):
    counts = {truth: {'total': 0, 'eligible': 0, 'too_short': 0, 'too_long': 0} for truth in ('human', 'ai')}
    eligible_tokens = []
    for row in rows:
        length = len(tokenizer(row['text'], truncation=False)['input_ids'])
        group = counts[row['truth']]
        group['total'] += 1
        group['too_short' if length < 8 else 'too_long' if length > 512 else 'eligible'] += 1
        if 8 <= length <= 512:
            eligible_tokens.append(length)
    eligible = len(eligible_tokens)
    return {'counts': counts, 'eligible': eligible, 'total': len(rows),
            'coverage': eligible / len(rows),
            'eligible_token_sum': sum(eligible_tokens),
            'meets_calibration_coverage_gate': eligible / len(rows) >= .9 and
                all(count['eligible'] >= 100 for count in counts.values())}


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=pathlib.Path, required=True)
    args = parser.parse_args()
    frozen, inventory = (ev.strict_json(path.read_bytes()) for path in (SELECTION, INVENTORY))
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    from transformers import AutoTokenizer

    partitions = {}
    with tempfile.TemporaryDirectory(dir=os.environ['RUNNER_TEMP']) as folder:
        tokenizer_dir = pathlib.Path(folder)
        files = prepare_tokenizer(inventory, tokenizer_dir)
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir, local_files_only=True, trust_remote_code=False)
        for key in frozen['manifests']:
            partitions[key] = measure(tokenizer, frozen_rows(args.inputs, key, frozen))
    report = {'source_commit': os.environ['GITHUB_SHA'], 'model_revision': inventory['revision'],
              'manifest_sha256': frozen['manifest_sha256'], 'tokenizer_files_sha256': files,
              'token_budget': [8, 512], 'truncation': False, 'partitions': partitions,
              'inference_executed': False, 'production_enabled': False}
    with (ROOT / 'detectorscope-tokenizer-coverage.json').open('x', encoding='utf-8') as out:
        json.dump(report, out, indent=2)
        out.write('\n')
    print(json.dumps(partitions, indent=2))


if __name__ == '__main__':
    main()
