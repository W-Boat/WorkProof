"""Actions-only optional CPU runtime candidate; no model/sample volumes mounted.

Run after real server acceptance succeeds. Exports the exact tested image, its
runtime inventory and installed distribution notices, plus explicit admin tools.
No image build, model download or inference occurs here. This is not a commercial
clearance decision and does not package model weights or application credentials.
"""
import argparse
import gzip
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile

PHASE='preflight'
PHASES={'preflight','runtime','notices','export','reload','manifest'}


def run(command,**kwargs):
    return subprocess.run(command,check=True,stderr=subprocess.DEVNULL,
        timeout=kwargs.pop('timeout',600),**kwargs)


def capture(command,maximum):
    # Only immutable image/metadata commands: no deployment paths or secrets.
    value=run(command,stdout=subprocess.PIPE).stdout
    if len(value)>maximum:raise ValueError('Metadata output exceeds limit')
    return value


def inspect(identity):
    return json.loads(capture(['docker','image','inspect',identity],1024**2))[0]


def digest(path):
    with path.open('rb') as source:return hashlib.file_digest(source,'sha256').hexdigest()


def verify_export(path,image):
    """Identify the actual exported config and layer bytes, not a cached image."""
    files={};documents={};total=0
    config_id=image['Id'].split(':',1)[1]
    config_names={config_id+'.json','blobs/sha256/'+config_id}
    with tarfile.open(path,mode='r|gz') as archive:
        for member in archive:
            name=member.name;relative=pathlib.PurePosixPath(name)
            if (relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name or
                    name in files or not (member.isdir() or member.isfile())):
                raise ValueError('Unsafe image export member')
            if member.isdir():continue
            total+=member.size
            if total>12*1024**3 or len(files)>10000:raise ValueError('Image archive exceeds limit')
            source=archive.extractfile(member);hasher=hashlib.sha256();captured=bytearray()
            for block in iter(lambda:source.read(1024**2),b''):
                hasher.update(block)
                if name=='manifest.json' or name in config_names:
                    if len(captured)+len(block)>1024**2:raise ValueError('Image metadata exceeds limit')
                    captured.extend(block)
            files[name]=hasher.hexdigest()
            if name=='manifest.json' or name in config_names:documents[name]=json.loads(captured)
    manifest=documents.get('manifest.json')
    if type(manifest) is not list or len(manifest)!=1:raise ValueError('Exactly one exported image required')
    record=manifest[0];config_name=record['Config']
    if config_name not in config_names or files.get(config_name)!=config_id:raise ValueError('Exported image config digest differs')
    config=documents[config_name]
    if (config.get('os')!='linux' or config.get('architecture')!='amd64' or
            config.get('rootfs',{}).get('diff_ids')!=image['RootFS']['Layers']):
        raise ValueError('Exported image platform or layer ancestry differs')
    layers=record['Layers']
    if type(layers) is not list or len(layers)!=len(image['RootFS']['Layers']):raise ValueError('Exported layer inventory differs')
    for layer,expected in zip(layers,image['RootFS']['Layers']):
        # containerd exports stored (possibly compressed) content-addressed blobs;
        # legacy Docker archives expose uncompressed layer.tar / DiffID bytes.
        # https://github.com/containerd/containerd/blob/main/core/images/archive/exporter.go
        if re.fullmatch('blobs/sha256/[0-9a-f]{64}',layer):
            wanted=layer.rsplit('/',1)[1]
        else:wanted=expected.removeprefix('sha256:')
        if files.get(layer)!=wanted:raise ValueError('Exported layer bytes differ')


