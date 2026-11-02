"""Explicit CI-only, pinned public benchmark selection. Never prints dataset text.

No model is run here. Test rows are selected by hashes, not detector scores.
Raw inputs remain ephemeral; only the receipt and policies may be archived.
"""
import argparse
import collections
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import time
import urllib.request

import evaluate as ev

REVISION = 'ccc9a0a74793dd3448e0da1650b430f5df1b0402'
FILE = 'Binary/binary_general_256_open.json'
SIZE = 775337623
SHA256 = '9b3fe5250b85ee02749282600a803c843e0205e0c411dea8460bea6eb21262ff'
URL = f'https://huggingface.co/datasets/WUJUNCHAO/DetectRL-X/resolve/{REVISION}/{FILE}'
LANGUAGES = {'english': 'en', 'chinese': 'zh'}
GENERATORS = {'deepseek-v3', 'gemini-2.5-flash', 'gpt-4o', 'qwen-max'}


def stream_objects(stream, max_object=1024*1024):
    """Bounded top-level JSON array, with strict per-row duplicate-key rejection."""
    decoder = json.JSONDecoder()
    buffer, eof = '', False

    def fill():
        nonlocal buffer, eof
        chunk = stream.read(65536)
        if not chunk:
            eof = True
        buffer += chunk
        ev.require(len(buffer.encode('utf-8')) <= max_object + 65536*4, 'BENCHMARK_JSON_BUFFER_LIMIT')

    def available():
        nonlocal buffer
        buffer = buffer.lstrip()
        while not buffer and not eof:
            fill()
            buffer = buffer.lstrip()
        ev.require(bool(buffer), 'BENCHMARK_JSON_TRUNCATED')

    available()
    ev.require(buffer[0] == '[', 'BENCHMARK_ARRAY_REQUIRED')
    buffer = buffer[1:]
    available()
    if buffer[0] != ']':
        count = 0
        while True:
            while True:
                try:
                    _, end = decoder.raw_decode(buffer)
                    ev.require(len(buffer[:end].encode('utf-8')) <= max_object, 'BENCHMARK_OBJECT_LIMIT')
                    value = ev.strict_json(buffer[:end])
                    break
                except json.JSONDecodeError:
                    ev.require(not eof and len(buffer.encode('utf-8')) <= max_object, 'BENCHMARK_JSON_INVALID')
                    fill()
            ev.require(isinstance(value, dict), 'BENCHMARK_OBJECT_REQUIRED')
            count += 1
            ev.require(count <= 150000, 'BENCHMARK_ROW_LIMIT')
            yield count, value
            buffer = buffer[end:]
            available()
            if buffer[0] == ']':
                break
            ev.require(buffer[0] == ',', 'BENCHMARK_COMMA_REQUIRED')
            buffer = buffer[1:]
            available()
    buffer = buffer[1:]
    ev.require(not buffer.strip(), 'BENCHMARK_TRAILING_DATA')
    while not eof:
        buffer = ''
        fill()
        ev.require(not buffer.strip(), 'BENCHMARK_TRAILING_DATA')


def select_rows(stream, quota=4):
    ev.require(type(quota) is int and 1 <= quota <= 8, 'INVALID_BENCHMARK_QUOTA')
    buckets = {}
    counts = collections.Counter()
    for index, row in stream_objects(stream):
        counts['source_rows'] += 1
        ev.require(all(isinstance(row.get(key), str) for key in ('human_written_text','llm_generated_text','lang','model','split','domain')), 'BENCHMARK_SCHEMA_MISMATCH')
        language = LANGUAGES.get(row['lang'])
        if language is None:
            counts['other_language_rows'] += 1
            continue
        if row['split'] != 'test':
            counts['non_test_rows'] += 1
            continue
        generator = row['model']
        ev.require(generator in GENERATORS, 'BENCHMARK_UNKNOWN_GENERATOR')
        domain = re.sub('[^A-Za-z0-9._-]+','-',row['domain']).strip('-').lower()
        ev.require(bool(ev.TOKEN.fullmatch(domain)), 'BENCHMARK_INVALID_DOMAIN')
        human, ai = row['human_written_text'], row['llm_generated_text']
        if not all(0 < len(value.encode('utf-8')) <= 32768 for value in (human, ai)):
            counts['oversize_or_empty_pairs'] += 1
            continue
        hashes = (ev.digest(human.encode()), ev.digest(ai.encode()))
        if hashes[0] == hashes[1]:
            counts['identical_human_ai_pairs'] += 1
            continue
        key = (language, generator, domain)
        rank = ev.digest('\0'.join((*key,*hashes)).encode())
        candidate = (rank,index,human,ai,hashes)
        bucket = buckets.setdefault(key,[])
        ev.require(len(buckets) <= 48, 'BENCHMARK_DOMAIN_LIMIT')
        bucket.append(candidate)
        bucket.sort(key=lambda item:(item[0],item[1]))
        del bucket[quota*4:]
        counts['eligible_pairs'] += 1
    selected, cells, seen = [], {}, set()
    for key, candidates in sorted(buckets.items()):
        language, generator, domain = key
        used = 0
        for rank,index,human,ai,hashes in candidates:
            if any(value in seen for value in hashes):
                counts['duplicate_pairs_not_selected'] += 1
                continue
            seen.update(hashes)
            for role,text in (('human',human),('ai',ai)):
                selected.append(dict(id=f'detectrlx-{index}-{role}',language=language,domain=domain,generator='human' if role=='human' else generator,
                    kind='human_original' if role=='human' else 'ai_original',truth=role,text=text,
                    source=dict(url=URL,license='MIT-declared-not-commercially-cleared',record=f'{REVISION}; {FILE}; one-based row {index}; field {role}; upstream test split; domain {domain}; generator {generator}')))
            used += 1
            if used == quota:
                break
        cells['/'.join(key)] = used
    ev.require(bool(selected), 'BENCHMARK_NO_SELECTED_SAMPLES')
    return selected, dict(counts), cells


