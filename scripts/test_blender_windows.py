"""Actions-only acceptance of the shipping extension in official Windows Blender."""
import hashlib,json,os,pathlib,platform,subprocess,sys,tempfile

def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform=='win32'
    blender=pathlib.Path(sys.argv[1]).resolve(strict=True)
    version=sys.argv[2]
    root=pathlib.Path(__file__).resolve().parents[1]
    engine=(root/'target/debug/workproof-engine.exe').resolve(strict=True)
    packages=list((root/'dist').glob('workproof-blender-*.zip'));assert len(packages)==1
    package=packages[0].resolve(strict=True)
    evidence=root/'test-results/blender-windows';evidence.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='workproof-blender-profile-') as directory:
        profile=pathlib.Path(directory).resolve(strict=True)
        assert profile.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve())
        environment={**os.environ,'BLENDER_USER_RESOURCES':str(profile)}
        commands=[
            [str(blender),'--background','--factory-startup','--command','extension','install-file','--repo','user_default','--enable',str(package)],
            [str(blender),'--background','--python-exit-code','1','--python',str(root/'scripts/test_blender.py'),'--',str(engine),str(package)],
        ]
        for index,command in enumerate(commands):
            with (evidence/f'host-{index}.log').open('wb') as log:
                subprocess.run(command,cwd=root,env=environment,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=300)
    report=json.loads((root/'test-blender-results.json').read_text(encoding='utf-8'))
    assert report['host']==version
    assert report['extension_installation']['sha256']==hashlib.sha256(package.read_bytes()).hexdigest()
    assert report['extension_installation']['enabled_on_restart'] is True
    report.update(source_commit=os.environ['GITHUB_SHA'],platform=platform.system(),architecture=platform.machine(),host_archive_sha256=os.environ['WORKPROOF_BLENDER_SHA256'],scope='Official Windows Blender in background mode, isolated profile, actual installed extension and real Rust collector. Not interactive panel or all historical host versions.')
    (evidence/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('PASS Windows Blender',version,'installed extension, restart, recording, signed export and tamper rejection')

if __name__=='__main__':main()
