"""Optional local reference classifier; never part of the recording daemon."""
import argparse,hashlib,json,os,pathlib,sys

MODEL='openai-community/roberta-base-openai-detector'
REVISION='6cba99c003b711c7fe94f8a3aa2be35a792cb6fa'
FILES=['model.safetensors','config.json','tokenizer.json','tokenizer_config.json','vocab.json','merges.txt','README.md']
LIMITATIONS=['English GPT-2 reference detector; not calibrated for modern models or Chinese.',
             'Class softmax is not the proportion of AI-generated content or a calibrated authorship probability.',
             'Do not use alone for misconduct decisions. No identity or original certificate is verified.']
def report(status,**values):
    return dict(protocol='workproof-ai-assessment/1',engine_id='roberta-gpt2-reference',engine_version='1',model=MODEL,model_revision=REVISION,status=status,limitations=LIMITATIONS,**values)
def prepare(folder):
    from huggingface_hub import snapshot_download
    folder.mkdir(parents=True,exist_ok=True)
    snapshot_download(MODEL,revision=REVISION,allow_patterns=FILES,local_dir=folder)
    hashes={name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in FILES}
    (folder/'workproof-model.json').write_text(json.dumps(dict(model=MODEL,revision=REVISION,sha256=hashes),indent=2),encoding='utf-8')
    return report('prepared',network_used=True,notice='Weights downloaded explicitly; no user text was read. Model MIT declaration is in the pinned model card; runtime dependencies require separate review.')
def infer(folder,request):
    text=request.get('text')
    if not isinstance(text,str) or len(text.encode('utf-8'))>32768: return report('error',reason='INVALID_OR_OVERSIZE_TEXT')
    identity=dict(input_hash=hashlib.sha256(text.encode('utf-8')).hexdigest(),network_used=False)
    if request.get('language')!='en' or any('\u3400'<=c<='\u9fff' for c in text):return report('unsupported',reason='ENGLISH_ONLY_REFERENCE_MODEL',**identity)
    if len(text.split())<80:return report('insufficient_input',reason='AT_LEAST_80_WORDS_REQUIRED',**identity)
    receipt=folder/'workproof-model.json'
    if not receipt.is_file():return report('not_configured',**identity)
    evidence=json.loads(receipt.read_text(encoding='utf-8'))
    if evidence.get('model')!=MODEL or evidence.get('revision')!=REVISION or set(evidence.get('sha256',{}))!=set(FILES):raise ValueError('MODEL_RECEIPT_MISMATCH')
    for name in FILES:
        if hashlib.sha256((folder/name).read_bytes()).hexdigest()!=evidence['sha256'][name]:raise ValueError('MODEL_FILE_CHANGED')
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1')
    import torch
    from transformers import AutoTokenizer,AutoModelForSequenceClassification
    torch.set_num_threads(2)
    tokenizer=AutoTokenizer.from_pretrained(folder,local_files_only=True,trust_remote_code=False)
    encoded=tokenizer(text,return_tensors='pt',truncation=False)
    if encoded['input_ids'].shape[1]>512:return report('unsupported',reason='TEXT_EXCEEDS_512_TOKENS_NO_SILENT_TRUNCATION',**identity)
    model=AutoModelForSequenceClassification.from_pretrained(folder,local_files_only=True,trust_remote_code=False,use_safetensors=True)
    if model.config.id2label!={0:'Fake',1:'Real'}:raise ValueError('UNEXPECTED_LABEL_MAPPING')
    model.eval()
    with torch.inference_mode():scores=torch.softmax(model(**encoded).logits,dim=-1)[0].tolist()
    if not all(0<=v<=1 for v in scores):raise ValueError('INVALID_MODEL_OUTPUT')
    return report('completed',score_kind='uncalibrated_class_softmax',raw_scores={'Fake':scores[0],'Real':scores[1]},calibration=None,**identity)
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['prepare','infer']);parser.add_argument('--model-dir',required=True,type=pathlib.Path);args=parser.parse_args()
    try:
        if args.action=='prepare':value=prepare(args.model_dir)
        else:
            raw=sys.stdin.buffer.read(32769)
            if len(raw)>32768:raise ValueError('REQUEST_TOO_LARGE')
            request=json.loads(raw)
            if not isinstance(request,dict):raise ValueError('OBJECT_REQUIRED')
            value=infer(args.model_dir,request)
    except Exception:
        # Never write document contents or private paths into logs.
        value=report('error',reason='LOCAL_MODEL_OR_REQUEST_FAILED')
    print(json.dumps(value,ensure_ascii=False))
    return 1 if value['status']=='error' else 0
if __name__=='__main__':sys.exit(main())
