"""CI-only real weights smoke test; no accuracy or generalization claim."""
import json,os,pathlib,subprocess,sys
assert os.environ.get('GITHUB_ACTIONS')=='true'
engine=os.environ.get('WORKPROOF_TEST_ENGINE','roberta-gpt2-reference')
zh=engine=='mpu-zh-v3';language='zh' if zh else 'en'
def run(request):
    result=subprocess.run([sys.executable,'tools/ai-assessment/detector.py','infer','--model-dir','/tmp/workproof-ai-model','--engine',engine],input=json.dumps(request),capture_output=True,text=True,timeout=120)
    assert result.returncode==0,result.stderr[:500]
    return json.loads(result.stdout)
short=run({'text':'你好' if zh else 'Hello world','language':language});assert short['status']=='insufficient_input'
unsupported=run({'text':'English input' if zh else '这是一段中文，用于检查不支持的语言。','language':'en' if zh else 'zh'});assert unsupported['status']=='unsupported'
text=('This synthetic paragraph is used only to exercise a reference classifier in continuous integration. '
      'It is not a benchmark and its score must not be interpreted as evidence of authorship. ')*3
if zh:text='这是一段用于持续集成的合成文字，只检查中文检测模型是否能够安全加载和返回数值。这不是准确率测试，不代表模型能够确认作者身份，也不能单独用于判断学术不端。模型输出必须结合来源、修改过程和人工判断。'*2
result=run({'text':text,'language':language});assert result['status']=='completed',result
assert result['score_kind']=='uncalibrated_class_softmax' and not result['network_used'] and result['calibration'] is None
assert set(result['raw_scores'])==({'Human','AI'} if zh else {'Fake','Real'}) and abs(sum(result['raw_scores'].values())-1)<0.00001
pathlib.Path('ai-reference-results.json').write_text(json.dumps({'real_inference':result,'short_status':short['status'],'unsupported_language_status':unsupported['status'],'accuracy_validated':False},indent=2))
