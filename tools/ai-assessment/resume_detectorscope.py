"""Complete only the frozen heldout partitions after run 42857716376 timed out."""
import argparse
import hashlib
import io
import json
import math
import os
import pathlib
import subprocess
import sys
import time
import zipfile

import evaluate as ev
from audit_detectorscope import audit, audit_conversion, audit_policy, check_rows
from audit_detectorscope_run import api, artifact_bytes
from detectorscope_coverage import INVENTORY, ROOT, SELECTION, frozen_rows
from evaluate_lrr import grouped_summary, summary

CALIBRATION_RUN = 42857716376
CALIBRATION_SOURCE = 'bf3fff64468b79b9ea90cd63209616f71321beb9'
CALIBRATION_ARTIFACTS = {
    'en': (13808312934, 99088, 'd5ce2db654ccded756e4722a3fd2a8928f44dd831c557612d4183810d6f2d81b'),
    'zh': (13808581242, 99003, 'bda4e6982092a78bedf69bddc30e12d3c2db9b7866d05db91a4705eb67435330'),
}
SHARDS = 2
RSS_LIMIT_KIB = 10 * 1024 ** 2
SCORING_MINUTES = 240
REFERENCE = ROOT / 'docs/evidence/detectorscope-883ad40/detectorscope-conversion-results.json'
SELECTION_FILE = 'detectorscope-data-selection.json'
CONVERSION_FILE = 'detectorscope-conversion-results.json'
CALIBRATION_FILES = ('calibration-report.json', 'frozen-policy.json', SELECTION_FILE, CONVERSION_FILE)


def read(path):
    return ev.strict_json(path.read_bytes())


def write(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def verify_checkpoint(directory, language, frozen):
    selection = read(directory / SELECTION_FILE)
    if selection['manifest_sha256'] != frozen['manifest_sha256'] or selection['prior_index_sha256'] != frozen['prior_index_sha256']:
        raise ValueError('CALIBRATION_SELECTION_CHANGED')
    conversion = (directory / CONVERSION_FILE).read_bytes()
    audit_conversion(ev.strict_json(conversion), read(REFERENCE), read(INVENTORY))
    return audit_policy(frozen, language, read(directory / 'calibration-report.json'),
                        read(directory / 'frozen-policy.json'), hashlib.sha256(conversion).hexdigest())


def fetch_checkpoint(directory, language):
    run = api(f'actions/runs/{CALIBRATION_RUN}')
    if (run['head_sha'], run['status'], run['conclusion']) != (CALIBRATION_SOURCE, 'completed', 'failure'):
        raise ValueError('CALIBRATION_RUN_CHANGED')
    artifact, size, digest = CALIBRATION_ARTIFACTS[language]
    raw = artifact_bytes(artifact, size, 'sha256:' + digest)
    directory.mkdir(mode=0o700)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for filename in CALIBRATION_FILES:
            entry = archive.getinfo((f'detectorscope-evaluation-{language}/' if filename.endswith(('report.json', 'policy.json')) else '') + filename)
            if not 0 < entry.file_size < 4 * 1024 ** 2:
                raise ValueError('CALIBRATION_MEMBER_SIZE')
            (directory / filename).write_bytes(archive.read(entry))
    verify_checkpoint(directory, language, read(SELECTION))
    print(f'{language}: authenticated all 384 calibration rows and frozen policy from {CALIBRATION_RUN}.')


def binding(language, shard, checkpoint, conversion):
    return {'language': language, 'shard': shard, 'shard_count': SHARDS,
            'source_commit': os.environ['GITHUB_SHA'], 'workflow_run': os.environ['GITHUB_RUN_ID'],
            'calibration_run': CALIBRATION_RUN, 'calibration_artifact': CALIBRATION_ARTIFACTS[language][0],
            'policy_sha256': hashlib.sha256((checkpoint / 'frozen-policy.json').read_bytes()).hexdigest(),
            'conversion_sha256': hashlib.sha256(conversion.read_bytes()).hexdigest()}


def worker(args):
    import contextlib
    import resource

    frozen = read(SELECTION)
    verify_checkpoint(args.checkpoint, args.language, frozen)
    key = 'heldout-' + args.language
    rows = frozen_rows(args.inputs, key, frozen)[args.shard::SHARDS]
    conversion = ROOT / CONVERSION_FILE
    audit_conversion(read(conversion), read(REFERENCE), read(INVENTORY))
    resource.setrlimit(resource.RLIMIT_AS, (32 * 1024 ** 3, 32 * 1024 ** 3))

    results = []
    with open(os.devnull, 'w', encoding='utf-8') as silent:
        with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
            import torch
            from detectorscope import AuditableDetector
            torch.set_num_threads(2)
            detector = AuditableDetector.from_pretrained(str(args.model_dir), local_files_only=True, torch_dtype='float16')
        for index, row in enumerate(rows):
            item = dict(frozen['manifests'][key][args.shard + index * SHARDS])
            with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
                tokens = len(detector.extractor.tokenizer(row['text'], truncation=False)['input_ids'])
                item.update(input_tokens=tokens, status='unsupported')
                if 8 <= tokens <= 512:
                    started = time.monotonic()
                    with torch.inference_mode():
                        result = detector(row['text'], return_highlights=False)
                    value = float(result.logit)
                    if not math.isfinite(value):
                        raise ValueError('NONFINITE_HELDOUT_LOGIT')
                    item.update(status='completed', score=value, elapsed_seconds=time.monotonic() - started)
                else:
                    item['reason'] = 'TOKEN_BUDGET_8_TO_512_NO_TRUNCATION'
            results.append(item)
            if len(results) % 16 == 0:
                print(f'{args.language} shard {args.shard}: {len(results)}/{len(rows)} inputs processed', flush=True)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if not 0 < peak <= RSS_LIMIT_KIB:
        raise ValueError('FINAL_PEAK_RSS_EXCEEDS_BUDGET')
    check_rows(results, frozen['manifests'][key][args.shard::SHARDS])
    args.output.mkdir(mode=0o700)
    (args.output / CONVERSION_FILE).write_bytes(conversion.read_bytes())
    write(args.output / 'heldout-shard.json', {**binding(args.language, args.shard, args.checkpoint, conversion),
          'peak_rss_kib': peak, 'samples': results})


def run_worker():
    env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
               HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false')
    env.pop('GITHUB_TOKEN', None)
    child = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'], env=env, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + SCORING_MINUTES * 60
    try:
        while True:
            try:
                status = child.wait(timeout=1)
                break
            except subprocess.TimeoutExpired:
                try:
                    rss = next(int(line.split()[1]) for line in pathlib.Path(f'/proc/{child.pid}/status').read_text().splitlines()
                               if line.startswith('VmRSS:'))
                except (FileNotFoundError, ProcessLookupError, StopIteration):
                    rss = 0
                if rss > RSS_LIMIT_KIB:
                    raise RuntimeError('HELDOUT_SHARD_RSS_LIMIT')
                if time.monotonic() > deadline:
                    raise RuntimeError('HELDOUT_SHARD_DEADLINE')
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=15)
    if status:
        raise RuntimeError('HELDOUT_SHARD_FAILED')


