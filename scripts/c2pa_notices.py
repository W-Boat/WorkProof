"""Collect actual locked Rust package notices; inventory is not commercial clearance."""
import hashlib,json,pathlib,re,subprocess,tomllib

root=pathlib.Path(__file__).resolve().parents[1]
destination=root/'.ci-c2pa-notices';destination.mkdir(exist_ok=True)
metadata=json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--manifest-path',str(root/'tools/c2pa/Cargo.toml')]))
lock=tomllib.loads((root/'tools/c2pa/Cargo.lock').read_text(encoding='utf-8'))
checksums={(p['name'],p['version']):p.get('checksum') for p in lock['package']}
supplement_root=root/'docs/licenses/c2pa-supplemental'
supplements={ (p['name'],p['version']):p for p in json.loads((supplement_root/'evidence.json').read_text(encoding='utf-8'))['packages'] }
inventory=[];missing=[]
for package in metadata['packages']:
    source=pathlib.Path(package['manifest_path']).parent
    key=f"{package['name']}-{package['version']}"
    candidates=set()
    local=package['source'] is None
    if local:
        candidates.add(root/'LICENSE')
    else:
        for path in source.rglob('*'):
            if path.is_file() and re.match(r'^(license|licence|notice|copying|copyright)([.\-_]|$)',path.name,re.I):
                candidates.add(path)
    if package.get('license_file'):
        path=(source/package['license_file']).resolve()
        if path.is_file() and path.is_relative_to(source.resolve()): candidates.add(path)
    if local and not candidates: candidates.add(root/'LICENSE')
    if package['name']=='c2pa' and package['version']=='0.91.7' and not candidates:
        # Published SDK crate omits root license files. Bound to its verified VCS commit.
        candidates.update([root/'docs/licenses/c2pa-sdk/LICENSE-MIT',root/'docs/licenses/c2pa-sdk/LICENSE-APACHE'])
    supplement=supplements.get((package['name'],package['version']))
    if supplement:
        assert supplement['archive_checksum']==checksums[(package['name'],package['version'])]
        for entry in supplement['notices']:
            path=supplement_root/supplement['folder']/entry['file']
            assert path.resolve().is_relative_to(supplement_root.resolve())
            assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256'], str(path)
            candidates.add(path)
    texts=[]
    for path in sorted(candidates):
        data=path.read_bytes()
        if len(data)>2*1024*1024: continue
        try: data.decode('utf-8')
        except UnicodeDecodeError: continue
        relative=path.relative_to(source) if path.is_relative_to(source) else pathlib.Path('UPSTREAM-'+path.name)
        target=destination/key/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        texts.append({'path':str(relative),'sha256':hashlib.sha256(data).hexdigest()})
    declared=package.get('license') or ('MIT' if local else None)
    if not declared or not texts: missing.append(key)
    inventory.append({'name':package['name'],'version':package['version'],'source':package['source'],'archive_checksum':checksums.get((package['name'],package['version'])),'authors':package['authors'],'repository':package.get('repository'),'declared_license':declared,'supplemental_evidence':supplement,'notices':texts})
(destination/'inventory.json').write_text(json.dumps({'scope':'all resolved packages, including development and optional targets; not a commercial release clearance','packages':inventory,'missing_license_evidence':missing},indent=2),encoding='utf-8')
(destination/'README.txt').write_text('WorkProof optional C2PA SDK tool dependency notices.\nAll resolved packages are inventoried; this is broader than the linked runtime.\nPackage declarations and copied texts are evidence, not legal clearance.\nThe main recorder dependency graph is unchanged.\n',encoding='utf-8')
(destination/'c2pa-sdk-provenance.json').write_bytes((root/'docs/licenses/c2pa-sdk/evidence.json').read_bytes())
assert not missing, 'Missing declared license or actual text: '+', '.join(missing)
print('Collected locked C2PA dependency declarations and actual notice files:',len(inventory))
