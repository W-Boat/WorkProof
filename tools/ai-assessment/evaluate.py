"""Offline, fixed-policy evaluation. No dataset download or threshold fitting."""
import argparse
import hashlib
import json
import math
import os
import pathlib
import re
import signal
import subprocess
import sys
import threading
from urllib.parse import urlparse

HERE = pathlib.Path(__file__).resolve().parent
KINDS = {'human_original', 'ai_original', 'paraphrased', 'mixed', 'translated'}
TOKEN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def strict_json(raw):
    """Reject ambiguous labels/policies, including duplicate nested fields."""
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result

    def invalid_constant(_value):
        raise ValueError('NONFINITE_JSON_CONSTANT')

    return json.loads(raw, object_pairs_hook=object_pairs, parse_constant=invalid_constant)


def load_dataset(path):
    require(path.stat().st_size <= 16 * 1024 * 1024, 'DATASET_TOO_LARGE')
    raw = path.read_bytes()
    rows, ids, texts = [], set(), set()
    for line in raw.decode('utf-8').splitlines():
        require(bool(line) and len(line.encode('utf-8')) <= 65536, 'INVALID_DATASET_LINE')
        row = strict_json(line)
        require(isinstance(row, dict), 'INVALID_SAMPLE')
        require(isinstance(row.get('id'), str) and TOKEN.fullmatch(row['id']), 'INVALID_SAMPLE_ID')
        require(row['id'] not in ids, 'DUPLICATE_SAMPLE_ID')
        require(row.get('language') in {'en', 'zh'} and row.get('kind') in KINDS, 'INVALID_SAMPLE_GROUP')
        require(row.get('truth') in {'human', 'ai', 'mixed'}, 'INVALID_GROUND_TRUTH')
        require(row.get('truth') == 'mixed' if row['kind'] == 'mixed' else row.get('truth') != 'mixed', 'MIXED_LABEL_REQUIRED')
        require(row['kind'] != 'human_original' or row['truth'] == 'human', 'HUMAN_LABEL_REQUIRED')
        require(row['kind'] != 'ai_original' or row['truth'] == 'ai', 'AI_LABEL_REQUIRED')
        require(isinstance(row.get('generator'), str) and TOKEN.fullmatch(row['generator']), 'GENERATOR_REQUIRED')
        require('domain' not in row or isinstance(row['domain'], str) and TOKEN.fullmatch(row['domain']), 'INVALID_DOMAIN')
        require(row['kind'] != 'human_original' or row['generator'] == 'human', 'HUMAN_GENERATOR_REQUIRED')
        source = row.get('source')
        require(isinstance(source, dict), 'PROVENANCE_REQUIRED')
        require(all(isinstance(source.get(k), str) and 0 < len(source[k]) <= 1000 for k in ('url', 'license', 'record')), 'PROVENANCE_REQUIRED')
        require(urlparse(source['url']).scheme == 'https' and bool(urlparse(source['url']).hostname), 'HTTPS_SOURCE_REQUIRED')
        text = row.get('text')
        require(isinstance(text, str) and 0 < len(text.encode('utf-8')) <= 32768, 'INVALID_TEXT')
        text_hash = digest(text.encode('utf-8'))
        require(text_hash not in texts, 'DUPLICATE_TEXT')
        texts.add(text_hash)
        ids.add(row['id'])
        rows.append(row)
        require(len(rows) <= 1000, 'TOO_MANY_SAMPLES')
    require(bool(rows), 'EMPTY_DATASET')
    return rows, digest(raw)


