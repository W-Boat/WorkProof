"""CI-only real weights smoke test; no accuracy or generalization claim."""
import json,os,pathlib,subprocess,sys
assert os.environ.get('GITHUB_ACTIONS')=='true'
def run(request):
    result=subprocess.run([sys.executable,'tools/ai-assessment/detector.py','infer','--model-dir','/tmp/workproof-ai-model'],input=json.dumps(request),capture_output=True,text=True,timeout=120)
    assert result.returncode==0,result.stderr[:500]
    return json.loads(result.stdout)
short=run({'text':'Hello world','language':'en'});assert short['status']=='insufficient_input'
chinese=run({'text':'这是一段中文，用于检查不支持的语言。','language':'zh'});assert chinese['status']=='unsupported'
text=('This synthetic paragraph is used only to exercise a reference classifier in continuous integration. '
      'It is not a benchmark and its score must not be interpreted as evidence of authorship. ')*3
result=run({'text':text,'language':'en'});assert result['status']=='completed',result
assert result['score_kind']=='uncalibrated_class_softmax' and not result['network_used'] and result['calibration'] is None
assert set(result['raw_scores'])=={'Fake','Real'} and abs(sum(result['raw_scores'].values())-1)<0.00001
pathlib.Path('ai-reference-results.json').write_text(json.dumps({'real_inference':result,'short_status':short['status'],'chinese_status':chinese['status'],'accuracy_validated':False},indent=2))
