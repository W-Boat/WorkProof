"""Pure-stdlib optional CPU runtime/model validation; no downloads or inference."""
import argparse
import hashlib
import importlib.metadata
import json
import os
import pathlib
import re
import stat
import sys

ROOT=pathlib.Path('/opt/workproof-ai')
PYTHON=ROOT/'venv/bin/python'
MODEL_ROOT=ROOT/'models'
CONFIG_RECORD='ai.json'
PENDING='.ai-preparing.json'
FORMAT='workproof-institution-ai/1'
TOOLS=('detector.py','documents.py','desklib_backend.py','engines.json','requirements.txt','ai_runtime.py','prepare_ai.py')
PINS={'torch':'2.15.0','transformers':'5.22.1','tokenizers':'0.23.3','huggingface-hub':'2.4.0','safetensors':'0.8.0'}
FIELDS={'format','status','active','baseImageId','aiImageId','sourceCommit','runtimeSha256','engines','preparedAt'}


def unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Duplicate AI JSON field')
        result[key]=value
    return result


def decode(data):
    def invalid(value):raise ValueError('Nonfinite AI JSON')
    return json.loads(data,object_pairs_hook=unique,parse_constant=invalid)


def digest(value):return isinstance(value,str) and re.fullmatch('[0-9a-f]{64}',value) is not None


