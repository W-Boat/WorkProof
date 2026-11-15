import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / 'apps/desktop/src-tauri/resources/adapters'
target.mkdir(parents=True, exist_ok=True)
for name in ('package_blender.py', 'package_krita.py'):
    subprocess.run([sys.executable, str(root / 'scripts' / name)], check=True, cwd=root)
subprocess.run(['node', 'apps/photoshop/build.mjs'], check=True, cwd=root)
manifest = root / 'apps/blender/workproof/blender_manifest.toml'
version = tomllib.loads(manifest.read_text(encoding='utf-8'))['version']
blender = root / 'dist' / f'workproof-blender-{version}.zip'
shutil.copy2(blender, target / 'workproof-blender.zip')
shutil.copy2(root / 'dist/workproof-krita-dev.zip', target)
shutil.copytree(root / 'apps/photoshop/dist', target / 'photoshop', dirs_exist_ok=True)