def merge_shards(parts, language, checkpoint, frozen):
    reference, inventory = read(REFERENCE), read(INVENTORY)
    manifest = frozen['manifests']['heldout-' + language]
    by_id, peaks, provenance = {}, [], []
    for shard in range(SHARDS):
        directory = parts / f'detectorscope-heldout-{language}-{shard}'
        conversion = directory / CONVERSION_FILE
        audit_conversion(read(conversion), reference, inventory)
        report = read(directory / 'heldout-shard.json')
        expected = binding(language, shard, checkpoint, conversion)
        if any(report.get(key) != value for key, value in expected.items()):
            raise ValueError('HELDOUT_SHARD_PROVENANCE')
        check_rows(report['samples'], manifest[shard::SHARDS])
        peak = report['peak_rss_kib']
        if type(peak) is not int or not 0 < peak <= RSS_LIMIT_KIB:
            raise ValueError('HELDOUT_SHARD_MEMORY')
        peaks.append(peak)
        provenance.append(expected)
        by_id.update((row['id'], row) for row in report['samples'])
    results = [by_id[row['id']] for row in manifest]
    check_rows(results, manifest)
    return results, max(peaks), provenance


def assemble(args):
    frozen = read(SELECTION)
    threshold = verify_checkpoint(args.checkpoint, args.language, frozen)
    samples, peak, provenance = merge_shards(args.parts, args.language, args.checkpoint, frozen)
    report = {'language': args.language, 'threshold': threshold, 'samples': samples,
              'overall': summary(samples, threshold), 'groups': grouped_summary(samples, threshold),
              'peak_rss_kib': peak,
              'limitations': ['Upstream labels and independence not independently verified.',
                              'Coverage excludes unsupported length without truncation.',
                              'Correlated samples; confidence intervals may be optimistic.',
                              'No commercial clearance or production activation.']}
    audit(frozen, args.language, read(args.checkpoint / 'calibration-report.json'),
          read(args.checkpoint / 'frozen-policy.json'), report,
          hashlib.sha256((args.checkpoint / CONVERSION_FILE).read_bytes()).hexdigest())
    prefix = args.output / ('detectorscope-evaluation-' + args.language)
    prefix.mkdir(parents=True)
    for filename in CALIBRATION_FILES:
        target = args.output if filename in (SELECTION_FILE, CONVERSION_FILE) else prefix
        (target / filename).write_bytes((args.checkpoint / filename).read_bytes())
    write(prefix / 'heldout-report.json', report)
    write(prefix / 'resume-provenance.json', {'calibration_source': CALIBRATION_SOURCE, 'heldout_shards': provenance,
          'production_enabled': False})
    print(f'{args.language}: assembled and audited {len(samples)} heldout rows under the original frozen policy.')


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    parser = argparse.ArgumentParser(description=__doc__)
    tasks = parser.add_subparsers(dest='task', required=True)
    for task in ('fetch', 'score', 'assemble'):
        command = tasks.add_parser(task)
        command.add_argument('--language', choices=CALIBRATION_ARTIFACTS, required=True)
        command.add_argument('--checkpoint', type=pathlib.Path, required=True)
        if task != 'fetch':
            command.add_argument('--output', type=pathlib.Path, required=True)
        if task == 'score':
            command.add_argument('--inputs', type=pathlib.Path, required=True)
            command.add_argument('--model-dir', type=pathlib.Path, required=True)
            command.add_argument('--shard', type=int, choices=range(SHARDS), required=True)
            command.add_argument('--worker', action='store_true')
        if task == 'assemble':
            command.add_argument('--parts', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if args.task == 'fetch':
        fetch_checkpoint(args.checkpoint, args.language)
    elif args.task == 'assemble':
        assemble(args)
    elif args.worker:
        worker(args)
    else:
        run_worker()


if __name__ == '__main__':
    main()