def open_file(path):
    path=pathlib.Path(path)
    if not path.is_absolute() or '..' in path.parts:raise ValueError('Absolute AI path required')
    parent=os.open('/',os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parent.parts[1:]:
            child=os.open(component,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,dir_fd=parent)
            os.close(parent);parent=child
        return os.open(path.name,os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,dir_fd=parent)
    finally:os.close(parent)


def file_bytes(path,maximum,owner=None,mode=None):
    # Open every parent separately: no symlinked runtime/model directories.
    fd=open_file(path)
    with os.fdopen(fd,'rb') as source:
        before=os.fstat(source.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>maximum or
                (owner is not None and before.st_uid!=owner) or (mode is not None and stat.S_IMODE(before.st_mode)!=mode)):
            raise ValueError('Unsafe AI file')
        data=source.read(maximum+1)
        after=os.fstat(source.fileno())
        if len(data)>maximum or (before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise ValueError('AI file changed')
        return data


def hash_file(path,maximum=8*1024**3,model=False):
    # Stream large weights rather than copying them into validation memory.
    source=open_file(path)
    with os.fdopen(source,'rb') as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>maximum:raise ValueError('Invalid AI file')
        if model and (before.st_uid!=0 or before.st_gid!=10001 or stat.S_IMODE(before.st_mode)!=0o640):raise ValueError('Unsafe model file')
        h=hashlib.sha256();length=0
        for block in iter(lambda:stream.read(1024**2),b''):
            h.update(block);length+=len(block)
            if length>maximum:raise ValueError('Model exceeds limit')
        after=os.fstat(stream.fileno())
        if (length!=before.st_size or (before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns)):raise ValueError('AI file changed')
        return {'sha256':h.hexdigest(),'bytes':length}


def catalogue():return decode(file_bytes(ROOT/'engines.json',65536,0,0o444))


def validate_receipt(data):
    value=decode(data)
    if type(value) is not dict or set(value)!=FIELDS or value['format']!=FORMAT or value['status']!='prepared' or type(value['active']) is not bool:
        raise ValueError('Invalid AI receipt')
    for key in ('baseImageId','aiImageId'):
        if not isinstance(value[key],str) or not re.fullmatch('sha256:[0-9a-f]{64}',value[key]):raise ValueError('Invalid AI image')
    if (not isinstance(value['sourceCommit'],str) or not re.fullmatch('[0-9a-f]{40}',value['sourceCommit']) or
            not digest(value['runtimeSha256']) or type(value['preparedAt']) is not int or value['preparedAt']<0):raise ValueError('Invalid AI identity')
    engines=value['engines']
    if type(engines) is not dict or not 1<=len(engines)<=3:raise ValueError('Explicit AI engines required')
    allowed=catalogue()
    for engine,item in engines.items():
        if engine not in allowed or type(item) is not dict or set(item)!={'model','revision','files','modelReceiptSha256'}:raise ValueError('Unknown AI engine')
        cfg=allowed[engine]
        if item['model']!=cfg['model'] or item['revision']!=cfg['revision'] or not digest(item['modelReceiptSha256']):raise ValueError('Unexpected model revision')
        if type(item['files']) is not dict or set(item['files'])!=set(cfg['files']):raise ValueError('Model files differ')
        total=0
        for name,entry in item['files'].items():
            if pathlib.PurePosixPath(name).name!=name or type(entry) is not dict or set(entry)!={'sha256','bytes'}:raise ValueError('Invalid model inventory')
            if not digest(entry['sha256']) or type(entry['bytes']) is not int or not 0<=entry['bytes']<=8*1024**3:raise ValueError('Invalid model file')
            if name in cfg.get('expected_sha256',{}) and entry['sha256']!=cfg['expected_sha256'][name]:raise ValueError('Pinned model digest differs')
            total+=entry['bytes']
        if total>12*1024**3:raise ValueError('Model inventory exceeds limit')
    return value


def read_receipt(path):
    data=file_bytes(path,128*1024,10001,0o600)
    if pathlib.Path(path).lstat().st_gid!=10001:raise ValueError('Invalid AI receipt group')
    return validate_receipt(data)


def runtime_manifest(base):
    inventory=sorted([{'name':dist.metadata['Name'],'version':dist.version} for dist in importlib.metadata.distributions()],key=lambda x:x['name'].lower())
    by_name={entry['name'].lower().replace('_','-'):entry['version'] for entry in inventory}
    for name,version in PINS.items():
        actual=by_name.get(name,'')
        if actual.split('+')[0]!=version:raise ValueError('CPU runtime version differs')
    if sys.version_info[:2]!=(3,12):raise ValueError('Python 3.12 required')
    return {'format':'workproof-ai-runtime/1','baseImageId':base,'pythonVersion':sys.version,
        'python':hash_file(PYTHON,64*1024**2),'inventory':inventory,'tools':{name:hash_file(ROOT/name,1024**2) for name in TOOLS}}


def verify_runtime():
    data=file_bytes(ROOT/'runtime.json',1024**2,0,0o444)
    recorded=decode(data)
    # Run this function with the venv interpreter, so metadata describes that
    # immutable runtime rather than the system Python used for host orchestration.
    if pathlib.Path(sys.executable)!=PYTHON:raise ValueError('Use pinned AI interpreter')
    if runtime_manifest(recorded['baseImageId'])!=recorded:raise ValueError('Runtime inventory differs')
    return recorded


def model_inventory(root,engines):
    allowed=catalogue();result={}
    root=pathlib.Path(root)
    def directory(path):
        info=path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_gid!=10001 or stat.S_IMODE(info.st_mode)!=0o750:raise ValueError('Unsafe model directory')
    directory(root)
    if set(os.listdir(root))!=set(engines):raise ValueError('Unexpected or unselected model directories')
    for engine in engines:
        cfg=allowed[engine];folder=root/engine;directory(folder)
        if set(os.listdir(folder))!=set(cfg['files'])|{'workproof-model.json'}:raise ValueError('Unknown model directory contents')
        files={name:hash_file(folder/name,model=True) for name in cfg['files']}
        model_data=file_bytes(folder/'workproof-model.json',65536,0,0o640)
        if (folder/'workproof-model.json').lstat().st_gid!=10001:raise ValueError('Model receipt group differs')
        evidence=decode(model_data)
        if evidence!={'model':cfg['model'],'revision':cfg['revision'],'sha256':{name:item['sha256'] for name,item in files.items()}}:raise ValueError('Model preparation record differs')
        result[engine]={'model':cfg['model'],'revision':cfg['revision'],'files':files,'modelReceiptSha256':hashlib.sha256(model_data).hexdigest()}
    return result


def verify_models(root,receipt):
    if model_inventory(root,receipt['engines'])!=receipt['engines']:raise ValueError('Models differ from AI receipt')


def activation_environment(path, expected_image):
    value=read_receipt(path)
    if value['active'] is not True or value['aiImageId']!=expected_image:
        raise ValueError('Explicit AI image activation differs')
    manifest=verify_runtime()
    runtime_data=file_bytes(ROOT/'runtime.json',1024**2,0,0o444)
    if (manifest['baseImageId']!=value['baseImageId'] or
            hashlib.sha256(runtime_data).hexdigest()!=value['runtimeSha256']):
        raise ValueError('Prepared runtime differs')
    verify_models(MODEL_ROOT,value)
    return {'WORKPROOF_AI_ENABLED':'true','WORKPROOF_AI_PYTHON':str(PYTHON),
            'WORKPROOF_AI_SCRIPT':str(ROOT/'detector.py'),'WORKPROOF_AI_MODELS':str(MODEL_ROOT)}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('operation',choices=['build','verify']);parser.add_argument('--base-image');args=parser.parse_args()
    if args.operation=='build':
        if not args.base_image or not re.fullmatch('sha256:[0-9a-f]{64}',args.base_image):raise ValueError('Pinned base image required')
        target=ROOT/'runtime.json'
        with target.open('x') as output:json.dump(runtime_manifest(args.base_image),output,sort_keys=True)
        target.chmod(0o444)
    else:verify_runtime()
