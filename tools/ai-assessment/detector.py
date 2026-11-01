"""Optional local reference classifier; never part of the recording daemon."""
import argparse,hashlib,json,os,pathlib,sys

LIMITATIONS=[
             'Class softmax is not the proportion of AI-generated content or a calibrated authorship probability.',
             'Do not use alone for misconduct decisions. No identity or original certificate is verified.']
ENGINES=json.loads(pathlib.Path(__file__).with_name('engines.json').read_text(encoding='utf-8'))
def report(engine,status,**values):
    cfg=ENGINES[engine]
    return dict(protocol='workproof-ai-assessment/1',engine_id=engine,engine_version='1',model=cfg['model'],model_revision=cfg['revision'],status=status,limitations=cfg['limitations']+LIMITATIONS,**values)
def prepare(folder,engine):
    cfg=ENGINES[engine];model,revision,files=cfg['model'],cfg['revision'],cfg['files']
    from huggingface_hub import snapshot_download
    folder.mkdir(parents=True,exist_ok=True)
    snapshot_download(model,revision=revision,allow_patterns=files,local_dir=folder)
    hashes={name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in files}
    (folder/'workproof-model.json').write_text(json.dumps(dict(model=model,revision=revision,sha256=hashes),indent=2),encoding='utf-8')
    return report(engine,'prepared',network_used=True,notice='Explicit public model download; no user text read. Code, base-model and weights licenses require separate review.')
def infer(folder,request,engine):
    cfg=ENGINES[engine];model_id,revision,files=cfg['model'],cfg['revision'],cfg['files']
    respond=lambda status,**values:report(engine,status,**values)
    text=request.get('text')
    if not isinstance(text,str) or len(text.encode('utf-8'))>32768: return respond('error',reason='INVALID_OR_OVERSIZE_TEXT')
    identity=dict(input_hash=hashlib.sha256(text.encode('utf-8')).hexdigest(),network_used=False)
    cjk=sum('\u3400'<=c<='\u9fff' for c in text)
    if request.get('language')!=cfg['language'] or (cfg['language']=='en' and cjk):return respond('unsupported',reason='LANGUAGE_NOT_SUPPORTED_BY_SELECTED_ENGINE',**identity)
    if (cfg['language']=='en' and len(text.split())<80) or (cfg['language']=='zh' and cjk<80):return respond('insufficient_input',reason='AT_LEAST_80_WORDS_OR_CHINESE_CHARACTERS_REQUIRED',**identity)
    receipt=folder/'workproof-model.json'
    if not receipt.is_file():return respond('not_configured',**identity)
    evidence=json.loads(receipt.read_text(encoding='utf-8'))
    if evidence.get('model')!=model_id or evidence.get('revision')!=revision or set(evidence.get('sha256',{}))!=set(files):raise ValueError('MODEL_RECEIPT_MISMATCH')
    for name in files:
        if hashlib.sha256((folder/name).read_bytes()).hexdigest()!=evidence['sha256'][name]:raise ValueError('MODEL_FILE_CHANGED')
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1')
    import torch
    from transformers import AutoTokenizer,AutoModelForSequenceClassification
    torch.set_num_threads(2)
    tokenizer=AutoTokenizer.from_pretrained(folder,local_files_only=True,trust_remote_code=False)
    encoded=tokenizer(text,return_tensors='pt',truncation=False)
    if encoded['input_ids'].shape[1]>512:return respond('unsupported',reason='TEXT_EXCEEDS_512_TOKENS_NO_SILENT_TRUNCATION',**identity)
    model=AutoModelForSequenceClassification.from_pretrained(folder,local_files_only=True,trust_remote_code=False,use_safetensors=cfg['safetensors'],weights_only=True)
    if model.config.id2label!=dict(enumerate(cfg['config_labels'])):raise ValueError('UNEXPECTED_LABEL_MAPPING')
    model.eval()
    with torch.inference_mode():scores=torch.softmax(model(**encoded).logits,dim=-1)[0].tolist()
    if not all(0<=v<=1 for v in scores):raise ValueError('INVALID_MODEL_OUTPUT')
    return respond('completed',score_kind='uncalibrated_class_softmax',raw_scores=dict(zip(cfg['labels'],scores)),calibration=None,**identity)
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['prepare','infer']);parser.add_argument('--model-dir',required=True,type=pathlib.Path);parser.add_argument('--engine',choices=ENGINES,default='roberta-gpt2-reference');args=parser.parse_args()
    try:
        if args.action=='prepare':value=prepare(args.model_dir,args.engine)
        else:
            raw=sys.stdin.buffer.read(32769)
            if len(raw)>32768:raise ValueError('REQUEST_TOO_LARGE')
            request=json.loads(raw)
            if not isinstance(request,dict):raise ValueError('OBJECT_REQUIRED')
            value=infer(args.model_dir,request,args.engine)
    except Exception:
        # Never write document contents or private paths into logs.
        value=report(args.engine,'error',reason='LOCAL_MODEL_OR_REQUEST_FAILED')
    print(json.dumps(value,ensure_ascii=False))
    return 1 if value['status']=='error' else 0
if __name__=='__main__':sys.exit(main())
