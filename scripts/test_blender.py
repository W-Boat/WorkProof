"""Run inside real Blender, against a real Rust collector. No mocked bpy or signing."""
import json,os,pathlib,subprocess,sys,tempfile,time
import bpy
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'apps/blender'))
import workproof
engine=str(pathlib.Path(sys.argv[sys.argv.index('--')+1]).resolve())
def wait_for(predicate,description):
    for _ in range(150):
        if predicate():return
        time.sleep(.1)
    raise AssertionError(description)
with tempfile.TemporaryDirectory(prefix='workproof-blender-') as tmp:
    os.environ['WORKPROOF_DATA_DIR']=tmp
    proc=subprocess.Popen([engine],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    registered=False
    try:
        wait_for(lambda:pathlib.Path(tmp,'connection.json').exists(),'Collector startup')
        filename=str(pathlib.Path(tmp,'scene.blend'))
        bpy.ops.wm.save_as_mainfile(filepath=filename)
        workproof.register();registered=True
        assert bpy.ops.workproof.start()=={'FINISHED'}
        wait_for(lambda:workproof._runtime.committed>=1,'First event')
        bpy.ops.mesh.primitive_cube_add()
        bpy.context.view_layer.update();workproof.on_change();workproof.sample()
        assert bpy.ops.workproof.pause()=={'FINISHED'}
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4)
        workproof.sample()
        assert bpy.ops.workproof.pause()=={'FINISHED'}
        assert bpy.ops.workproof.export()=={'FINISHED'}
        wait_for(lambda:bool(workproof._runtime.exported),'Export: '+workproof._runtime.last_error)
        proof_path=pathlib.Path(filename+'.wproof')
        proof=json.loads(proof_path.read_text(encoding='utf-8'))
        assert proof['manifest']['source']=='blender'
        assert proof['manifest']['protocol']=='workproof/2'
        events=[r['event'] for r in proof['records']]
        assert events[0]['kind']=='start'
        assert any(e['kind']=='mesh' for e in events)
        assert any(e['kind']=='gap' for e in events)
        assert events[-1]['kind']=='save'
        assert events[-1]['metrics']['vertices']>events[0]['metrics']['vertices']
        verified=subprocess.run([engine,'verify',filename,str(proof_path)],capture_output=True,text=True)
        assert verified.returncode==0,verified.stdout+verified.stderr
        for record in proof['records']:
            if record['event']['kind']=='mesh':record['event']['metrics']['vertices']+=1;break
        bad=pathlib.Path(tmp,'modified.wproof');bad.write_text(json.dumps(proof),encoding='utf-8')
        assert subprocess.run([engine,'verify',filename,str(bad)],capture_output=True).returncode==2
        result={'host':bpy.app.version_string,'native_adapter':'passed','signed_metrics':'passed','pause_gap':'passed','real_blend_file_binding':'passed','tampered_metric_rejected':'passed','events':len(events)}
        (root/'test-blender-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result))
    finally:
        if registered:workproof.unregister()
        proc.terminate();proc.wait(timeout=10)