def main():
    global PHASE
    if os.environ.get('GITHUB_ACTIONS')!='true' or not sys.platform.startswith('linux'):
        raise ValueError('Isolated Linux Actions runner required')
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-image','ai-image','source-commit','base-run-id','engine','output'):
        parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    for value in (args.base_image,args.ai_image):
        if not re.fullmatch('sha256:[0-9a-f]{64}',value):raise ValueError('Immutable image required')
    if (not re.fullmatch('[0-9a-f]{40}',args.source_commit) or
            not re.fullmatch('[1-9][0-9]{0,19}',args.base_run_id) or
            args.engine not in ('mpu-en-v3','mpu-zh-v3','desklib-en-v1.01')):
        raise ValueError('Exact source and tested engine required')
    workspace=pathlib.Path(__file__).resolve().parent.parent
    if capture(['git','rev-parse','HEAD'],128).decode().strip()!=args.source_commit:
        raise ValueError('Package checkout differs from tested source')
    runner=pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    target=pathlib.Path(args.output).absolute()
    if ('..' in target.parts or target.exists() or target.is_symlink() or
            target.parent.resolve(strict=True)!=runner or any(p.is_symlink() for p in [target.parent,*target.parent.parents])):
        raise ValueError('New direct child of private runner temp required')
    base=inspect(args.base_image);image=inspect(args.ai_image)
    if (base['Id']!=args.base_image or image['Id']!=args.ai_image or image['Os']!='linux' or image['Architecture']!='amd64' or
            image['Config']['Labels'].get('org.workproof.ai.base-image')!=args.base_image or
            image['Config']['Labels'].get('org.opencontainers.image.revision')!=args.source_commit or
            base['Config']['Labels'].get('org.opencontainers.image.revision')!=args.source_commit or
            image['RootFS']['Layers'][:len(base['RootFS']['Layers'])]!=base['RootFS']['Layers']):
        raise ValueError('Tested runtime ancestry differs')
    target.mkdir(mode=0o700)
    PHASE='runtime'
    command=['docker','run','--rm','--network','none','--read-only','--user','10001:10001',
        '--tmpfs','/tmp:rw,nosuid,nodev,mode=1777','--entrypoint','/opt/workproof-ai/venv/bin/python']
    code="import pathlib,sys;sys.path.insert(0,'/opt/workproof-ai');import ai_runtime as r;r.verify_runtime();assert not list(r.MODEL_ROOT.iterdir());sys.stdout.buffer.write((r.ROOT/'runtime.json').read_bytes())"
    runtime=capture(command+[args.ai_image,'-c',code],1024**2)
    manifest=json.loads(runtime)
    if manifest['baseImageId']!=args.base_image:raise ValueError('Runtime base differs')
    for name in ('prepare_ai.py','ai_runtime.py'):
        if digest(workspace/'deploy/institution-ai'/name)!=manifest['tools'][name]['sha256']:
            raise ValueError('Admin tool and immutable runtime differ')
    (target/'runtime.json').write_bytes(runtime)
    PHASE='notices'
    collector=workspace/'tools/ai-assessment/collect_notices.py'
    # Existing notice collector runs with the actual venv interpreter. Only that
    # public source file is bound; no app configuration/model/sample is mounted.
    notices_code="import sys,tarfile;sys.path.insert(0,'/notice-source');from collect_notices import collect;from pathlib import Path;collect(Path('/tmp/notices'));t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz');t.add('/tmp/notices',arcname='notices');t.close()"
    raw=capture(command+['--mount',f'type=bind,src={collector},dst=/notice-source/collect_notices.py,readonly',args.ai_image,'-c',notices_code],80*1024**2)
    archive=target/'python-distribution-notices.tar.gz';archive.write_bytes(raw)
    notices=None;notice_files={}
    with tarfile.open(archive,'r:gz') as source:
        total=0
        for member in source:
            path=pathlib.PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or '\\' in member.name or ':' in member.name or
                    path.parts[0]!='notices' or not (member.isdir() or member.isfile())):
                raise ValueError('Unsafe generated notice member')
            if member.isdir():continue
            total+=member.size
            if member.size>4*1024**2 or total>65*1024**2 or member.name in notice_files:raise ValueError('Notice bounds exceeded')
            value=source.extractfile(member).read(4*1024**2+1)
            if len(value)!=member.size:raise ValueError('Notice length differs')
            notice_files[member.name]=(len(value),hashlib.sha256(value).hexdigest())
            if member.name=='notices/manifest.json':notices=json.loads(value)
    if not notices or notices['schema']!='workproof-python-notices/1' or notices['commercial_clearance'] is not False:
        raise ValueError('Notice manifest missing')
    named={p['name'].lower().replace('_','-') for p in notices['packages']}
    if not {'torch','transformers','tokenizers','safetensors','huggingface-hub'}<=named:raise ValueError('Incomplete runtime inventory')
    expected={'notices/manifest.json'}
    for package in notices['packages']:
        for item in package['files']:
            name='notices/'+item['archive'];expected.add(name)
            if notice_files.get(name)!=(item['bytes'],item['sha256']):raise ValueError('Notice digest differs')
    if set(notice_files)!=expected:raise ValueError('Unrecorded notice files')
    # Keep the separately evidenced supplement as a supplement, never substitute
    # it for a missing original notice in the installed wheel manifest.
    shutil.copytree(workspace/'docs/licenses/ai-runtime',target/'license-supplements')
    PHASE='export'
    output=target/'workproof-institution-ai-image.tar.gz'
    with output.open('xb') as destination,gzip.GzipFile(fileobj=destination,mode='wb',mtime=0,compresslevel=6) as compressed:
        process=subprocess.Popen(['docker','image','save',args.ai_image],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:
            total=0
            while True:
                block=process.stdout.read(1024**2)
                if not block:break
                total+=len(block)
                if total>12*1024**3:raise ValueError('Image export exceeds limit')
                compressed.write(block)
            if process.wait(timeout=60)!=0:raise ValueError('Image export failed')
        finally:
            process.stdout.close()
            if process.poll() is None:process.kill();process.wait(timeout=30)
    PHASE='reload'
    verify_export(output,image)
    run(['docker','image','load','--input',str(output)],stdout=subprocess.DEVNULL)
    if inspect(args.ai_image)['Id']!=args.ai_image:raise ValueError('Exported runtime identity differs')
    for name in ('prepare_ai.py','reactivate_ai.py'):
        shutil.copyfile(workspace/'deploy/institution-ai'/name,target/name)
    shutil.copyfile(workspace/'docs/INSTITUTION-AI-DEPLOYMENT.md',target/'DEPLOYMENT.md')
    PHASE='manifest'
    build={'schema':'workproof.optional-ai-package/1','source_commit':args.source_commit,
        'build_run':os.environ['GITHUB_RUN_ID'],'base_run':args.base_run_id,'base_image_id':args.base_image,
        'image_id':args.ai_image,'platform':'linux/amd64','tested_engine':args.engine,
        'weights_bundled':False,'deployment_credentials_bundled':False,'commercial_clearance':False,
        'runtime_notice_packages':len(notices['packages']),
        'runtime_notice_packages_with_issues':sum(bool(p['issues']) for p in notices['packages']),
        'scope':'Exact CPU runtime after selected-engine real server acceptance. Requires matching institution deployment, explicit model download and administrator preparation. Runtime notice collection is not full commercial clearance.'}
    (target/'BUILD-INFO.json').write_text(json.dumps(build,indent=2)+'\n',encoding='utf-8')
    files=sorted(p for p in target.rglob('*') if p.is_file())
    lines=[]
    for path in files:
        if path.is_symlink():raise ValueError('Package symlink rejected')
        lines.append(digest(path)+'  '+path.relative_to(target).as_posix())
    (target/'SHA256SUMS.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('Optional CPU runtime candidate exported and reloaded; exact image, runtime and installed notice digests verified. No model weights or deployment secrets packaged.')


if __name__=='__main__':
    try:main()
    except Exception:
        print('AI_PACKAGE_PHASE='+(PHASE if PHASE in PHASES else 'unknown')+'; packaging failed',file=sys.stderr);sys.exit(1)
