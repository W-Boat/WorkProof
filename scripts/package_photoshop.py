"""CI development ZIP, not an Adobe-signed CCX or Marketplace publication."""
from pathlib import Path
import json, zipfile
root=Path(__file__).resolve().parents[1]
source=root/'apps/photoshop/dist'
manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
assert manifest['manifestVersion']==5
assert manifest['requiredPermissions']=={'localFileSystem':'request','network':{'domains':['http://127.0.0.1:43127']}}
assert 'all' not in manifest['requiredPermissions']['network']['domains']
assert manifest['host'][0]['data']['apiVersion']==2
assert manifest['entrypoints'][0]['id']=='workproof'
output=root/'dist';output.mkdir(exist_ok=True)
files=['manifest.json','index.html','panel.css','main.js','README.md','LICENSE','NOBLE-HASHES-LICENSE']
with zipfile.ZipFile(output/f"workproof-photoshop-{manifest['version']}-dev.zip",'w',zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        assert (source/name).is_file() and (source/name).stat().st_size>0
        archive.write(source/name,name)
print('Packaged self-authored UXP development plugin with hashing license; no Adobe runtime bundled.')
