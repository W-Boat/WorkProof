"""Freeze a threshold using a separate calibration report, never held-out scores.

The empirical error budget is not a confidence guarantee or production approval.
Input/source declarations still require independent human review.
"""
import argparse
import math
import pathlib
import sys
from urllib.parse import urlparse

import evaluate as ev


def freeze(report, registry, heldout_hashes, source, max_false_positive=.05):
    ev.require(isinstance(report,dict) and report.get('protocol')=='workproof-ai-evaluation/1','INVALID_CALIBRATION_REPORT')
    engine=report.get('engine_id');ev.require(engine in registry,'UNKNOWN_ENGINE')
    cfg=registry[engine]
    ev.require(report.get('model_revision')==cfg['revision'] and report.get('score_kind')==cfg['score_kind'] and report.get('score_label')=='AI','CALIBRATION_MODEL_MISMATCH')
    ev.require(type(max_false_positive) in (float,int) and math.isfinite(max_false_positive) and 0<=max_false_positive<=.1,'INVALID_ERROR_BUDGET')
    ev.require(isinstance(source,str) and len(source)<=1000 and urlparse(source).scheme=='https' and bool(urlparse(source).hostname),'CALIBRATION_SOURCE_REQUIRED')
    ev.require(isinstance(heldout_hashes,list) and 1<=len(heldout_hashes)<=1000 and all(isinstance(h,str) and ev.SHA.fullmatch(h) for h in heldout_hashes) and len(set(heldout_hashes))==len(heldout_hashes),'HELDOUT_HASH_MANIFEST_REQUIRED')
    dataset_hash=report.get('dataset_sha256');ev.require(isinstance(dataset_hash,str) and ev.SHA.fullmatch(dataset_hash),'CALIBRATION_DATASET_HASH_REQUIRED')
    rows=report.get('samples');ev.require(isinstance(rows,list) and 1<=len(rows)<=1000,'INVALID_CALIBRATION_SAMPLES')
    hashes,ids,human,ai=set(),set(),[],[]
    for row in rows:
        ev.require(isinstance(row,dict),'INVALID_CALIBRATION_SAMPLE')
        identity=row.get('id');fingerprint=row.get('input_hash')
        ev.require(isinstance(identity,str) and ev.TOKEN.fullmatch(identity) and identity not in ids,'DUPLICATE_OR_INVALID_CALIBRATION_ID')
        ev.require(isinstance(fingerprint,str) and ev.SHA.fullmatch(fingerprint) and fingerprint not in hashes,'DUPLICATE_OR_INVALID_CALIBRATION_TEXT')
        ids.add(identity);hashes.add(fingerprint)
        ev.require(fingerprint not in heldout_hashes,'CALIBRATION_HELDOUT_OVERLAP')
        ev.require(row.get('language')==cfg['language'] and row.get('truth') in {'human','ai'},'CALIBRATION_LABEL_OR_LANGUAGE')
        status=row.get('status');ev.require(status in {'completed','unsupported','insufficient_input'},'CALIBRATION_INFERENCE_FAILURE')
        if status!='completed':continue
        score=row.get('score');ev.require(type(score) in (int,float) and math.isfinite(score) and 0<=score<=1,'INVALID_CALIBRATION_SCORE')
        (human if row['truth']=='human' else ai).append(score)
    ev.require(len(human)>=100 and len(ai)>=100,'CALIBRATION_SAMPLE_COUNT_TOO_SMALL')
    ev.require((len(human)+len(ai))/len(rows)>=.9,'CALIBRATION_COVERAGE_TOO_LOW')
    candidates={0.,1.}
    candidates.update(math.nextafter(score,math.inf) for score in human if score<1)
    threshold=next((value for value in sorted(candidates) if sum(score>=value for score in human)/len(human)<=max_false_positive),None)
    ev.require(threshold is not None,'NO_FEASIBLE_THRESHOLD')
    policy=dict(engine_id=engine,model_revision=cfg['revision'],score_kind=cfg['score_kind'],score_label='AI',policy_mode='independent_calibration',decision_rule='threshold_gte',threshold=threshold,
        calibration_dataset_sha256=dataset_hash,calibration_input_sha256=sorted(hashes),threshold_source=source,
        calibration_summary=dict(empirical_false_positive_budget=max_false_positive,human_scored=len(human),ai_scored=len(ai),samples=len(rows),human_false_positive=sum(score>=threshold for score in human),ai_false_negative=sum(score<threshold for score in ai),
            heldout_manifest_sha256=ev.digest('\n'.join(sorted(heldout_hashes)).encode()),heldout_manifest_samples=len(heldout_hashes)),
        limitations=['Threshold selected on calibration data only; empirical error is not a confidence guarantee.',
            'Held-out text hashes checked for exact overlap only; source truth, complete manifests, training contamination and semantic independence are not verified.',
            'Do not reuse calibration samples as evaluation data. Freeze before inspecting held-out results. No commercial clearance or production readiness is implied.'])
    return policy


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('calibration-report','heldout-manifest','output'):
        parser.add_argument('--'+name,type=pathlib.Path,required=True)
    parser.add_argument('--source',required=True)
    parser.add_argument('--max-false-positive',type=float,default=.05)
    args=parser.parse_args()
    try:
        ev.require(args.calibration_report.stat().st_size<=2*1024*1024 and args.heldout_manifest.stat().st_size<=131072,'CALIBRATION_INPUT_LIMIT')
        report=ev.strict_json(args.calibration_report.read_bytes())
        heldout=ev.strict_json(args.heldout_manifest.read_bytes())
        registry=ev.strict_json((ev.HERE/'engines.json').read_bytes())
        policy=freeze(report,registry,heldout,args.source,args.max_false_positive)
        import json
        with args.output.open('x',encoding='utf-8') as stream:json.dump(policy,stream,indent=2,allow_nan=False)
        print('Frozen calibration policy saved; independent held-out evaluation is still required.')
        return 0
    except Exception:
        print('Calibration rejected; no sample content or private paths logged.',file=sys.stderr)
        return 1


if __name__=='__main__':sys.exit(main())