def load_policy(path, dataset_hash, registry):
    require(path.stat().st_size <= 131072, 'POLICY_TOO_LARGE')
    raw = path.read_bytes()
    policy = strict_json(raw)
    require(isinstance(policy, dict), 'INVALID_POLICY')
    engine = policy.get('engine_id')
    require(engine in registry, 'UNKNOWN_ENGINE')
    require(policy.get('model_revision') == registry[engine]['revision'], 'POLICY_REVISION_MISMATCH')
    kind = registry[engine].get('score_kind', 'uncalibrated_class_softmax')
    require(kind in {'uncalibrated_class_softmax', 'uncalibrated_binary_sigmoid'} and policy.get('score_kind') == kind and policy.get('score_label') == 'AI', 'UNSUPPORTED_SCORE_POLICY')
    threshold = policy.get('threshold')
    require(type(threshold) in (int, float) and math.isfinite(threshold) and 0 <= threshold <= 1, 'INVALID_THRESHOLD')
    calibration = policy.get('calibration_dataset_sha256')
    hashes = policy.get('calibration_input_sha256')
    mode = policy.get('policy_mode', 'independent_calibration')
    require(mode in {'independent_calibration', 'published_fixed'}, 'INVALID_POLICY_MODE')
    if mode == 'published_fixed':
        published = registry[engine].get('published_policy', {})
        require(published.get('decision_rule') in {'binary_argmax', 'threshold_gte'} and policy.get('decision_rule') == published['decision_rule'] and threshold == published.get('threshold'), 'PUBLISHED_RULE_MISMATCH')
        require(policy.get('threshold_source') == registry[engine].get('label_source') and bool(registry[engine].get('label_source')), 'PUBLISHED_SOURCE_MISMATCH')
        require(calibration is None and hashes == [], 'PUBLISHED_POLICY_IS_NOT_CALIBRATED')
    else:
        require(policy.get('decision_rule', 'threshold_gte') == 'threshold_gte', 'INVALID_CALIBRATED_DECISION_RULE')
        require(isinstance(calibration, str) and SHA.fullmatch(calibration) and calibration != dataset_hash, 'INDEPENDENT_CALIBRATION_REQUIRED')
        require(isinstance(hashes, list) and 0 < len(hashes) <= 1000 and all(isinstance(value, str) and SHA.fullmatch(value) for value in hashes), 'CALIBRATION_INPUT_HASHES_REQUIRED')
        require(len(set(hashes)) == len(hashes), 'DUPLICATE_CALIBRATION_HASH')
    require(isinstance(policy.get('threshold_source'), str) and 0 < len(policy['threshold_source']) <= 1000, 'THRESHOLD_SOURCE_REQUIRED')
    return policy, digest(raw)


def wilson(events, count):
    if not count:
        return {'events': events, 'count': count, 'rate': None, 'wilson95': None}
    p, z = events / count, 1.959963984540054
    denominator = 1 + z * z / count
    middle = (p + z * z / (2 * count)) / denominator
    half = z * math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator
    return {'events': events, 'count': count, 'rate': p, 'wilson95': [max(0, middle - half), min(1, middle + half)]}


def metrics(records):
    scored = [r for r in records if r['status'] == 'completed']
    human = [r for r in scored if r['truth'] == 'human']
    ai = [r for r in scored if r['truth'] == 'ai']
    return {'samples': len(records), 'statuses': {s: sum(r['status'] == s for r in records) for s in sorted({r['status'] for r in records})},
            'scored': len(scored), 'coverage': len(scored) / len(records) if records else None,
            'mixed_excluded_from_binary_metrics': sum(r['truth'] == 'mixed' for r in scored),
            'false_positive': wilson(sum(r['prediction'] == 'ai' for r in human), len(human)),
            'false_negative': wilson(sum(r['prediction'] == 'human' for r in ai), len(ai))}


