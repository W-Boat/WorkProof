"""CI package contract, including same-origin manifest and WPS ribbon wiring."""
import os
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path('apps/office/dist')
origin = os.environ['WORKPROOF_PUBLIC_ORIGIN'].rstrip('/')
manifest = ET.parse(root / 'manifest-word.xml').getroot()
ns = {'o': 'http://schemas.microsoft.com/office/appforoffice/1.1'}
assert manifest.find('o:Id', ns).text == '9ebd5d58-80c3-4868-8dd5-c3f3c53d7942'
assert manifest.find('o:DefaultSettings/o:SourceLocation', ns).get('DefaultValue') == origin + '/office/index.html'
assert manifest.find('o:Permissions', ns).text == 'ReadWriteDocument'
ribbon = ET.parse(root / 'wps/ribbon.xml').getroot()
assert ribbon.get('onLoad') == 'OnWorkProofLoad'
buttons = ribbon.findall('.//{http://schemas.microsoft.com/office/2009/07/customui}button')
assert len(buttons) == 1 and buttons[0].get('onAction') == 'OnOpenWorkProof'
for name in ['index.html', 'addin.js', 'wps/main.js', 'wps/index.html']:
    assert (root / name).is_file() and (root / name).stat().st_size > 0, name
assert 'src="main.js"' in (root / 'wps/index.html').read_text(encoding='utf-8')
assert not (root / 'wps/publish.html').exists(), 'No unreviewed upstream publication template is distributed'
print('Word manifest and WPS ribbon package validated; real host acceptance remains separate.')
