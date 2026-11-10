"""Fixed-selection independent calibration then heldout scoring; Actions only."""
import argparse
import hashlib
import json
import math
import os
import pathlib
import resource
import subprocess
import sys
import time
import evaluate as ev
from evaluate_lrr import summary, grouped_summary

assert os.environ.get('GITHUB_ACTIONS') == 'true'
root = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inputs',type=pathlib.Path,required=True)
parser.add_argument('--model-dir',type=pathlib.Path,required=True)
parser.add_argument('--output',type=pathlib.Path,required=True)
parser.add_argument('--language',choices=['en','zh'],required=True)
parser.add_argument('--worker',action='store_true')
args = parser.parse_args()

if not args.worker:
    args.output.mkdir(mode=0o700,exist_ok=False)
    environment = dict(os.environ,HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
    child = subprocess.Popen([sys.executable,__file__,*sys.argv[1:],'--worker'],env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    deadline = time.monotonic()+330*60
    try:
        while True:
            try: out,err=child.communicate(timeout=1);break
            except subprocess.TimeoutExpired:
                try:
                    rss = next((int(l.split()[1])*1024 for l in pathlib.Path(f'/proc/{child.pid}/status').read_text().splitlines() if l.startswith('VmRSS:')),0)
                except (FileNotFoundError,ProcessLookupError): rss=0
                if rss>10*1024**3 or time.monotonic()>deadline: raise RuntimeError('EVALUATION_RESOURCE_LIMIT')
    finally:
        if child.poll() is None: child.kill();child.communicate(timeout=15)
    if child.returncode: raise RuntimeError('DetectorScope evaluation incomplete; partial reports are not validated results')
    print('Completed independent evaluation; consult reports, no production threshold activated.')
    sys.exit(0)

sys.stdout = sys.stderr  # No upstream logging enters the public report channel.
resource.setrlimit(resource.RLIMIT_AS,(32*1024**3,32*1024**3))
frozen = ev.strict_json((root/'docs/evidence/detectorscope-selection-70beaf5/selection-receipt.json').read_bytes())
current = ev.strict_json((root/'detectorscope-data-selection.json').read_bytes())
assert current['manifest_sha256']==frozen['manifest_sha256'] and current['prior_index_sha256']==frozen['prior_index_sha256']
partitions={}
for part in ('calibration','heldout'):
    rows,_ = ev.load_dataset(args.inputs/(part+'-'+args.language+'.jsonl'))
    manifest=[{'id':r['id'],'input_hash':ev.digest(r['text'].encode()),'truth':r['truth'],'language':r['language'],
               'domain':r['domain'],'generator':r['generator']} for r in rows]
    digest=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assert digest==frozen['manifest_sha256'][part+'-'+args.language]
    partitions[part]=rows
import torch
from detectorscope import AuditableDetector
torch.set_num_threads(2)
detector=AuditableDetector.from_pretrained(str(args.model_dir),local_files_only=True,torch_dtype='float16')

def score(rows):
    results=[]
    for row in rows:
        tokens=len(detector.extractor.tokenizer(row['text'],truncation=False)['input_ids'])
        item={k:row[k] for k in ('id','truth','language','domain','generator')}
        item.update(input_hash=ev.digest(row['text'].encode()),input_tokens=tokens,status='unsupported')
        if 8<=tokens<=512:
            started=time.monotonic()
            with torch.inference_mode(): result=detector(row['text'],return_highlights=False)
            value=float(result.logit)
            assert math.isfinite(value)
            item.update(status='completed',score=value,elapsed_seconds=time.monotonic()-started)
        else: item['reason']='TOKEN_BUDGET_8_TO_512_NO_TRUNCATION'
        results.append(item)
        if len(results)%32==0: print('Scored fixed samples:',len(results),flush=True)
    return results

calibration=score(partitions['calibration'])
(args.output/'calibration-report.json').write_text(json.dumps(calibration,indent=2)+'\n')
human=[r['score'] for r in calibration if r['status']=='completed' and r['truth']=='human']
ai=[r for r in calibration if r['status']=='completed' and r['truth']=='ai']
assert len(human)>=100 and len(ai)>=100 and (len(human)+len(ai))/len(calibration)>=.9,'INSUFFICIENT_CALIBRATION_COVERAGE'
candidates=sorted({math.nextafter(v,math.inf) for v in human})
threshold=next(v for v in candidates if math.isfinite(v) and sum(s>=v for s in human)/len(human)<=.05)
policy={'direction':'higher','score_kind':'detectorscope_logit','threshold':threshold,'decision_rule':'threshold_gte',
        'language':args.language,'manifest_sha256':frozen['manifest_sha256'],'empirical_calibration_fp_budget':.05,
        'model_revision':'9baaff9e2d1cdb79cafa90cdb27811b847e69dae','dtype':'float16','head':'logreg','tau':.85,
        'conversion_report_sha256':hashlib.sha256((root/'detectorscope-conversion-results.json').read_bytes()).hexdigest(),
        'production_enabled':False,'calibration_summary':summary(calibration,threshold)}
with (args.output/'frozen-policy.json').open('x') as stream: json.dump(policy,stream,indent=2);stream.flush();os.fsync(stream.fileno())
heldout=score(partitions['heldout'])
assert resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024<=10*1024**3,'FINAL_PEAK_RSS_EXCEEDS_BUDGET'
report={'language':args.language,'threshold':threshold,'overall':summary(heldout,threshold),
        'groups':grouped_summary(heldout,threshold),'samples':heldout,'peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'limitations':['Upstream labels and independence not independently verified.','Coverage excludes unsupported length without truncation.',
        'Correlated samples; confidence intervals may be optimistic.','No commercial clearance or production activation.']}
(args.output/'heldout-report.json').write_text(json.dumps(report,indent=2)+'\n')
