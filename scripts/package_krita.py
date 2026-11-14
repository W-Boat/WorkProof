"""Produce an importable Krita plugin ZIP; no third-party Python or Qt bundled."""
import hashlib
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'apps/krita'
output = root / 'dist/workproof-krita-dev.zip'
output.parent.mkdir(exist_ok=True)
members = [source / 'workproof.desktop'] + sorted((source / 'workproof').glob('*.py')) + [source / 'workproof/Manual.html']
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in members:
        archive.writestr(file.relative_to(source).as_posix(), file.read_bytes())
    archive.writestr('workproof/COPYING', (root / 'apps/blender/workproof/COPYING').read_bytes())
    archive.writestr('workproof/README.md', (root / 'docs/DRAWING-ADAPTERS.md').read_bytes())
digest = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.zip.sha256').write_text(digest + '  ' + output.name + '\n')
print(output.name, digest)
