"""Build extension zip from source files only, in CI."""
import pathlib,zipfile
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'dist';out.mkdir(exist_ok=True)
with zipfile.ZipFile(out/'workproof-blender-0.2.0.zip','w',zipfile.ZIP_DEFLATED) as z:
    for name in ['__init__.py','blender_manifest.toml']:
        z.write(root/'apps/blender/workproof'/name,name)