def evaluate(rows, dataset_hash, policy, policy_hash, predict):
    calibration_hashes = set(policy['calibration_input_sha256'])
    require(not any(digest(row['text'].encode('utf-8')) in calibration_hashes for row in rows), 'CALIBRATION_SAMPLE_OVERLAP')
    records = []
    for row in rows:
        input_hash = digest(row['text'].encode('utf-8'))
        record = {key: row[key] for key in ('id', 'language', 'generator', 'kind', 'truth')}
        record.update(domain=row.get('domain', 'unspecified'), input_hash=input_hash, prediction=None)
        try:
            value = predict(row)
            require(value.get('protocol') == 'workproof-ai-assessment/1', 'WRONG_PROTOCOL')
            require(value.get('engine_id') == policy['engine_id'] and value.get('model_revision') == policy['model_revision'], 'WRONG_ENGINE')
            require(value.get('input_hash') == input_hash and value.get('network_used') is False, 'WRONG_INPUT_OR_NETWORK')
            status = value.get('status')
            require(status in {'completed', 'not_configured', 'unsupported', 'insufficient_input', 'timeout', 'cancelled', 'error'}, 'INVALID_STATUS')
            record['status'] = status
            if status == 'completed':
                require(value.get('score_kind') == policy['score_kind'] and value.get('calibration') is None, 'WRONG_SCORE_KIND')
                scores = value.get('raw_scores', {})
                require(set(scores) == {'Human', 'AI'}, 'INVALID_SCORE_LABELS')
                require(all(type(v) in (float, int) and math.isfinite(v) and 0 <= v <= 1 for v in scores.values()) and abs(sum(scores.values()) - 1) <= 0.0001, 'INVALID_SCORES')
                score = scores[policy['score_label']]
                ai = scores['AI'] > scores['Human'] if policy.get('decision_rule') == 'binary_argmax' else score >= policy['threshold']
                record.update(score=score, prediction='ai' if ai else 'human')
        except subprocess.TimeoutExpired:
            record['status'] = 'timeout'
        except Exception:
            record['status'] = 'error'
        records.append(record)
    groups = {}
    for dimension in ('language', 'generator', 'kind', 'domain'):
        groups[dimension] = {key: metrics([r for r in records if r[dimension] == key]) for key in sorted({r[dimension] for r in records})}
    return {'protocol': 'workproof-ai-evaluation/1', 'dataset_sha256': dataset_hash, 'policy_sha256': policy_hash,
            'engine_id': policy['engine_id'], 'model_revision': policy['model_revision'], 'threshold': policy['threshold'],
            'score_kind': policy['score_kind'], 'score_label': policy['score_label'],
            'policy_mode': policy.get('policy_mode', 'independent_calibration'), 'decision_rule': policy.get('decision_rule', 'threshold_gte'),
            'calibration_dataset_sha256': policy['calibration_dataset_sha256'], 'declared_calibration_samples': len(calibration_hashes), 'overall': metrics(records), 'groups': groups, 'samples': records,
            'limitations': ['Provenance and independent calibration are supplied declarations, not externally verified facts.',
                            'Only exact UTF-8 hashes in the supplied calibration manifest were checked for overlap; completeness and semantic independence are not verified.',
                            'Fixed-threshold binary evaluation; scores are not AI proportions or authorship probabilities.',
                            'Published fixed policies reproduce upstream decisions and do not imply independent calibration or a target false-positive rate.',
                            'Mixed texts are excluded from binary rates. Errors and unsupported inputs are coverage gaps, not human predictions.',
                            'Wilson intervals assume independent Bernoulli samples; related documents or shared prompts may violate this assumption.',
                            'This report does not itself certify modern-model coverage, dataset quality, licensing clearance or production readiness.']}


def run_detector(command, request, timeout=120):
    # POSIX process groups cover descendants that retain the inherited session.
    # This is not a sandbox; a process can deliberately escape with setsid().
    require(os.name == 'posix', 'EVALUATION_PROCESS_CONTROL_REQUIRES_POSIX')
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    timed_out = threading.Event()
    def kill_group():
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    def expire():
        timed_out.set()
        kill_group()
    deadline = threading.Timer(timeout, expire)
    deadline.daemon = True
    deadline.start()
    try:
        process.stdin.write(request)
        process.stdin.close()
        output = process.stdout.read(65537)
        if timed_out.is_set():
            raise subprocess.TimeoutExpired(command, timeout)
        require(len(output) <= 65536, 'RESULT_TOO_LARGE')
        code = process.wait(timeout=timeout)
        if timed_out.is_set():
            raise subprocess.TimeoutExpired(command, timeout)
        require(code == 0, 'DETECTOR_EXIT_FAILED')
        value = strict_json(output)
        require(isinstance(value, dict) and value.get('protocol') == 'workproof-ai-assessment/1', 'WRONG_PROTOCOL')
        return value
    except (BrokenPipeError, OSError):
        if timed_out.is_set():
            raise subprocess.TimeoutExpired(command, timeout)
        raise
    finally:
        deadline.cancel()
        kill_group()
        process.wait(timeout=5)
        process.stdout.close()
        if not process.stdin.closed:
            process.stdin.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('dataset', 'policy', 'model-dir', 'output'):
        parser.add_argument('--' + name, type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        rows, dataset_hash = load_dataset(args.dataset)
        registry = strict_json((HERE / 'engines.json').read_text(encoding='utf-8'))
        policy, policy_hash = load_policy(args.policy, dataset_hash, registry)
        completed = 0
        def predict(row):
            nonlocal completed
            request = json.dumps({'text': row['text'], 'language': row['language']}, ensure_ascii=False).encode('utf-8')
            try:
                require(len(request) <= 32768, 'REQUEST_TOO_LARGE')
                return run_detector([sys.executable, str(HERE / 'detector.py'), 'infer', '--engine', policy['engine_id'], '--model-dir', str(args.model_dir.resolve())], request)
            finally:
                completed += 1
                if completed % 8 == 0 or completed == len(rows):
                    print(f'Evaluation progress: {completed}/{len(rows)} samples processed.',flush=True)
        report = evaluate(rows, dataset_hash, policy, policy_hash, predict)
        with args.output.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        print('Evaluation saved. Inspect coverage and provenance; no quality claim is implied.')
        return 0
    except Exception:
        print('Evaluation rejected: inspect the dataset/policy contract; no input content or private paths logged.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
