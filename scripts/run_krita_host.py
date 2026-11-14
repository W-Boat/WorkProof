"""Run the shipped source ZIP in the real Krita scripting host, isolated to Actions."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

if os.environ.get('GITHUB_ACTIONS')!='true':
    raise RuntimeError('Host acceptance is Actions-only')
root=Path(__file__).resolve().parents[1]
archive=root/'dist/workproof-krita-dev.zip'
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
expected=(archive.with_suffix('.zip.sha256')).read_text().split()[0]
assert digest==expected
harness=str((root/sys.argv[1]).resolve())
engine=str((root/sys.argv[2]).resolve())
report=root/'test-krita-host-results.json'
assert not report.exists(), 'Expected a fresh host report'
with tempfile.TemporaryDirectory(prefix='workproof-krita-host-',dir=os.environ['RUNNER_TEMP']) as temp:
    directory=Path(temp)
    plugin=directory/'data/krita/pykrita'
    with zipfile.ZipFile(archive) as package:
        names=package.namelist()
        assert len(names)==len(set(names))
        for name in names:
            path=Path(name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name
            target=plugin/path
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(package.read(name))
    runner=shutil.which('krita')
    assert runner, 'Distribution package must provide the real Krita GUI'
    bootstrap=plugin/'workproof_ci'
    bootstrap.mkdir()
    (bootstrap/'__init__.py').write_bytes((root/'scripts/krita_host_bootstrap.py').read_bytes())
    (plugin/'workproof_ci.desktop').write_text('[Desktop Entry]\nType=Service\nServiceTypes=Krita/PythonPlugin\nX-KDE-Library=workproof_ci\nX-Python-2-Compatible=false\nName=WorkProof CI driver\n')
    config=directory/'config'
    config.mkdir()
    (config/'kritarc').write_text('[General]\nuseOpenGL=false\n[python]\nenable_workproof=true\nenable_workproof_ci=true\n')
    env=dict(os.environ,PYTHONPATH=str(root/'scripts'),
        XDG_CONFIG_HOME=str(directory/'config'),XDG_DATA_HOME=str(directory/'data'),
        XDG_CACHE_HOME=str(directory/'cache'),LIBGL_ALWAYS_SOFTWARE='1',
        WORKPROOF_HOST_ARGS=json.dumps([harness,engine,str(directory),str(report),digest]))
    command=['xvfb-run','-a',runner,'--nosplash']
    with (root/'test-krita-host.log').open('w') as log:
        run=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
    # Demand a report written only after every native document and UI assertion passed.
    assert run.returncode==0 and report.is_file(), 'Krita host acceptance failed; inspect host log'
    result=json.loads(report.read_text())
    assert result['passed'] is True and result['plugin_sha256']==digest
    print(json.dumps(result,indent=2))
