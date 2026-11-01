"""Collect actual locked Rust package notices; inventory is not commercial clearance."""
import hashlib,json,pathlib,re,subprocess

root=pathlib.Path(__file__).resolve().parents[1]
destination=root/'.ci-c2pa-notices';destination.mkdir(exist_ok=True)
metadata=json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--manifest-path',str(root/'tools/c2pa/Cargo.toml')]))
inventory=[];missing=[]
for package in metadata['packages']:
    source=pathlib.Path(package['manifest_path']).parent
    key=f"{package['name']}-{package['version']}"
    candidates=set()
    for path in source.rglob('*'):
        if path.is_file() and re.match(r'^(license|licence|notice|copying|copyright)([.\-_]|$)',path.name,re.I):
            candidates.add(path)
    if package.get('license_file'):
        path=(source/package['license_file']).resolve()
        if path.is_file() and path.is_relative_to(source.resolve()): candidates.add(path)
    local=package['source'] is None
    if local and not candidates: candidates.add(root/'LICENSE')
    texts=[]
    for path in sorted(candidates):
        data=path.read_bytes()
        if len(data)>2*1024*1024: continue
        try: data.decode('utf-8')
        except UnicodeDecodeError: continue
        relative=path.relative_to(source) if path.is_relative_to(source) else pathlib.Path('WORKPROOF-LICENSE')
        target=destination/key/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        texts.append({'path':str(relative),'sha256':hashlib.sha256(data).hexdigest()})
    declared=package.get('license') or ('MIT' if local else None)
    if not declared or not texts: missing.append(key)
    inventory.append({'name':package['name'],'version':package['version'],'source':package['source'],'declared_license':declared,'notices':texts})
(destination/'inventory.json').write_text(json.dumps({'scope':'all resolved packages, including development and optional targets; not a commercial release clearance','packages':inventory,'missing_license_evidence':missing},indent=2),encoding='utf-8')
(destination/'README.txt').write_text('WorkProof optional C2PA SDK tool dependency notices.\nAll resolved packages are inventoried; this is broader than the linked runtime.\nPackage declarations and copied texts are evidence, not legal clearance.\nThe main recorder dependency graph is unchanged.\n',encoding='utf-8')
assert not missing, 'Missing declared license or actual text: '+', '.join(missing)
print('Collected locked C2PA dependency declarations and actual notice files:',len(inventory))
