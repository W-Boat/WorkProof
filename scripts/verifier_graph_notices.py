"""Stage locked React Flow and ECharts dependency notices in the exported verifier.

Runs during CI web builds. Does not download or execute package contents.
This covers the graph dependency closure, not commercial clearance of the whole app.
"""
import hashlib,json,pathlib,re

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

pending=[resolve('apps/verifier',name) for name in ('@xyflow/react','echarts')];seen=set();inventory=[]
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
    if not manifest.get('license') or not any(pathlib.PurePosixPath(name).name.lower().startswith(('license','licence','copying')) for name in package_files):
        raise RuntimeError('Full graph package license missing: '+key)
    inventory.append({'name':manifest['name'],'version':manifest['version'],'license':manifest['license'],'integrity':entry.get('integrity'),'files':package_files})
    pending.extend(resolve(key,name) for name in entry.get('dependencies',{}))
destination.mkdir(parents=True,exist_ok=True)
(destination/'inventory.json').write_text(json.dumps({'scope':'Locked React Flow and ECharts declared dependency closures; peer dependencies and other site components are outside this inventory. Not commercial clearance.',
    'package_lock_sha256':hashlib.sha256(lock_bytes).hexdigest(),'packages':sorted(inventory,key=lambda item:item['name'])},indent=2)+'\n',encoding='utf-8')
print('Staged original graph notices for',len(inventory),'locked packages')
