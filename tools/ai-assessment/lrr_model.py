"""Explicit fixed-file preparation; ordinary verification is offline stdlib only."""
import hashlib
import json
import os
import pathlib
import shutil
import stat

MODEL='Qwen/Qwen3-0.6B-Base'
REVISION='da87bfb608c14b7cf20ba1ce41287e8de496c0cd'
WEIGHT_SHA256='cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba'
RECEIPT='lrr-model-receipt.json'


def catalogue():
    value=json.loads(pathlib.Path(__file__).with_name('lrr-model.json').read_text(encoding='utf-8'))
    if value['model']!=MODEL or value['revision']!=REVISION or value['files']['model.safetensors']['sha256']!=WEIGHT_SHA256:
        raise ValueError('INVALID_LRR_MODEL_CATALOGUE')
    return value


FILES=tuple(catalogue()['files'])


def inventory(folder):
    folder=pathlib.Path(folder).absolute()
    if any(p.is_symlink() for p in [folder,*folder.parents]) or not folder.is_dir():raise ValueError('INVALID_MODEL_DIRECTORY')
    expected=catalogue();result={}
    for name,item in expected['files'].items():
        if pathlib.PurePosixPath(name).name!=name:raise ValueError('INVALID_MODEL_FILENAME')
        fd=os.open(folder/name,os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size!=item['bytes']:
                raise ValueError('MODEL_FILE_SIZE_OR_TYPE_DIFFERS')
            digest=hashlib.file_digest(stream,'sha256').hexdigest();after=os.fstat(stream.fileno())
            if (before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise ValueError('MODEL_CHANGED')
        if digest!=item['sha256']:raise ValueError('MODEL_HASH_DIFFERS')
        result[name]={'bytes':before.st_size,'sha256':digest}
    return {'format':expected['format'],'model':MODEL,'revision':REVISION,'files':result}


def verify(folder):
    folder=pathlib.Path(folder)
    if set(os.listdir(folder))!=set(FILES)|{RECEIPT}:raise ValueError('UNKNOWN_MODEL_FILES')
    receipt=folder/RECEIPT;info=receipt.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>65536:raise ValueError('INVALID_MODEL_RECEIPT')
    expected=inventory(folder)
    if json.loads(receipt.read_text(encoding='utf-8'))!=expected:raise ValueError('MODEL_RECEIPT_DIFFERS')
    return expected


def prepare(folder):
    folder=pathlib.Path(folder).absolute()
    if os.path.lexists(folder) or any(p.is_symlink() for p in folder.parents):raise ValueError('NEW_MODEL_DIRECTORY_REQUIRED')
    folder.mkdir(mode=0o700)
    from huggingface_hub import hf_hub_download
    for name in FILES:hf_hub_download(repo_id=MODEL,revision=REVISION,filename=name,local_dir=folder)
    if any(p.is_symlink() for p in folder.rglob('*')):raise ValueError('DOWNLOADED_LINK_REFUSED')
    cache=folder/'.cache'
    if cache.exists():shutil.rmtree(cache)  # Only cache in our new private directory.
    if set(os.listdir(folder))!=set(FILES):raise ValueError('UNKNOWN_DOWNLOADED_FILES')
    value=inventory(folder)
    with (folder/RECEIPT).open('x',encoding='utf-8') as output:
        json.dump(value,output,sort_keys=True);output.flush();os.fsync(output.fileno())
    verify(folder)