def download(target):
    started, size, digest = time.monotonic(), 0, hashlib.sha256()
    request = urllib.request.Request(URL, headers={'User-Agent':'WorkProof-public-benchmark'})
    with urllib.request.urlopen(request, timeout=45) as response, target.open('xb') as output:
        while True:
            chunk = response.read(1024*1024)
            if not chunk:
                break
            size += len(chunk)
            ev.require(size <= SIZE and time.monotonic()-started <= 300, 'BENCHMARK_DOWNLOAD_LIMIT')
            digest.update(chunk)
            output.write(chunk)
    ev.require(size == SIZE and digest.hexdigest() == SHA256, 'BENCHMARK_SOURCE_HASH_MISMATCH')


def write_private(path, value):
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--per-cell', type=int, default=4)
    args = parser.parse_args()
    try:
        ev.require(os.environ.get('GITHUB_ACTIONS') == 'true' and sys.platform == 'linux', 'BENCHMARK_PREPARATION_REQUIRES_LINUX_CI')
        ev.require(1 <= args.per_cell <= 8, 'INVALID_BENCHMARK_QUOTA')
        args.output.mkdir(mode=0o700)
        with tempfile.TemporaryDirectory(prefix='workproof-public-benchmark-') as temporary:
            source = pathlib.Path(temporary)/'source.json'
            download(source)
            with source.open(encoding='utf-8') as stream:
                rows, counts, cells = select_rows(stream,args.per_cell)
        ev.require(counts['source_rows'] == 124800 and len(cells) == 48 and all(count == args.per_cell for count in cells.values()), 'BENCHMARK_STRATA_INCOMPLETE')
        hashes = {}
        for language in ('en','zh'):
            path = args.output/(language+'.jsonl')
            write_private(path, ''.join(json.dumps(row,ensure_ascii=False,allow_nan=False)+'\n' for row in rows if row['language']==language))
            _, hashes[language] = ev.load_dataset(path)
        registry = ev.strict_json((ev.HERE/'engines.json').read_text(encoding='utf-8'))
        for engine, cfg in registry.items():
            rule = cfg['published_policy']
            policy = dict(engine_id=engine,model_revision=cfg['revision'],score_kind=cfg['score_kind'],score_label='AI',threshold=rule['threshold'],
                policy_mode='published_fixed',decision_rule=rule['decision_rule'],threshold_source=cfg['label_source'],calibration_dataset_sha256=None,calibration_input_sha256=[])
            path = args.output/(engine+'-policy.json')
            write_private(path,json.dumps(policy,indent=2)+'\n')
            ev.load_policy(path,hashes[cfg['language']],registry)
        receipt = dict(protocol='workproof-benchmark-selection/1',source_commit=os.environ.get('GITHUB_SHA'),dataset='WUJUNCHAO/DetectRL-X',revision=REVISION,
            file=FILE,file_sha256=SHA256,file_bytes=SIZE,per_cell=args.per_cell,selection='lowest SHA256 ranks per language/generator/domain; exact-text de-duplication; no score-based selection',
            counts=counts,cells=cells,dataset_sha256=hashes,samples={language:sum(row['language']==language for row in rows) for language in ('en','zh')},
            commercial_clearance=False,limitations=['Upstream declarations and labels are not independently verified.',
                'Only upstream test rows from the general_256 variant; not full documents, all current generators, attacks or collaborative writing.',
                'Related prompts or documents can remain despite exact-text de-duplication; Wilson intervals may be optimistic.',
                'Published upstream policies are not independently calibrated. Raw text must not be uploaded as a public artifact.'])
        write_private(args.output/'selection-receipt.json',json.dumps(receipt,indent=2)+'\n')
        print('Prepared pinned benchmark inputs and fixed policies. No quality result or license clearance implied.')
        return 0
    except Exception as error:
        code = str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z0-9_]{1,96}',str(error)) else 'BENCHMARK_PREPARATION_FAILED'
        print('Benchmark preparation rejected: '+code+'; no sample text or private paths logged.',file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
