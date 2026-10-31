"""Build extension zip from source files only, in CI."""
import pathlib,tomllib,zipfile
root=pathlib.Path(__file__).resolve().parents[1]
source=root/'apps/blender/workproof'
manifest=tomllib.loads((source/'blender_manifest.toml').read_text(encoding='utf-8'))
assert manifest['license']==['SPDX:GPL-3.0-or-later'], 'Blender distribution must select its GPL terms'
assert 'GNU GENERAL PUBLIC LICENSE' in (source/'COPYING').read_text(encoding='utf-8')
assert (source/'MIT-LICENSE.txt').read_bytes()==(root/'LICENSE').read_bytes(), 'Preserve original MIT notice'
out=root/'dist';out.mkdir(exist_ok=True)
with zipfile.ZipFile(out/f"workproof-blender-{manifest['version']}.zip",'w',zipfile.ZIP_DEFLATED) as z:
    for name in ['__init__.py','blender_manifest.toml','COPYING','MIT-LICENSE.txt','README.md']:
        z.write(source/name,name)
