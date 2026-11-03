"""CI-only preparation of frozen, source-group-disjoint calibration and holdout.

No inference or score-based selection. Raw text is ephemeral and must not be archived.
"""
import argparse
import collections
import json
import os
import pathlib
import re
import sys
import tempfile

import benchmark_data as bd
import evaluate as ev

PARTITIONS = ('calibration', 'heldout')
PRIOR = ev.HERE.parents[1] / 'docs/evidence/ai-benchmark-50b4463'


def prior_hashes():
    hashes, receipts = set(), {}
    for engine in ('mpu-en-v3', 'mpu-zh-v3', 'desklib-en-v1.01'):
        path = PRIOR / (engine + '-report.json')
        raw = path.read_bytes()
        report = ev.strict_json(raw)
        ev.require(report.get('engine_id') == engine and len(report['samples']) == 192,
                   'PRIOR_EXPERIMENT_REPORT_INVALID')
        for row in report['samples']:
            value = row.get('input_hash')
            ev.require(isinstance(value, str) and ev.SHA.fullmatch(value), 'PRIOR_HASH_REQUIRED')
            hashes.add(value)
        receipts[path.name] = ev.digest(raw)
    return hashes, receipts


def partition(human_hash):
    # Every occurrence of an original human text has the same assignment.
    return PARTITIONS[int(ev.digest(('workproof-calibration-v1\0' + human_hash).encode())[-1], 16) % 2]


