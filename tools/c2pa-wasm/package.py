"""Package and verify the actual public site, including hidden upstream notices."""
import hashlib,json,pathlib,zipfile
root=pathlib.Path(__file__).resolve().parents[2]
site=root/'apps/verifier/out'
build=json.loads((site/'c2pa/BUILD-INFO.json').read_text(encoding='utf-8'))
for item in build['files']:
    relative=pathlib.PurePosixPath(item['name'])
    assert not relative.is_absolute() and '..' not in relative.parts
    assert hashlib.sha256((site/'c2pa'/item['name']).read_bytes()).hexdigest()==item['sha256'],item['name']
files={}
for file in sorted(site.rglob('*')):
    assert not file.is_symlink(),'Unexpected symlink in public site'
    if file.is_file():files[file.relative_to(site).as_posix()]=file
required={'index.html','verify-worker.js','wasm/workproof_protocol.js','wasm/workproof_protocol_bg.wasm',
          'demo/essay.md','demo/essay.md.wproof','demo/structure-demo.txt','demo/structure-demo.txt.wproof','demo/structure-demo.wgraph',
          'notices/graph/inventory.json','c2pa/pkg/workproof_c2pa_wasm_bg.wasm'}
assert required<=files.keys(),'Missing public verifier entry resources: '+repr(sorted(required-files.keys()))
assert 'SHA256SUMS.txt' not in files
manifest=''.join(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+name+'\n' for name,file in files.items())
archive=root/'verifier-with-embedded-certificates.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as package:
    for name,file in files.items():package.write(file,name)
    package.writestr('SHA256SUMS.txt',manifest)
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    assert set(package.namelist())==set(files)|{'SHA256SUMS.txt'}
    for line in manifest.splitlines():
        digest,name=line.split('  ',1)
        assert hashlib.sha256(package.read(name)).hexdigest()==digest,name
archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n',encoding='utf-8')
print('Verified complete archived site:',len(files),'file hashes; hidden notices retained')
