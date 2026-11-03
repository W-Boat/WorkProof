"""Explicit optional model preparation. No model downloads on ordinary startup.

Requires an exclusive administrator maintenance window and a stopped existing
deployment. Failure retains private pending state/model volume; no automatic retry,
deletion or restart. Commercial/model provenance gaps remain separately reviewed.
"""
import argparse
import hashlib
import json
import math
import os
import pathlib
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import time

PHASE='preflight'
PHASES={'preflight','backup','begin','download','offline-test','verify-stopped'}
LABEL='org.workproof.ai-preparation'


def internal(operation,identity,engines):
    import ai_runtime as runtime
    sys.path.insert(0,'/opt/workproof')
    import manage
    runtime.verify_runtime()
    engines=engines.split(',')
    allowed=runtime.catalogue()
    if len(engines)!=len(set(engines)) or not engines or any(engine not in allowed for engine in engines):raise ValueError('Explicit known engines required')
    identity=runtime.decode(identity)
    if set(identity)!={'baseImageId','aiImageId','sourceCommit','backupSha256'}:raise ValueError('Invalid preparation identity')
    for key in ('baseImageId','aiImageId'):
        if not re.fullmatch('sha256:[0-9a-f]{64}',identity[key]):raise ValueError('Invalid image identity')
    if not re.fullmatch('[0-9a-f]{40}',identity['sourceCommit']) or not runtime.digest(identity['backupSha256']):raise ValueError('Invalid preparation provenance')
    runtime_data=runtime.file_bytes(runtime.ROOT/'runtime.json',1024**2,0,0o444)
    if runtime.decode(runtime_data)['baseImageId']!=identity['baseImageId']:raise ValueError('Runtime base differs')
    if operation=='download':
        # This online helper has no application configuration or sample mounted.
        if set(os.listdir(runtime.MODEL_ROOT)):raise ValueError('Model destination is not new and empty')
        os.environ.update(HF_HOME='/tmp/workproof-hf',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1')
        import detector
        for engine in engines:
            folder=runtime.MODEL_ROOT/engine
            folder.mkdir(mode=0o700)
            detector.prepare(folder,engine)
            expected=set(allowed[engine]['files'])|{'workproof-model.json','.cache'}
            if not set(os.listdir(folder))<=expected:raise ValueError('Unknown downloaded model entry')
            for path in folder.rglob('*'):
                if path.is_symlink():raise ValueError('Downloaded symlink rejected')
            cache=folder/'.cache'
            if cache.exists():shutil.rmtree(cache)  # Own fresh helper-created cache only.
            for path in folder.iterdir():
                if not path.is_file():raise ValueError('Unknown downloaded directory')
                os.chown(path,0,10001);path.chmod(0o640)
            os.chown(folder,0,10001);folder.chmod(0o750)
        runtime.model_inventory(runtime.MODEL_ROOT,engines)
        return
    with manage.exclusive():
        pending=manage.CONFIG/runtime.PENDING
        final=manage.CONFIG/runtime.CONFIG_RECORD
        if os.path.lexists(final):raise ValueError('AI already prepared; no replacement')
        request={'format':'workproof-ai-pending/1','identity':identity,'engines':engines,
                 'runtimeSha256':hashlib.sha256(runtime_data).hexdigest()}
        directory=os.open(manage.CONFIG,os.O_RDONLY | os.O_DIRECTORY)
        try:
            if operation=='begin':
                if os.path.lexists(pending) or set(os.listdir(runtime.MODEL_ROOT)):raise ValueError('Interrupted or unknown preparation')
                if any(os.path.lexists(manage.CONFIG/name) for name in ('.initializing','.catalog-preparing.json','.jobs-preparing.json')):
                    raise ValueError('Other preparation is incomplete')
                manage.read_json(manage.CONFIG/'initialized.json',10001)
                manage.create_file(pending,json.dumps(request));os.fsync(directory)
                return
            if operation!='finish' or manage.read_json(pending,0)!=request:raise ValueError('Pending preparation differs')
            models=runtime.model_inventory(runtime.MODEL_ROOT,engines)
            for engine in engines:
                # Deliberately synthetic smoke input, never an accuracy benchmark.
                text=('This synthetic paragraph is used only to exercise a reference classifier in continuous integration. It is not a benchmark and its score must not be interpreted as evidence of authorship. ')*3
                if allowed[engine]['language']=='zh':
                    text='这是一段用于持续集成的合成文字，只检查中文检测模型是否能够安全加载和返回数值。这不是准确率测试，不代表模型能够确认作者身份，也不能单独用于判断学术不端。模型输出必须结合来源、修改过程和人工判断。'*2
                env={'PATH':'/usr/bin:/bin','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','DO_NOT_TRACK':'1'}
                def service_identity():
                    os.setgroups([]);os.setgid(10001);os.setuid(10001)
                result=subprocess.run([str(runtime.PYTHON),str(runtime.ROOT/'detector.py'),'infer','--engine',engine,
                    '--model-dir',str(runtime.MODEL_ROOT/engine)],input=json.dumps({'text':text,'language':allowed[engine]['language']}).encode(),
                    stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,check=True,timeout=120,preexec_fn=service_identity)
                if len(result.stdout)>65536:raise ValueError('Inference output exceeds limit')
                report=runtime.decode(result.stdout)
                if (report.get('protocol')!='workproof-ai-assessment/1' or report.get('status')!='completed' or
                        report.get('engine_id')!=engine or report.get('network_used') is not False or
                        report.get('model')!=allowed[engine]['model'] or report.get('model_revision')!=allowed[engine]['revision'] or
                        report.get('score_kind')!=allowed[engine]['score_kind'] or report.get('calibration','missing') is not None):raise ValueError('Offline smoke inference failed')
                scores=report.get('raw_scores')
                if (type(scores) is not dict or set(scores)!={'Human','AI'} or
                        any(type(score) not in (int,float) or not math.isfinite(score) or not 0<=score<=1 for score in scores.values()) or
                        abs(sum(scores.values())-1)>0.0001):raise ValueError('Invalid offline smoke scores')
            value={'format':runtime.FORMAT,'status':'prepared','active':True,'baseImageId':identity['baseImageId'],
                'aiImageId':identity['aiImageId'],'sourceCommit':identity['sourceCommit'],
                'runtimeSha256':request['runtimeSha256'],'engines':models,'preparedAt':int(time.time())}
            runtime.validate_receipt(json.dumps(value));runtime.verify_models(runtime.MODEL_ROOT,value)
            manage.create_file(final,json.dumps(value),owner=10001);os.fsync(directory)
            pending.unlink();os.fsync(directory)
        finally:os.close(directory)


def prepare(args,password):
    global PHASE
    if not sys.platform.startswith('linux') or os.geteuid()!=0 or not args.allow_model_download or not args.synthetic_self_test:
        raise ValueError('Linux root and explicit download/self-test authorization required')
    deployment=pathlib.Path(args.deployment_dir).absolute()
    if '..' in pathlib.Path(args.deployment_dir).parts or any(path.is_symlink() for path in [deployment,*deployment.parents]):raise ValueError('Unsafe deployment path')
    sys.path.insert(0,str(deployment));import backup_coordinator as backup
    if os.environ.get('COMPOSE_PROJECT_NAME')!=args.project or not re.fullmatch('[a-z0-9][a-z0-9_-]*',args.project):raise ValueError('Project differs')
    compose=['docker','compose','--file',str(deployment/'compose.yaml')]
    def service(name):
        value=backup.run(compose+['ps','--all','--quiet',name],capture_output=True).stdout.decode().strip()
        if not re.fullmatch('[0-9a-f]{12,64}',value):raise ValueError('Expected service')
        result=backup.inspect(value)
        if result['Config']['Labels'].get('com.docker.compose.project')!=args.project:raise ValueError('Service identity differs')
        return result
    app=service('app');base=backup.inspect(args.base_image);image=backup.inspect(args.ai_image)
    backup.stopped(app)
    if (not re.fullmatch('sha256:[0-9a-f]{64}',args.base_image) or not re.fullmatch('sha256:[0-9a-f]{64}',args.ai_image) or
            app['Image']!=args.base_image or base['Id']!=args.base_image or image['Id']!=args.ai_image or
            not re.fullmatch('[0-9a-f]{40}',args.expected_commit) or
            base['Config']['Labels'].get('org.opencontainers.image.revision')!=args.expected_commit or
            image['Config']['Labels'].get('org.workproof.ai.base-image')!=args.base_image or
            image['RootFS']['Layers'][:len(base['RootFS']['Layers'])]!=base['RootFS']['Layers']):raise ValueError('AI image ancestry differs')
    if not args.engine or len(args.engine)!=len(set(args.engine)) or any(engine not in ('mpu-zh-v3','mpu-en-v3','desklib-en-v1.01') for engine in args.engine):raise ValueError('Explicit engines required')
    volume=args.project+'_ai_models'
    existing=backup.run(['docker','volume','ls','--format','{{.Name}}'],capture_output=True).stdout.decode().splitlines()
    if volume in existing:raise ValueError('Existing model volume refused')
    config=backup.volume(app,'/private/config')
    output=pathlib.Path(args.override_output).absolute()
    if ('..' in pathlib.Path(args.override_output).parts or any(parent.is_symlink() for parent in [output.parent,*output.parent.parents]) or
            output.parent.stat().st_uid!=0 or stat.S_IMODE(output.parent.stat().st_mode)!=0o700 or os.path.lexists(output)):
        raise ValueError('Use a new override file under root-owned 0700 parent')
    probe="import pathlib,os;p=pathlib.Path('/private/config');assert (p/'initialized.json').is_file();assert not any(os.path.lexists(p/n) for n in ('ai.json','.ai-preparing.json','.initializing','.catalog-preparing.json','.jobs-preparing.json'))"
    backup.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',
        f'type=volume,src={config},dst=/private/config,readonly',args.base_image,'-c',probe],stdout=subprocess.DEVNULL)
    PHASE='backup';backup.backup(args.backup,password)
    baseline=backup.stopped(service('app'))
    hasher=hashlib.sha256()
    with pathlib.Path(args.backup).open('rb') as source:
        for block in iter(lambda:source.read(1024**2),b''):hasher.update(block)
    identity={'baseImageId':args.base_image,'aiImageId':args.ai_image,'sourceCommit':args.expected_commit,'backupSha256':hasher.hexdigest()}
    owner=secrets.token_hex(32)
    backup.run(['docker','volume','create','--label',LABEL+'='+owner,'--label','com.docker.compose.project='+args.project,
        '--label','com.docker.compose.volume=ai_models',volume])
    info=json.loads(backup.run(['docker','volume','inspect',volume],capture_output=True).stdout)[0]
    if info.get('Labels',{}).get(LABEL)!=owner:raise ValueError('Model volume collision')
    def helper(operation,online=False):
        nonlocal baseline
        helper_id=None
        try:
            command=['docker','create','--user','0:0','--read-only','--network','bridge' if online else 'none',
                '--label',LABEL+'='+owner,'--tmpfs','/tmp:rw,nosuid,nodev,mode=1777','--entrypoint','/opt/workproof-ai/venv/bin/python',
                '--mount',f'type=volume,src={volume},dst=/opt/workproof-ai/models'+(',readonly' if operation=='finish' else '')]
            if not online:command+=['--mount',f'type=volume,src={config},dst=/private/config']
            helper_id=backup.run(command+[args.ai_image,'/opt/workproof-ai/prepare_ai.py','_'+operation,json.dumps(identity),','.join(args.engine)],capture_output=True).stdout.decode().strip()
            if not re.fullmatch('[0-9a-f]{64}',helper_id):raise ValueError('Invalid helper')
            current=backup.inspect(helper_id)
            if current['Id']!=helper_id or current['Config']['Labels'].get(LABEL)!=owner:raise ValueError('Helper ownership differs')
            if backup.stopped(service('app'))!=baseline:raise ValueError('Application changed')
            backup.run(['docker','start','--attach',helper_id],stdout=subprocess.DEVNULL,timeout=2400 if online else 420)
            current=backup.inspect(helper_id)
            if current['State']['Running'] or current['State']['ExitCode']!=0:raise ValueError('AI preparation helper failed')
        finally:
            old={sig:signal.signal(sig,signal.SIG_IGN) for sig in (signal.SIGINT,signal.SIGTERM)}
            try:
                if helper_id and re.fullmatch('[0-9a-f]{64}',helper_id):
                    current=backup.inspect(helper_id)
                    if current['Id']==helper_id and current['Config']['Labels'].get(LABEL)==owner:backup.run(['docker','rm','--force',helper_id],stdout=subprocess.DEVNULL)
            finally:
                for sig,handler in old.items():signal.signal(sig,handler)
    PHASE='begin';helper('begin')
    PHASE='download';helper('download',True)
    PHASE='offline-test';helper('finish')
    PHASE='verify-stopped'
    if backup.stopped(service('app'))!=baseline:raise ValueError('App state changed')
    # This override is deliberately separate from canonical compose.yaml. A
    # restore generated from that template does not inherit activation.
    value={'services':{'app':{'image':args.ai_image,'pull_policy':'never',
        'environment':{'WORKPROOF_AI_ACTIVATE':'1','WORKPROOF_AI_IMAGE_ID':args.ai_image},
        'volumes':[{'type':'volume','source':'ai_models','target':'/opt/workproof-ai/models','read_only':True}]}},
        'volumes':{'ai_models':{'external':True,'name':volume}}}
    fd=os.open(output,os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as target:
        os.fchmod(target.fileno(),0o600);json.dump(value,target,sort_keys=True);target.flush();os.fsync(target.fileno())
    directory=os.open(output.parent,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)


def main():
    if sys.argv[1:2] and sys.argv[1] in ('_begin','_download','_finish'):
        internal(sys.argv[1][1:],*sys.argv[2:]);return
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('deployment-dir','project','backup','base-image','ai-image','expected-commit','override-output'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--engine',action='append',required=True)
    parser.add_argument('--allow-model-download',action='store_true',required=True)
    parser.add_argument('--synthetic-self-test',action='store_true',required=True)
    parser.add_argument('--password-stdin',action='store_true',required=True)
    args=parser.parse_args();raw=sys.stdin.buffer.read(1026)
    if not raw.endswith(b'\n'):raise ValueError('One passphrase line required')
    def cancel(signum,frame):raise ValueError('Cancelled')
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,cancel)
    prepare(args,raw[:-1])
    print('Optional models prepared and tested offline. Application remains stopped; activation requires verified optional runtime mounts. No commercial clearance.')


if __name__=='__main__':
    try:main()
    except Exception:
        print('AI_PREPARE_PHASE='+(PHASE if PHASE in PHASES else 'unknown')+'; failed; retain private pending state and model volume.',file=sys.stderr)
        sys.exit(1)
