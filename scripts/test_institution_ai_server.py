"""Actions-only optional CPU AI Compose acceptance; synthetic text, real model.

Creates a random disposable project. Does not build, install or infer on the host;
all model preparation/inference occurs in the explicitly supplied optional image.
Never uploads fixture inputs, credentials, backups, model weights or service logs.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from types import SimpleNamespace

PHASE='preflight'
PHASES={'preflight','new-deployment','new-credentials','new-infrastructure','new-initialization','new-account','new-start','default-disabled','prepare','activate','infer','cancel','backup','restore','reactivate','tamper','cleanup'}


def run(command,**kwargs):
    return subprocess.run(command,check=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=kwargs.pop('timeout',300),**kwargs).stdout


def inspect(identity,kind='container'):
    return json.loads(run(['docker',kind,'inspect',identity]))[0]


def main():
    global PHASE
    assert os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform.startswith('linux') and os.geteuid()==0
    parser=argparse.ArgumentParser()
    for name in ('base-image','ai-image','expected-commit','engine'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    assert args.engine in ('mpu-zh-v3','mpu-en-v3','desklib-en-v1.01')
    for identity in (args.base_image,args.ai_image):assert re.fullmatch('sha256:[0-9a-f]{64}',identity)
    assert re.fullmatch('[0-9a-f]{40}',args.expected_commit)
    workspace=pathlib.Path(os.environ['TEST_WORKSPACE']).resolve(strict=True)
    assert workspace==pathlib.Path(__file__).resolve().parent.parent
    project='workproof-server-ci-'+secrets.token_hex(6)
    for command in (['docker','ps','--all','--quiet'],['docker','volume','ls','--quiet'],['docker','network','ls','--quiet']):
        assert not run(command+['--filter','label=com.docker.compose.project='+project]).strip()
    existing_volumes=set(run(['docker','volume','ls','--format','{{.Name}}']).decode().splitlines())
    assert not existing_volumes.intersection(project+'_'+role for role in backup_roles|{'ai_models'})
    prior={key:os.environ.get(key) for key in ('COMPOSE_PROJECT_NAME','WORKPROOF_HTTP_PORT')}
    os.environ.update(COMPOSE_PROJECT_NAME=project,WORKPROOF_HTTP_PORT='18083')
    model_volume=project+'_ai_models'
    created=False
    model_owner=None
    with tempfile.TemporaryDirectory(prefix='workproof-ai-server-ci-') as temporary:
        private=pathlib.Path(temporary);private.chmod(0o700)
        deployment=private/'deployment';deployment.mkdir(mode=0o700)
        output=private/'backups';output.mkdir(mode=0o700)
        for source in (workspace/'deploy/institution').iterdir():
            if source.is_file() and source.suffix in ('.py','.sh'):
                shutil.copyfile(source,deployment/source.name)
        template=workspace/'deploy/institution/compose.yaml'
        canonical=json.loads(run(['docker','compose','--file',str(template),'--project-name',project,'--profile','tools','config','--format','json']))
        assert {'prepare','initialize','account','app','database','cache'}<=set(canonical['services'])
        for service in canonical['services'].values():
            if service['image']=='workproof-institution:local':service['image']=args.base_image
            service['pull_policy']='never'
        (deployment/'compose.yaml').write_text(json.dumps(canonical),encoding='utf-8')
        compose=['docker','compose','--file',str(deployment/'compose.yaml'),'--project-name',project]
        # Load the actual coordinator from this fixture's deployment directory so
        # its fixed sibling Compose path selects only this disposable project.
        sys.path.insert(0,str(deployment))
        import backup_coordinator as backup
        spec=importlib.util.spec_from_file_location('optional_ai_prepare',workspace/'deploy/institution-ai/prepare_ai.py')
        prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
        spec=importlib.util.spec_from_file_location('optional_ai_reactivate',workspace/'deploy/institution-ai/reactivate_ai.py')
        reactivate=importlib.util.module_from_spec(spec);spec.loader.exec_module(reactivate)
        def service(name):
            identity=run(compose+['ps','--all','--quiet',name]).decode().strip()
            value=inspect(identity)
            assert value['Config']['Labels']['com.docker.compose.project']==project
            return value
        def request(path,data=None,token=None,method=None):
            headers={'Content-Type':'application/octet-stream' if isinstance(data,bytes) else 'application/json'}
            if token:headers['Authorization']='Bearer '+token
            encoded=data if isinstance(data,bytes) else json.dumps(data).encode() if data is not None else None
            try:response=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18083'+path,data=encoded,headers=headers,method=method),timeout=20)
            except urllib.error.HTTPError as error:response=error
            with response:return response.status,json.loads(response.read())
        def login():
            deadline=time.monotonic()+150
            while time.monotonic()<deadline:
                try:
                    if request('/api/health')[0]==200:break
                except (urllib.error.URLError,TimeoutError,ConnectionError):pass
                time.sleep(1)
            else:raise AssertionError('AI fixture app not healthy')
            captcha=request('/api/auth/captcha')[1]['data']
            return request('/api/auth/login',{'username':'admin','password':account['password'],
                'captchaUuid':captcha['uuid'],'captcha':captcha['code']})[1]['data']['token']
        def wait_task(identity,token):
            for _ in range(260):
                code,value=request('/api/workproof/analysis/tasks/'+identity,token=token)
                assert code==200 and value['code']==200
                if value['data']['state'] in ('done','failed','cancelled','timeout','cleanup_failed'):return value['data']
                time.sleep(.5)
            raise AssertionError('AI task deadline exceeded')
        try:
            PHASE='new-deployment'
            created=True
            PHASE='new-credentials'
            run(compose+['run','--rm','-T','prepare'])
            PHASE='new-infrastructure'
            run(compose+['up','--detach','database','cache'])
            PHASE='new-initialization'
            run(compose+['run','--rm','-T','initialize'])
            PHASE='new-account'
            account=json.loads(run(compose+['run','--rm','-T','account']))
            PHASE='new-start'
            run(compose+['up','--detach','app']);token=login()
            PHASE='default-disabled'
            assert request('/api/workproof/analysis/capabilities')[0]==401
            caps=request('/api/workproof/analysis/capabilities',token=token)[1]['data']
            assert all(not entry['configured'] for entry in caps['engines'])
            run(compose+['stop','--timeout','60','app'])
            PHASE='prepare'
            password=secrets.token_urlsafe(32).encode()
            override=private/'ai-override.json'
            prepare.prepare(SimpleNamespace(deployment_dir=str(deployment),project=project,backup=str(output/'before-ai.enc'),
                base_image=args.base_image,ai_image=args.ai_image,expected_commit=args.expected_commit,
                override_output=str(override),engine=[args.engine],allow_model_download=True,synthetic_self_test=True),password)
            model_owner=inspect(model_volume,'volume')['Labels'][prepare.LABEL]
            assert not service('app')['State']['Running']
            config=json.loads(override.read_text())
            assert config['services']['app']['environment']['WORKPROOF_AI_ACTIVATE']=='1'
            assert config['services']['app']['environment']['WORKPROOF_AI_IMAGE_ID']==args.ai_image
            active=compose+['--file',str(override)]
            PHASE='activate';run(active+['up','--detach','app']);token=login()
            assert service('app')['Image']==args.ai_image
            caps=request('/api/workproof/analysis/capabilities',token=token)[1]['data']
            assert {entry['id'] for entry in caps['engines'] if entry['configured']}=={args.engine}
            endpoint='/api/workproof/analysis/tasks/'+args.engine+'/txt'
            assert request(endpoint,b'consent denial fixture',token)[0]==400
            text=('This synthetic paragraph is used only to exercise a reference classifier in continuous integration. It is not a benchmark and its score must not be interpreted as evidence of authorship. ')*3
            if args.engine=='mpu-zh-v3':text='这是一段用于持续集成的合成文字，只检查中文检测模型是否能够安全加载和返回数值。这不是准确率测试，不代表模型能够确认作者身份，也不能单独用于判断学术不端。模型输出必须结合来源、修改过程和人工判断。'*2
            sample=text.encode();PHASE='infer'
            code,submitted=request(endpoint+'?consent=true',sample,token)
            assert code==200 and submitted['code']==200
            result=wait_task(submitted['data']['id'],token)
            assert result['state']=='done'
            report=result['report']
            expected=json.loads((workspace/'tools/ai-assessment/engines.json').read_text())[args.engine]
            assert report['status']=='completed' and report['engine_id']==args.engine and report['model']==expected['model']
            assert report['model_revision']==expected['revision'] and report['score_kind']==expected['score_kind']
            assert report['artifact_hash']==hashlib.sha256(sample).hexdigest() and report['network_used'] is False
            assert report['calibration'] is None and set(report['raw_scores'])=={'Human','AI'}
            assert abs(sum(report['raw_scores'].values())-1)<.0001 and text not in json.dumps(report)
            PHASE='cancel'
            second=request(endpoint+'?consent=true',sample,token)[1]['data']['id']
            assert request('/api/workproof/analysis/tasks/'+second,token=token,method='DELETE')[0]==200
            cancelled=wait_task(second,token)
            assert cancelled['state']=='cancelled' and 'report' not in cancelled
            clean="import pathlib;assert not list(pathlib.Path('/tmp').glob('workproof-ai-*'))"
            run(compose+['exec','-T','app','python3','-c',clean])
            run(active+['stop','--timeout','60','app'])
            PHASE='backup'
            backup.backup(output/'after-ai.enc',password)
            assert not service('app')['State']['Running']
            PHASE='restore'
            restored=subprocess.run([sys.executable,str(workspace/'scripts/test_restore_new.py'),'--input',str(output/'after-ai.enc'),
                '--expected-image',args.ai_image,'--expected-commit',args.expected_commit,'--source-project',project,'--password-stdin'],
                input=password+b'\n',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=900)
            if restored.returncode!=0:
                # Relay only fixed phase identifiers, never child logs or inputs.
                match=re.search(rb'RESTORE_PHASE=([a-z-]{1,64}); RESTORE_TEST_PHASE=([a-z-]{1,64})',restored.stderr[-65536:])
                if match:print('AI_RESTORE_PHASE='+match[1].decode()+'; AI_RESTORE_TEST_PHASE='+match[2].decode(),file=sys.stderr)
            assert restored.returncode==0, 'AI-disabled restored deployment acceptance failed'
            PHASE='reactivate'
            config_volume=backup.volume(service('app'),'/private/config')
            def receipt_bytes():
                # Read only this fixture's private receipt; never print or upload.
                return run(['docker','run','--rm','--network','none','--user','10001:10001','--entrypoint','python3',
                    '--mount',f'type=volume,src={config_volume},dst=/private/config,readonly',args.ai_image,
                    '-c',"from pathlib import Path;import sys;sys.stdout.buffer.write(Path('/private/config/ai.json').read_bytes())"])
            before_receipt=receipt_bytes()
            reactivated_override=private/'ai-reactivated.json'
            def reactivation_arguments(target,archive):
                return SimpleNamespace(deployment_dir=str(deployment),project=project,backup=str(output/archive),
                    base_image=args.base_image,ai_image=args.ai_image,expected_commit=args.expected_commit,
                    override_output=str(target),model_volume=model_volume,model_source_project=project,
                    synthetic_self_test=True)
            reactivate.reactivate(reactivation_arguments(reactivated_override,'before-reactivation.enc'),password)
            assert receipt_bytes()==before_receipt and not service('app')['State']['Running']
            reactivated_bytes=reactivated_override.read_bytes()
            reactivated_config=json.loads(reactivated_bytes)
            assert reactivated_config['services']['app']['image']==args.ai_image
            assert reactivated_config['services']['app']['environment']['WORKPROOF_AI_ACTIVATE']=='1'
            assert reactivated_config['volumes']['ai_models']['name']==model_volume
            reactivated=compose+['--file',str(reactivated_override)]
            run(reactivated+['up','--detach','app']);token=login()
            caps=request('/api/workproof/analysis/capabilities',token=token)[1]['data']
            assert {entry['id'] for entry in caps['engines'] if entry['configured']}=={args.engine}
            run(reactivated+['stop','--timeout','60','app'])
            assert receipt_bytes()==before_receipt
            try:reactivate.reactivate(reactivation_arguments(reactivated_override,'refused-overwrite.enc'),password)
            except Exception:pass
            else:raise AssertionError('Existing activation override was replaced')
            assert reactivated_override.read_bytes()==reactivated_bytes and receipt_bytes()==before_receipt
            assert not service('app')['State']['Running']
            PHASE='tamper'
            # Change one small tokenizer/config file only inside this owned model
            # volume, while application is stopped. No runtime or source mutation.
            file_name='config.json'
            tamper="import pathlib;p=pathlib.Path('/models')/"+repr(args.engine)+"/"+repr(file_name)+";p.write_bytes(p.read_bytes()+b' ')"
            run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',
                f'type=volume,src={model_volume},dst=/models',args.ai_image,'-c',tamper])
            config_volume=backup.volume(service('app'),'/private/config')
            validate="import sys,pathlib;sys.path.insert(0,'/opt/workproof-ai');import ai_runtime as r;v=r.read_receipt(pathlib.Path('/private/config/ai.json'));r.verify_models(r.MODEL_ROOT,v)"
            refused=subprocess.run(['docker','run','--rm','--network','none','--user','10001:10001','--entrypoint','/opt/workproof-ai/venv/bin/python',
                '--mount',f'type=volume,src={model_volume},dst=/opt/workproof-ai/models,readonly',
                '--mount',f'type=volume,src={config_volume},dst=/private/config,readonly',args.ai_image,'-c',validate],
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=180)
            assert refused.returncode!=0 and not service('app')['State']['Running']
            refused_override=private/'refused-tampered-ai.json'
            try:reactivate.reactivate(reactivation_arguments(refused_override,'before-tampered-reactivation.enc'),password)
            except Exception:pass
            else:raise AssertionError('Tampered model was reactivated')
            assert not refused_override.exists() and receipt_bytes()==before_receipt
            assert not service('app')['State']['Running']
            print('PASS optional CPU AI Compose: default disabled, explicit download/offline preparation, real consented HTTP inference, cancellation and cleanup, encrypted backup, restored AI disabled, explicit offline reactivation without receipt mutation, existing override refusal, tampered model reactivation refusal; synthetic inputs only')
        finally:
            original_phase=PHASE;PHASE='cleanup'
            if created:
                # Only resources of this random CI project are eligible. No down
                # against an implicit/default project and no global prune/kill.
                for identity in run(['docker','ps','--all','--quiet','--filter','label=com.docker.compose.project='+project]).decode().splitlines():
                    value=inspect(identity)
                    assert value['Config']['Labels']['com.docker.compose.project']==project
                    run(['docker','rm','--force',value['Id']])
                for identity in run(['docker','network','ls','--quiet','--filter','label=com.docker.compose.project='+project]).decode().splitlines():
                    value=inspect(identity,'network');assert value['Labels']['com.docker.compose.project']==project
                    run(['docker','network','rm',identity])
                for name in run(['docker','volume','ls','--quiet','--filter','label=com.docker.compose.project='+project]).decode().splitlines():
                    value=inspect(name,'volume');assert value['Labels']['com.docker.compose.project']==project
                    if name==model_volume:
                        assert value['Labels'].get(prepare.LABEL) and (model_owner is None or value['Labels'][prepare.LABEL]==model_owner)
                    else:assert value['Labels']['com.docker.compose.volume'] in backup_roles
                    run(['docker','volume','rm',name])
            for key,value in prior.items():
                if value is None:os.environ.pop(key,None)
                else:os.environ[key]=value
            PHASE=original_phase


backup_roles={'app_config','initial_account','mysql_root_secret','mysql_app_secret','app_data','mysql_data','cache_data'}
if __name__=='__main__':
    try:main()
    except BaseException as error:
        # No command arguments, server messages or fixture credentials in logs.
        kind=type(error).__name__
        if kind not in ('AssertionError','CalledProcessError','TimeoutExpired','ValueError','CoordinatorError'):
            kind='other'
        code=str(error.returncode) if isinstance(error,subprocess.CalledProcessError) else 'none'
        print('AI_SERVER_TEST_PHASE='+(PHASE if PHASE in PHASES else 'unknown')+'; type='+kind+'; exit='+code,file=sys.stderr);sys.exit(1)
