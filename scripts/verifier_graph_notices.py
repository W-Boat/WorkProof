"""Stage locked visualization and Fluent UI notices in the exported verifier.

Runs during CI web builds. Does not download or execute package contents.
This covers the named runtime dependency closures, not the whole application.
"""
import hashlib,json,pathlib,re
from word_package_notices import load_supplements,supplemental_notices

root=pathlib.Path(__file__).resolve().parents[1]
lock_bytes=(root/'package-lock.json').read_bytes()
packages=json.loads(lock_bytes)['packages']
destination=root/'apps/verifier/public/notices/graph'
notice=re.compile(r'^(licen[cs]e|notice|copying|copyright)([.\-_]|$)',re.I)

def resolve(parent,name):
    parts=parent.split('/') if parent else []
    while True:
        candidate='/'.join(parts+['node_modules',name])
        if candidate in packages:return candidate
        if not parts:raise RuntimeError('Locked graph dependency missing: '+name)
        parts.pop()

roots=('@xyflow/react','echarts','@fluentui/tokens','@fluentui/web-components',
       '@microsoft/fast-element','@microsoft/focusgroup-polyfill')
pending=[resolve('apps/verifier',name) for name in roots];seen=set();inventory=[]
supplements=load_supplements('office-npm-supplemental')
while pending:
    key=pending.pop()
    if key in seen:continue
    seen.add(key);entry=packages[key]
    source=root/key
    if source.is_symlink() or not source.resolve().is_relative_to(root):raise RuntimeError('Unexpected dependency path')
    manifest=json.loads((source/'package.json').read_bytes())
    if manifest['version']!=entry['version']:raise RuntimeError('Installed graph package differs from lock: '+key)
    package_files={}
    for file in sorted(source.iterdir()):
        if not notice.match(file.name):continue
        if file.is_symlink() or not file.is_file():raise RuntimeError('Unexpected graph notice entry: '+key)
        data=file.read_bytes()
        relative=key.removeprefix('node_modules/')+'/'+file.name
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        package_files[relative]=hashlib.sha256(data).hexdigest()
    supplemental_sources=None
    license_found=any(pathlib.PurePosixPath(name).name.lower().startswith(('license','licence','copying')) for name in package_files)
    if not license_found:
        package_destination=destination/key.removeprefix('node_modules/')
        evidence,supplemental_sources=supplemental_notices(
            {'ecosystem':'npm','name':manifest['name'],'version':manifest['version'],'integrity':entry.get('integrity')},
            supplements,package_destination)
        for notice_file in evidence:
            saved=package_destination.parent.parent/notice_file['file']
            package_files[saved.relative_to(destination).as_posix()]=notice_file['sha256']
        license_found=any(pathlib.PurePosixPath(row['original_relative_path']).name.lower().startswith(
            ('license','licence','copying')) for row in evidence)
    if not manifest.get('license') or not license_found:
        raise RuntimeError('Full graph package license missing: '+key)
    inventory.append({'name':manifest['name'],'version':manifest['version'],'license':manifest['license'],
                      'integrity':entry.get('integrity'),'files':package_files,'supplemental_sources':supplemental_sources})
    pending.extend(resolve(key,name) for name in entry.get('dependencies',{}))
destination.mkdir(parents=True,exist_ok=True)
(destination/'inventory.json').write_text(json.dumps({'scope':'Locked visualization and Fluent UI declared dependency closures; peer dependencies and other site components are outside this inventory.',
    'roots':list(roots),
    'package_lock_sha256':hashlib.sha256(lock_bytes).hexdigest(),'packages':sorted(inventory,key=lambda item:item['name'])},indent=2)+'\n',encoding='utf-8')
print('Staged original visualization and Fluent notices for',len(inventory),'locked packages')
