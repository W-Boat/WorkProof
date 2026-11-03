"""Revalidate an existing prepared AI runtime and write a new activation override.

No model downloads, receipt rewrites, automatic startup or model-volume changes.
Requires stopped deployment, explicit original model-volume ownership and a fresh
encrypted backup. Restored projects may explicitly reuse a still-existing source
volume on the same Docker daemon; transporting weights is a separate operation.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import signal
import stat
import subprocess
import sys

LABEL='org.workproof.ai-reactivation'
PHASE='preflight'
PHASES={'preflight','backup','revalidate','publish'}


def reactivate(args,password):
    global PHASE
    if not sys.platform.startswith('linux') or os.geteuid()!=0 or not args.synthetic_self_test:
        raise ValueError('Linux root and explicit offline synthetic self-test required')
    deployment=pathlib.Path(args.deployment_dir).absolute()
    if '..' in pathlib.Path(args.deployment_dir).parts or any(p.is_symlink() for p in [deployment,*deployment.parents]):
        raise ValueError('Unsafe deployment path')
    sys.path.insert(0,str(deployment));import backup_coordinator as backup
    if (not re.fullmatch('[a-z0-9][a-z0-9_-]*',args.project) or
            os.environ.get('COMPOSE_PROJECT_NAME')!=args.project or
            not re.fullmatch('[a-z0-9][a-z0-9_-]*',args.model_source_project)):
        raise ValueError('Explicit project identity required')
    for identity in (args.base_image,args.ai_image):
        if not re.fullmatch('sha256:[0-9a-f]{64}',identity):raise ValueError('Immutable image required')
    if not re.fullmatch('[0-9a-f]{40}',args.expected_commit):raise ValueError('Source commit required')
    if (not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]*',args.model_volume) or
            args.model_volume!=args.model_source_project+'_ai_models'):
        raise ValueError('Original prepared model volume required')
    compose=['docker','compose','--file',str(deployment/'compose.yaml')]
    def app():
        identity=backup.run(compose+['ps','--all','--quiet','app'],capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{12,64}',identity):raise ValueError('Expected stopped application')
        value=backup.inspect(identity)
        if value['Config']['Labels'].get('com.docker.compose.project')!=args.project:raise ValueError('App project differs')
        return value
    current=app();baseline=backup.stopped(current)
    base=backup.inspect(args.base_image);image=backup.inspect(args.ai_image)
    if (current['Image'] not in (args.base_image,args.ai_image) or base['Id']!=args.base_image or image['Id']!=args.ai_image or
            base['Config']['Labels'].get('org.opencontainers.image.revision')!=args.expected_commit or
            image['Config']['Labels'].get('org.opencontainers.image.revision')!=args.expected_commit or
            image['Config']['Labels'].get('org.workproof.ai.base-image')!=args.base_image or
            image['RootFS']['Layers'][:len(base['RootFS']['Layers'])]!=base['RootFS']['Layers']):
        raise ValueError('Original prepared image ancestry differs')
    def model_identity():
        value=json.loads(backup.run(['docker','volume','inspect',args.model_volume],capture_output=True).stdout)[0]
        labels=value.get('Labels') or {}
        token=labels.get('org.workproof.ai-preparation','')
        if (value['Name']!=args.model_volume or value.get('Driver')!='local' or value.get('Options') or
                labels.get('com.docker.compose.project')!=args.model_source_project or
                labels.get('com.docker.compose.volume')!='ai_models' or not re.fullmatch('[0-9a-f]{64}',token)):
            raise ValueError('Model volume ownership differs')
        return (value['Name'],value['Driver'],value.get('CreatedAt'),tuple(sorted(labels.items())))
    models=model_identity()
    config=backup.volume(current,'/private/config')
    output=pathlib.Path(args.override_output).absolute()
    if ('..' in pathlib.Path(args.override_output).parts or any(p.is_symlink() for p in [output.parent,*output.parent.parents]) or
            output.parent.stat().st_uid!=0 or stat.S_IMODE(output.parent.stat().st_mode)!=0o700 or os.path.lexists(output)):
        raise ValueError('New override under root-owned 0700 parent required')
    PHASE='backup';backup.backup(args.backup,password)
    if backup.stopped(app())!=baseline or model_identity()!=models:raise ValueError('Deployment changed during backup')
    digest=hashlib.sha256()
    with pathlib.Path(args.backup).open('rb') as source:
        for block in iter(lambda:source.read(1024**2),b''):digest.update(block)
    identity={'baseImageId':args.base_image,'aiImageId':args.ai_image,'sourceCommit':args.expected_commit,'backupSha256':digest.hexdigest()}
    owner=secrets.token_hex(32);helper=None
    PHASE='revalidate'
    try:
        helper=backup.run(['docker','create','--user','0:0','--read-only','--network','none','--label',LABEL+'='+owner,
            '--tmpfs','/tmp:rw,nosuid,nodev,mode=1777','--entrypoint','/opt/workproof-ai/venv/bin/python',
            '--mount',f'type=volume,src={config},dst=/private/config,readonly',
            '--mount',f'type=volume,src={args.model_volume},dst=/opt/workproof-ai/models,readonly',
            args.ai_image,'/opt/workproof-ai/prepare_ai.py','_revalidate',json.dumps(identity),'record'],capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{64}',helper):raise ValueError('Invalid helper identity')
        owned=backup.inspect(helper)
        if owned['Id']!=helper or owned['Config']['Labels'].get(LABEL)!=owner or owned['Image']!=args.ai_image:
            raise ValueError('Helper ownership differs')
        if backup.stopped(app())!=baseline or model_identity()!=models:raise ValueError('Deployment changed')
        backup.run(['docker','start','--attach',helper],stdout=subprocess.DEVNULL,timeout=600)
        owned=backup.inspect(helper)
        if owned['State']['Running'] or owned['State']['ExitCode']!=0:raise ValueError('Offline revalidation failed')
    finally:
        previous={sig:signal.signal(sig,signal.SIG_IGN) for sig in (signal.SIGINT,signal.SIGTERM)}
        try:
            if helper and re.fullmatch('[0-9a-f]{64}',helper):
                owned=backup.inspect(helper)
                if owned['Id']!=helper or owned['Config']['Labels'].get(LABEL)!=owner:raise ValueError('Helper ownership lost')
                backup.run(['docker','rm','--force',helper],stdout=subprocess.DEVNULL)
        finally:
            for sig,handler in previous.items():signal.signal(sig,handler)
    if backup.stopped(app())!=baseline or model_identity()!=models:raise ValueError('Deployment changed during revalidation')
    PHASE='publish'
    value={'services':{'app':{'image':args.ai_image,'pull_policy':'never',
        'environment':{'WORKPROOF_AI_ACTIVATE':'1','WORKPROOF_AI_IMAGE_ID':args.ai_image},
        'volumes':[{'type':'volume','source':'ai_models','target':'/opt/workproof-ai/models','read_only':True}]}},
        'volumes':{'ai_models':{'external':True,'name':args.model_volume}}}
    fd=os.open(output,os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as target:
        os.fchmod(target.fileno(),0o600);json.dump(value,target,sort_keys=True);target.flush();os.fsync(target.fileno())
    directory=os.open(output.parent,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('deployment-dir','project','backup','base-image','ai-image','expected-commit','override-output','model-volume','model-source-project'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--synthetic-self-test',action='store_true',required=True)
    parser.add_argument('--password-stdin',action='store_true',required=True)
    args=parser.parse_args();raw=sys.stdin.buffer.read(1026)
    if not raw.endswith(b'\n'):raise ValueError('One passphrase line required')
    def cancel(signum,frame):raise ValueError('Cancelled')
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,cancel)
    reactivate(args,raw[:-1])
    print('Existing models revalidated offline. New activation override written; application remains stopped. No weights or preparation receipt changed.')


if __name__=='__main__':
    try:main()
    except Exception:
        print('AI_REACTIVATE_PHASE='+(PHASE if PHASE in PHASES else 'unknown')+'; failed; application remains stopped; no prepared records or models replaced.',file=sys.stderr)
        sys.exit(1)
