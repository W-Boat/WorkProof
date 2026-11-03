"""Actions-only synthetic bilingual smoke/resource acceptance, not accuracy eval."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys

assert os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform.startswith('linux')
import lrr_model
folder=pathlib.Path(os.environ['RUNNER_TEMP'])/'workproof-lrr-fixed-model'
lrr_model.prepare(folder)
samples={'en':('This synthetic paragraph is used only to exercise a reference language model in continuous integration. It is not an accuracy benchmark and its score must not be interpreted as evidence of authorship. ')*3,
    'zh':'这是一段用于持续集成的合成文字，只检查语言模型是否能够安全加载和返回数值。这不是准确率测试，不代表模型能够确认作者身份，也不能单独用于判断学术不端。模型输出必须结合来源、修改过程和人工判断。'*2}
reports=[]
for language,text in samples.items():
    env=dict(os.environ,HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1')
    process=subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('lrr_probe.py')),'infer','--model-dir',str(folder)],
        input=json.dumps({'text':text,'language':language}).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,timeout=120,check=True)
    assert len(process.stdout)<65536
    value=json.loads(process.stdout)
    assert value['status']=='completed' and value['model_revision']==lrr_model.REVISION
    assert value['calibration'] is None and value['network_used'] is False and value['direction']=='higher'
    assert value['statistics']['value']>=0 and 'raw_scores' not in value
    assert value['truncated'] is False and value['input_tokens']<=512
    assert value['peak_rss_kib']<6*1024**2 and value['elapsed_seconds']<120
    assert text not in json.dumps(value)
    reports.append({'language':language,'synthetic_sha256':hashlib.sha256(text.encode()).hexdigest(),'result':value})
# Reject tampering before a model can be imported/loaded by infer.
config=folder/'config.json';config.write_bytes(config.read_bytes()+b' ')
try:lrr_model.verify(folder)
except (ValueError,OSError):pass
else:raise AssertionError('Modified model accepted')
pathlib.Path('lrr-synthetic-results.json').write_text(json.dumps({'schema':'workproof-lrr-smoke/1',
    'source_commit':os.environ['GITHUB_SHA'],'accuracy_evaluated':False,'reports':reports,
    'scope':'Real fixed model, synthetic bilingual inference and resource budgets; no detector accuracy, threshold or production integration claim.'},indent=2)+'\n',encoding='utf-8')
print('PASS experimental fixed-model bilingual LRR synthetic inference, resource budgets and modified-file refusal; no accuracy claim')
