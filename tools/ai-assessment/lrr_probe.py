"""Experimental WorkProof causal-model LRR probe, not an official DetectLLM engine.

Formula reference: https://aclanthology.org/2023.findings-emnlp.827/
No threshold, authorship verdict, classification probability or accuracy claim.
Only explicit prepare downloads files; infer verifies fixed local bytes offline.
"""
import argparse
import json
import os
import pathlib
import re
import sys
import time


def infer(folder,request):
    import lrr_model
    identity={'protocol':'workproof-lrr-experiment/1','engine_id':'workproof-qwen3-lrr-experiment',
        'method_family':'causal_likelihood_rank_ratio','model':lrr_model.MODEL,'model_revision':lrr_model.REVISION,
        'score_kind':'negative_log_likelihood_log_rank_ratio','direction':'higher',
        'calibration':None,'network_used':False,'max_tokens':512,
        'limitations':['Experimental adaptation; Qwen and Chinese detection accuracy unvalidated.',
            'Ratio is not an AI probability, content percentage or authorship verdict.']}
    def result(status,**data):return dict(identity,status=status,**data)
    if type(request) is not dict or set(request)!={'text','language'}:raise ValueError('INVALID_REQUEST')
    text=request['text'];language=request['language']
    if language not in ('en','zh') or not isinstance(text,str):raise ValueError('INVALID_REQUEST')
    if len(text.encode('utf-8'))>65536:return result('unsupported',reason='TEXT_BUDGET_EXCEEDED')
    if (language=='en' and len(text.split())<80) or (language=='zh' and len(re.findall(r'[\u4e00-\u9fff]',text))<80):
        return result('insufficient_input',reason='AT_LEAST_80_WORDS_OR_CHINESE_CHARACTERS_REQUIRED')
    lrr_model.verify(folder)
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1')
    import torch
    from transformers import AutoTokenizer,AutoModelForCausalLM
    from lrr_math import compute_lrr
    torch.set_num_threads(2)
    tokenizer=AutoTokenizer.from_pretrained(folder,local_files_only=True,trust_remote_code=False)
    encoded=tokenizer(text,return_tensors='pt',add_special_tokens=False,truncation=False)
    count=int(encoded['input_ids'].shape[1])
    if count>512:return result('unsupported',reason='TOKEN_BUDGET_EXCEEDED',input_tokens=count)
    if count<2:return result('insufficient_input',reason='TWO_TOKENS_REQUIRED')
    started=time.monotonic()
    model=AutoModelForCausalLM.from_pretrained(folder,local_files_only=True,trust_remote_code=False,
        use_safetensors=True,dtype=torch.float32,attn_implementation='eager')
    model.eval()
    with torch.inference_mode():
        logits=model(**encoded,use_cache=False).logits[0,:-1,:]
        try:score=compute_lrr(logits,encoded['input_ids'][0,1:])
        except ValueError:return result('unsupported',reason='UNSCORABLE_NUMERIC_RESULT',input_tokens=count)
    import resource
    return result('completed',statistics=score,input_tokens=count,add_special_tokens=False,
        first_token_scored=False,truncated=False,elapsed_seconds=time.monotonic()-started,
        peak_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['prepare','infer'])
    parser.add_argument('--model-dir',required=True,type=pathlib.Path)
    parser.add_argument('--allow-model-download',action='store_true')
    args=parser.parse_args()
    if args.operation=='prepare':
        if not args.allow_model_download:raise ValueError('EXPLICIT_DOWNLOAD_REQUIRED')
        import lrr_model
        lrr_model.prepare(args.model_dir)
        print('Fixed experimental model prepared; no accuracy or commercial clearance claim.');return
    raw=sys.stdin.buffer.read(256*1024+1)
    if len(raw)>256*1024:raise ValueError('REQUEST_TOO_LARGE')
    def unique(pairs):
        value={}
        for key,item in pairs:
            if key in value:raise ValueError('DUPLICATE_REQUEST_FIELD')
            value[key]=item
        return value
    request=json.loads(raw,object_pairs_hook=unique)
    print(json.dumps(infer(args.model_dir,request),allow_nan=False))


if __name__=='__main__':
    try:main()
    except Exception:
        print('LRR probe failed; no scoring result. Inspect the fixed model/runtime privately.',file=sys.stderr);sys.exit(1)