def select_rows(stream, excluded, quota=8):
    ev.require(type(quota) is int and 1 <= quota <= 16, 'INVALID_CALIBRATION_QUOTA')
    ev.require(all(isinstance(h, str) and ev.SHA.fullmatch(h) for h in excluded), 'INVALID_PRIOR_HASH')
    buckets, banned_groups, counts = {}, set(), collections.Counter()
    for index, row in bd.stream_objects(stream):
        counts['source_rows'] += 1
        ev.require(all(isinstance(row.get(k), str) for k in
                       ('human_written_text', 'llm_generated_text', 'lang', 'model', 'split', 'domain')),
                   'BENCHMARK_SCHEMA_MISMATCH')
        language = bd.LANGUAGES.get(row['lang'])
        if language is None or row['split'] != 'test':
            continue
        generator = row['model']
        ev.require(generator in bd.GENERATORS, 'BENCHMARK_UNKNOWN_GENERATOR')
        domain = re.sub('[^A-Za-z0-9._-]+', '-', row['domain']).strip('-').lower()
        ev.require(bool(ev.TOKEN.fullmatch(domain)), 'BENCHMARK_INVALID_DOMAIN')
        human, ai = row['human_written_text'], row['llm_generated_text']
        hh, ah = (ev.digest(text.encode()) for text in (human, ai))
        if hh in excluded or ah in excluded:
            banned_groups.add(hh)
            counts['prior_experiment_pairs'] += 1
            continue
        if hh == ah or not all(0 < len(t.encode()) <= 32768 for t in (human, ai)):
            counts['invalid_length_or_identical_pairs'] += 1
            continue
        key = (partition(hh), language, generator, domain)
        rank = ev.digest('\0'.join((*key, hh, ah)).encode())
        bucket = buckets.setdefault(key, [])
        ev.require(len(buckets) <= 96, 'CALIBRATION_DOMAIN_LIMIT')
        bucket.append((rank, hh, ah, index, human, ai))
        bucket.sort()
        # Bounded reservoir. Insufficient surviving candidates fail, never shrink a quota.
        del bucket[quota * 16:]
        counts['eligible_pairs'] += 1
    selected = {part: [] for part in PARTITIONS}
    cells, seen = {}, set()
    for key, candidates in sorted(buckets.items()):
        part, language, generator, domain = key
        used = 0
        for rank, hh, ah, index, human, ai in candidates:
            if hh in banned_groups or hh in seen or ah in seen:
                counts['duplicate_or_exposed_group_pairs_not_selected'] += 1
                continue
            seen.update((hh, ah))
            for role, text in (('human', human), ('ai', ai)):
                selected[part].append(dict(
                    id=f'detectrlx-{index}-{role}', language=language, domain=domain,
                    generator='human' if role == 'human' else generator,
                    kind=role + '_original', truth=role, text=text,
                    source=dict(url=bd.URL, license='MIT-declared-not-commercially-cleared',
                                record=f'{bd.REVISION}; {bd.FILE}; one-based row {index}; field {role}; upstream test split; {part}; domain {domain}; generator {generator}')))
            used += 1
            if used == quota:
                break
        cells['/'.join(key)] = used
    ev.require(bool(cells) and all(n == quota for n in cells.values()), 'CALIBRATION_STRATA_INCOMPLETE')
    return selected, dict(counts), cells


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--per-cell', type=int, default=8)
    args = parser.parse_args()
    try:
        ev.require(os.environ.get('GITHUB_ACTIONS') == 'true' and sys.platform == 'linux', 'BENCHMARK_PREPARATION_REQUIRES_LINUX_CI')
        excluded, prior = prior_hashes()
        with tempfile.TemporaryDirectory(prefix='workproof-calibration-') as temporary:
            source = pathlib.Path(temporary) / 'source.json'
            bd.download(source)
            with source.open(encoding='utf-8') as stream:
                rows, counts, cells = select_rows(stream, excluded, args.per_cell)
        ev.require(counts['source_rows'] == 124800 and len(cells) == 96, 'CALIBRATION_STRATA_INCOMPLETE')
        args.output.mkdir(mode=0o700)
        dataset_hashes, manifests = {}, {}
        for part in PARTITIONS:
            for language in ('en', 'zh'):
                subset = [row for row in rows[part] if row['language'] == language]
                name = part + '-' + language
                path = args.output / (name + '.jsonl')
                bd.write_private(path, ''.join(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n' for row in subset))
                _, dataset_hashes[name] = ev.load_dataset(path)
                manifests[name] = sorted(ev.digest(row['text'].encode()) for row in subset)
                bd.write_private(args.output / (name + '-manifest.json'), json.dumps(manifests[name], indent=2) + '\n')
        registry = ev.strict_json((ev.HERE / 'engines.json').read_bytes())
        for engine, cfg in registry.items():
            rule = cfg['published_policy']
            policy = dict(engine_id=engine, model_revision=cfg['revision'], score_kind=cfg['score_kind'], score_label='AI', threshold=rule['threshold'], policy_mode='published_fixed', decision_rule=rule['decision_rule'], threshold_source=cfg['label_source'], calibration_dataset_sha256=None, calibration_input_sha256=[])
            path = args.output / (engine + '-policy.json')
            bd.write_private(path, json.dumps(policy, indent=2) + '\n')
            ev.load_policy(path, dataset_hashes['calibration-' + cfg['language']], registry)
        receipt = dict(protocol='workproof-calibration-selection/1', source_commit=os.environ.get('GITHUB_SHA'), dataset='WUJUNCHAO/DetectRL-X', revision=bd.REVISION, file=bd.FILE, file_sha256=bd.SHA256, file_bytes=bd.SIZE, per_cell=args.per_cell, prior_report_sha256=prior, excluded_input_hashes=len(excluded), selection='Salted original-human SHA256 parity partition; lowest hash ranks per partition/language/generator/domain; exposed human groups excluded; global exact text deduplication; no scores; quotas fail closed.', counts=counts, cells=cells, dataset_sha256=dataset_hashes, manifest_sha256={name: ev.digest('\n'.join(values).encode()) for name, values in manifests.items()}, commercial_clearance=False, limitations=['Both partitions must be prepared and frozen before inference; never choose a split after viewing scores.', 'Excludes first experiment exact hashes and their identified original-human groups; does not establish absence of model training contamination.', 'Related prompts, semantic duplicates and shared sources may remain across partitions; samples are correlated and Wilson intervals may be optimistic.', 'Only upstream test rows of general_256, declared labels and license; no independent label verification or commercial clearance.', 'Exact bytes preserved; detector length/token limits must reject unsupported inputs without truncation. Selection does not guarantee 100 scored examples of each class; calibration must fail when insufficient.', 'Raw text is ephemeral and must not be published.'])
        bd.write_private(args.output / 'selection-receipt.json', json.dumps(receipt, indent=2) + '\n')
        print('Frozen calibration and held-out inputs prepared; no quality result implied.')
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z0-9_]{1,96}', str(error)) else 'CALIBRATION_PREPARATION_FAILED'
        print('Calibration preparation rejected: ' + code + '; no text or paths logged.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
