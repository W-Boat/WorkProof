"""Actions-only verified institution artifact importer; no default server rebuild."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

REPO='W-Boat/WorkProof'
ARTIFACT='institution-server-linux-amd64'
LIMIT=512*1024**2
PHASE='preflight'


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if urllib.parse.urlsplit(newurl).scheme!='https':raise ValueError('HTTPS redirect required')
        redirected=super().redirect_request(req,fp,code,msg,headers,newurl)
        if redirected is not None and urllib.parse.urlsplit(req.full_url).netloc!=urllib.parse.urlsplit(newurl).netloc:
            redirected.remove_header('Authorization')
        return redirected


def request(url):
    if urllib.parse.urlsplit(url).scheme!='https':raise ValueError('HTTPS required')
    headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'WorkProof-CI-artifact-verifier'}
    if urllib.parse.urlsplit(url).netloc=='api.github.com':headers['Authorization']='Bearer '+os.environ['GH_TOKEN']
    return urllib.request.build_opener(SafeRedirect()).open(urllib.request.Request(url,headers=headers),timeout=120)


def api(path):
    with request('https://api.github.com/repos/'+REPO+path) as response:
        raw=response.read(4*1024**2+1)
    if len(raw)>4*1024**2:raise ValueError('API response too large')
    return json.loads(raw)


def run(args):return subprocess.check_output(args,stderr=subprocess.DEVNULL,timeout=600)
def inspect(reference):return json.loads(run(['docker','image','inspect',reference]))[0]


def image_platform(value):
    if value.get('Os')!='linux' or value.get('Architecture')!='amd64' or not re.fullmatch('sha256:[0-9a-f]{64}',value['Id']):
        raise ValueError('Linux amd64 immutable image required')


def main():
    global PHASE
    assert os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform.startswith('linux')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id',required=True);parser.add_argument('--source-commit',required=True)
    args=parser.parse_args()
    if not re.fullmatch('[1-9][0-9]{0,19}',args.run_id) or not re.fullmatch('[0-9a-f]{40}',args.source_commit):raise ValueError('Invalid source identity')
    if run(['git','rev-parse','HEAD']).decode().strip()!=args.source_commit:raise ValueError('Checkout differs')
    PHASE='run-identity'
    workflow=api('/actions/workflows/institution.yml')
    record=api('/actions/runs/'+args.run_id)
    if (workflow.get('path')!='.github/workflows/institution.yml' or record.get('workflow_id')!=workflow['id'] or
            record.get('path')!='.github/workflows/institution.yml' or record.get('status')!='completed' or
            record.get('conclusion')!='success' or record.get('head_sha')!=args.source_commit or
            record.get('repository',{}).get('full_name')!=REPO or record.get('head_repository',{}).get('full_name')!=REPO):
        raise ValueError('Base run is not the successful exact-source institution workflow')
    artifacts=[]
    for page in range(1,11):
        response=api('/actions/runs/'+args.run_id+'/artifacts?per_page=100&page='+str(page))
        artifacts.extend(response['artifacts'])
        if len(response['artifacts'])<100:break
    else:raise ValueError('Artifact listing bound exceeded')
    matches=[item for item in artifacts if item['name']==ARTIFACT]
    if len(matches)!=1:raise ValueError('Exactly one institution server artifact required')
    artifact=matches[0]
    if artifact.get('expired') or not 0<artifact['size_in_bytes']<=LIMIT or not re.fullmatch('sha256:[0-9a-f]{64}',artifact.get('digest','')):
        raise ValueError('Artifact digest or size unavailable')
    PHASE='download'
    runner=pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='workproof-ai-base-',dir=runner) as temporary:
        private=pathlib.Path(temporary);private.chmod(0o700)
        archive=private/'artifact.zip';digest=hashlib.sha256();length=0
        # Fixed API endpoint: never accept an artifact-supplied arbitrary URL.
        with request('https://api.github.com/repos/'+REPO+'/actions/artifacts/'+str(int(artifact['id']))+'/zip') as source,archive.open('xb') as output:
            while True:
                block=source.read(1024**2)
                if not block:break
                length+=len(block)
                if length>LIMIT:raise ValueError('Artifact download exceeds limit')
                digest.update(block);output.write(block)
        if length!=artifact['size_in_bytes'] or 'sha256:'+digest.hexdigest()!=artifact['digest']:raise ValueError('Artifact digest differs')
        PHASE='package'
        with zipfile.ZipFile(archive) as package:
            members={};total=0
            for info in package.infolist():
                name=info.filename
                path=pathlib.PurePosixPath(name)
                if (not name or '\\' in name or ':' in name or path.is_absolute() or '..' in path.parts or
                        any(ord(char)<32 for char in name) or str(path).rstrip('/')!=name.rstrip('/') or
                        stat.S_IFMT(info.external_attr>>16) not in (0,stat.S_IFREG,stat.S_IFDIR)):
                    raise ValueError('Unsafe ZIP member')
                key=name.rstrip('/')
                if key in members:raise ValueError('Duplicate ZIP member')
                members[key]=info;total+=info.file_size
                if total>2*1024**3 or info.file_size>LIMIT:raise ValueError('ZIP expands beyond bound')
            if len(members)>1024:raise ValueError('Too many package members')
            sums=[name for name in members if name=='SHA256SUMS.txt' or name.endswith('/institution-server-linux-amd64/SHA256SUMS.txt') or name=='institution-server-linux-amd64/SHA256SUMS.txt']
            if len(sums)!=1:raise ValueError('One package checksum manifest required')
            sums_name=sums[0];prefix=sums_name[:-len('SHA256SUMS.txt')]
            if members[sums_name].file_size>128*1024:raise ValueError('Checksum manifest exceeds limit')
            lines=package.read(members[sums_name]).decode('utf-8').splitlines();checks={}
            for line in lines:
                match=re.fullmatch('([0-9a-f]{64})  ([A-Za-z0-9_.-]+)',line)
                if not match or match[2] in checks or match[2]=='SHA256SUMS.txt':raise ValueError('Invalid checksum line')
                checks[match[2]]=match[1]
            actual={name[len(prefix):] for name,info in members.items() if name.startswith(prefix) and not info.is_dir()}
            if actual!=set(checks)|{'SHA256SUMS.txt'}:raise ValueError('Unchecksummed package files')
            for name,expected in checks.items():
                observed=hashlib.sha256()
                with package.open(members[prefix+name]) as source:
                    for block in iter(lambda:source.read(1024**2),b''):observed.update(block)
                if observed.hexdigest()!=expected:raise ValueError('Package checksum differs')
            build_name=prefix+'BUILD-INFO.json'
            if members[build_name].file_size>128*1024:raise ValueError('Build info exceeds limit')
            build=json.loads(package.read(members[build_name]))
            if (build.get('schema')!='workproof.server-package.v1' or build.get('source_commit')!=args.source_commit or
                    str(build.get('build_run'))!=args.run_id or build.get('platform')!='linux/amd64' or
                    not re.fullmatch('sha256:[0-9a-f]{64}',build.get('image_id',''))):raise ValueError('Build provenance differs')
            image_name='workproof-institution-image.tar.gz'
            image_tar=private/image_name
            with package.open(members[prefix+image_name]) as source,image_tar.open('xb') as output:
                shutil_copy(source,output)
        PHASE='load-image';run(['docker','load','--input',str(image_tar)])
        image=inspect(build['image_id']);image_platform(image)
        if image['Id']!=build['image_id'] or image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')!=args.source_commit:raise ValueError('Loaded base image identity differs')
        run(['docker','tag',image['Id'],'workproof-institution:ai-base'])
        PHASE='dependencies'
        references={'database':('mysql:8.4.13',r'mysql@sha256:[0-9a-f]{64}'),
                    'cache':('valkey/valkey:8.0',r'valkey/valkey@sha256:[0-9a-f]{64}')}
        for service,(canonical,pattern) in references.items():
            dependency=build['runtime_dependencies'][service]
            if dependency.get('reference')!=canonical or dependency.get('bundled') is not False or not re.fullmatch('sha256:[0-9a-f]{64}',dependency.get('image_id','')):
                raise ValueError('Unexpected dependency identity')
            allowed=sorted({value for value in dependency.get('repository_digests',[]) if isinstance(value,str) and re.fullmatch(pattern,value)})
            if not allowed:raise ValueError('Recorded immutable dependency unavailable')
            reference=allowed[0]
            run(['docker','pull','--platform','linux/amd64',reference])
            installed=inspect(reference);image_platform(installed)
            if installed['Id']!=dependency['image_id']:raise ValueError('Dependency platform/config digest differs')
            run(['docker','tag',installed['Id'],canonical])
    with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as output:
        output.write('base_image='+build['image_id']+'\nsource_commit='+args.source_commit+'\n')
    print('Verified successful institution run, artifact digest, package checksums, exact base image and immutable Linux amd64 dependencies.')


def shutil_copy(source,output):
    for block in iter(lambda:source.read(1024**2),b''):output.write(block)


if __name__=='__main__':
    try:main()
    except Exception:
        allowed={'preflight','run-identity','download','package','load-image','dependencies'}
        print('AI_BASE_PHASE='+(PHASE if PHASE in allowed else 'unknown')+'; verification failed',file=sys.stderr);sys.exit(1)
