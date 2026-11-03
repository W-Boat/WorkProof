"""Separate frozen calibration/heldout LRR experiment; no raw text publication.

Reuses the preselected source-group split and strict dataset loader. Ratio scores
remain ratios; this tool does not route them through classifier probabilities.
"""
import argparse
import collections
import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys
import time
import evaluate as ev
import lrr_model


def rate(count,total):
    if not total:return {'count':count,'total':total,'rate':None,'wilson95':None}
    p=count/total;z=1.959963984540054;den=1+z*z/total
    centre=(p+z*z/(2*total))/den
    half=z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/den
    return {'count':count,'total':total,'rate':p,'wilson95':[max(0,centre-half),min(1,centre+half)]}


def score(rows,folder):
    result=[]
    for index,row in enumerate(rows):
        text=row['text'];fingerprint=hashlib.sha256(text.encode()).hexdigest()
        started=time.monotonic()
        process=subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('lrr_probe.py')),
            'infer','--model-dir',str(folder)],input=json.dumps({'text':text,'language':row['language']}).encode(),
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=120)
        if process.returncode or len(process.stdout)>65536:raise ValueError('LRR_PROCESS_FAILURE')
        value=ev.strict_json(process.stdout)
        if (value.get('protocol')!='workproof-lrr-experiment/1' or value.get('model_revision')!=lrr_model.REVISION or
                value.get('calibration') is not None or value.get('network_used') is not False or
                value.get('score_kind')!='negative_log_likelihood_log_rank_ratio' or value.get('direction')!='higher'):
            raise ValueError('LRR_REPORT_IDENTITY')
        status=value.get('status')
        if status not in ('completed','unsupported','insufficient_input'):raise ValueError('LRR_REPORT_STATUS')
        item={'id':row['id'],'input_hash':fingerprint,'truth':row['truth'],'language':row['language'],
            'domain':row.get('domain'),'generator':row['generator'],'status':status,'elapsed_seconds':time.monotonic()-started}
        if status=='completed':
            number=value['statistics']['value']
            if type(number) not in (int,float) or not math.isfinite(number) or number<0:raise ValueError('INVALID_LRR_RATIO')
            item.update(score=number,input_tokens=value['input_tokens'],peak_rss_kib=value['peak_rss_kib'])
        else:item['reason']=value.get('reason')
        result.append(item)
        if (index+1)%32==0:print('Scored selected samples:',index+1,flush=True)
    return result


def summary(rows,threshold):
    completed=[r for r in rows if r['status']=='completed']
    human=[r for r in completed if r['truth']=='human'];ai=[r for r in completed if r['truth']=='ai']
    return {'samples':len(rows),'completed':len(completed),'statuses':dict(collections.Counter(r['status'] for r in rows)),
        'false_positive':rate(sum(r['score']>=threshold for r in human),len(human)),
        'false_negative':rate(sum(r['score']<threshold for r in ai),len(ai))}


def grouped_summary(rows,threshold):
    groups={}
    for key in ('domain','generator'):
        values=sorted({row[key] for row in rows if isinstance(row.get(key),str)})
        groups[key]={value:summary([row for row in rows if row.get(key)==value],threshold) for value in values}
    return groups


def choose_threshold(rows):
    human=[r['score'] for r in rows if r['status']=='completed' and r['truth']=='human']
    ai=[r for r in rows if r['status']=='completed' and r['truth']=='ai']
    if len(human)<100 or len(ai)<100 or (len(human)+len(ai))/len(rows)<.9:raise ValueError('INSUFFICIENT_CALIBRATION_COVERAGE')
    if any(type(value) not in (float,int) or not math.isfinite(value) or value<0 for value in human):
        raise ValueError('INVALID_CALIBRATION_RATIO')
    candidates=sorted({0.,*(math.nextafter(number,math.inf) for number in human)})
    return next(number for number in candidates if math.isfinite(number) and sum(s>=number for s in human)/len(human)<=.05)


def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true'
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('inputs','model-dir','output'):parser.add_argument('--'+name,type=pathlib.Path,required=True)
    parser.add_argument('--language',choices=('en','zh'),required=True);args=parser.parse_args()
    args.output.mkdir(mode=0o700,exist_ok=False)
    partitions={}
    for part in ('calibration','heldout'):
        rows=ev.load_dataset(args.inputs/(part+'-'+args.language+'.jsonl'))
        # Existing strict loader returns the declared rows and source bytes hash.
        partitions[part]=rows
    calibration,calibration_hash=partitions['calibration'];heldout,heldout_hash=partitions['heldout']
    a={hashlib.sha256(r['text'].encode()).hexdigest() for r in calibration}
    b={hashlib.sha256(r['text'].encode()).hexdigest() for r in heldout}
    if a&b or len(a)!=len(calibration) or len(b)!=len(heldout):raise ValueError('OVERLAPPING_PARTITIONS')
    lrr_model.prepare(args.model_dir)
    scored=score(calibration,args.model_dir)
    (args.output/'calibration-report.json').write_text(json.dumps(scored,indent=2)+'\n',encoding='utf-8')
    threshold=choose_threshold(scored)
    policy={'engine':'workproof-qwen3-lrr-experiment','model_revision':lrr_model.REVISION,
        'score_kind':'negative_log_likelihood_log_rank_ratio','direction':'higher','threshold':threshold,
        'decision_rule':'threshold_gte','calibration_dataset_sha256':calibration_hash,'heldout_dataset_sha256':heldout_hash,
        'calibration_input_hashes':sorted(a),'heldout_input_hashes':sorted(b),'empirical_calibration_fp_budget':.05,
        'calibration_summary':summary(scored,threshold),'production_enabled':False}
    # Persist threshold before inspecting any heldout scores. Never overwrite.
    with (args.output/'frozen-policy.json').open('x',encoding='utf-8') as output:json.dump(policy,output,indent=2);output.flush();os.fsync(output.fileno())
    tested=score(heldout,args.model_dir)
    report={'source_commit':os.environ['GITHUB_SHA'],'language':args.language,'threshold':threshold,
        'overall':summary(tested,threshold),'groups':grouped_summary(tested,threshold),'samples':tested,
        'limitations':['Empirical calibration budget does not guarantee heldout errors.','Upstream truth, semantic independence and training contamination unverified.','Correlated source samples may make Wilson intervals optimistic.','No commercial clearance or production threshold activation.']}
    (args.output/'heldout-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report['overall'],indent=2))


if __name__=='__main__':
    try:main()
    except Exception:
        print('LRR independent evaluation did not complete; do not use partial results as a validated threshold.',file=sys.stderr);sys.exit(1)
