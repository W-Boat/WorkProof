"""Run inside real Blender, against a real Rust collector. No mocked bpy or signing."""
import json,os,pathlib,subprocess,sys,tempfile,time
import bpy
from mathutils import Quaternion
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
        views=[area.spaces.active.region_3d for window in bpy.context.window_manager.windows for area in window.screen.areas if area.type=='VIEW_3D']
        assert views,'Real Blender fixture must provide a 3D viewport state'
        region=views[0]
        region.view_rotation=Quaternion((0,0,1),.4)
        workproof.sample()
        assert workproof._runtime.viewport_changes==1,'Viewport rotation was not sampled'
        # Idle viewport polling must not walk meshes or emit duplicate events.
        timings=[]
        for _ in range(100):
            began=time.perf_counter();workproof.sample();timings.append((time.perf_counter()-began)*1000)
        assert workproof._runtime.viewport_changes==1
        bpy.ops.mesh.primitive_cube_add()
        bpy.context.view_layer.update();workproof.on_change();workproof.sample()
        obj=bpy.context.active_object;obj.name='PRIVATE_OBJECT_NAME_NOT_FOR_EXPORT'
        parent=next(item for item in bpy.data.objects if item!=obj)
        obj.modifiers.new('PRIVATE_MODIFIER_A','BEVEL').width=.1
        obj.modifiers.new('PRIVATE_MODIFIER_B','BEVEL').width=.3
        bpy.context.view_layer.update();workproof.on_change();workproof.sample()
        observed=[]
        def changed_structure(change):
            before_metrics=workproof.metrics();before=workproof.structure_checkpoint()
            change();bpy.context.view_layer.update()
            after=workproof.structure_checkpoint()
            assert before!=after,'Same-count structure edit was invisible'
            assert before_metrics==workproof.metrics(),'Fixture must retain metric counts'
            workproof.on_change();workproof.sample();observed.append(after)
        changed_structure(lambda:setattr(obj,'parent',parent))
        changed_structure(lambda:setattr(obj.location,'x',obj.location.x+1.25))
        changed_structure(lambda:bpy.ops.object.modifier_move_up(modifier=obj.modifiers[1].name))
        assert bpy.ops.workproof.pause()=={'FINISHED'}
        region.view_rotation=Quaternion((0,0,1),.8)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4)
        workproof.sample()
        assert bpy.ops.workproof.pause()=={'FINISHED'}
        workproof.sample()
        assert workproof._runtime.viewport_changes==1,'Paused viewport movement must not be counted'
        region.view_distance+=1
        workproof.sample()
        assert workproof._runtime.viewport_changes==2,'Viewport zoom was not sampled'
        assert bpy.ops.workproof.export()=={'FINISHED'}
        wait_for(lambda:bool(workproof._runtime.exported),'Export: '+workproof._runtime.last_error)
        proof_path=pathlib.Path(filename+'.wproof')
        proof=json.loads(proof_path.read_text(encoding='utf-8'))
        assert proof['manifest']['source']=='blender'
        assert proof['manifest']['protocol']=='workproof/3'
        events=[r['event'] for r in proof['records']]
        checkpoints=[event['checkpoint'] for event in events if event['kind']=='mesh']
        assert all(value in checkpoints for value in observed),'Structure digests were not signed into events'
        assert len(events[0]['checkpoint'])==64
        assert 'PRIVATE_OBJECT_NAME_NOT_FOR_EXPORT' not in json.dumps(proof)
        assert 'PRIVATE_MODIFIER_' not in json.dumps(proof)
        assert all('topology' not in event and 'matrix' not in event for event in events)
        assert events[0]['kind']=='start'
        assert any(e['kind']=='mesh' for e in events)
        assert any(e['kind']=='gap' for e in events)
        view_events=[e for e in events if e['kind']=='viewport']
        assert [e['metrics'] for e in view_events]==[{'viewport_changes':1},{'viewport_changes':2}]
        assert all(set(e['metrics'])=={'viewport_changes'} for e in view_events),'Do not export viewport coordinates'
        assert events[-1]['kind']=='save'
        assert events[-1]['metrics']['vertices']>events[0]['metrics']['vertices']
        assert events[-1]['metrics']['viewport_changes']==2
        verified=subprocess.run([engine,'verify',filename,str(proof_path)],capture_output=True,text=True)
        assert verified.returncode==0,verified.stdout+verified.stderr
        checkpoint_tamper=json.loads(proof_path.read_text(encoding='utf-8'))
        next(record for record in checkpoint_tamper['records'] if record['event']['kind']=='mesh')['event']['checkpoint']='00'*32
        bad_checkpoint=pathlib.Path(tmp,'modified-checkpoint.wproof');bad_checkpoint.write_text(json.dumps(checkpoint_tamper),encoding='utf-8')
        assert subprocess.run([engine,'verify',filename,str(bad_checkpoint)],capture_output=True).returncode==2
        for record in proof['records']:
            if record['event']['kind']=='mesh':record['event']['metrics']['vertices']+=1;break
        bad=pathlib.Path(tmp,'modified.wproof');bad.write_text(json.dumps(proof),encoding='utf-8')
        assert subprocess.run([engine,'verify',filename,str(bad)],capture_output=True).returncode==2
        original=json.loads(proof_path.read_text(encoding='utf-8'))
        next(r for r in original['records'] if r['event']['kind']=='viewport')['event']['metrics']['viewport_changes']+=1
        bad.write_text(json.dumps(original),encoding='utf-8')
        assert subprocess.run([engine,'verify',filename,str(bad)],capture_output=True).returncode==2
        # Real opt-in graph capture: immutable topology is bound by Rust to signed events.
        assert not pathlib.Path(filename+'.wgraph').exists(),'Default must not export topology'
        bpy.ops.workproof.stop()
        bpy.context.scene.workproof_evolution=True
        assert bpy.ops.workproof.start()=={'FINISHED'}
        wait_for(lambda:workproof._runtime.committed>=1,'Graph start: '+workproof._runtime.last_error)
        # Lose one ACK *after* the real collector commits: retry must submit the
        # same event and retain the original main-thread topology, not current bpy.
        original_request=workproof.request;lost={'once':False};captured={}
        def lose_ack(route,body):
            response=original_request(route,body)
            if route.endswith('/events') and not lost['once']:
                captured['event']=json.loads(json.dumps(body['events'][0]))
                lost['once']=True
                raise OSError('Acceptance fixture: committed event ACK lost')
            return response
        workproof.request=lose_ack
        obj.parent=None
        bpy.context.view_layer.update();workproof.on_change();workproof.sample()
        wait_for(lambda:workproof._runtime.failed,'Lost ACK did not pause transport')
        assert len(workproof._runtime.snapshots)==1,'Unacknowledged snapshot was published'
        committed_seq=workproof._runtime.seq
        # Mutate real bpy while pending. Retry must retain the earlier topology.
        obj.parent=parent;bpy.context.view_layer.update()
        workproof._runtime.retry.set()
        wait_for(lambda:len(workproof._runtime.snapshots)>=2 and workproof._runtime.seq==committed_seq+1,'Graph retry: '+workproof._runtime.last_error)
        workproof.request=original_request
        retained=workproof._runtime.snapshots[-1]
        assert retained['seq']==committed_seq and workproof._runtime.seq==committed_seq+1
        assert captured['event']['seq']==retained['seq']
        current_nodes=workproof.evolution_nodes(workproof._runtime)
        assert retained['nodes']!=current_nodes,'Retry resampled live bpy instead of immutable pending snapshot'
        # An observed deletion retires a modifier's ID; new IDs remain monotonic.
        previous_max=max(node['id'] for node in current_nodes)
        obj.modifiers.remove(obj.modifiers[-1]);workproof.evolution_nodes(workproof._runtime)
        obj.modifiers.new('PRIVATE_REPLACEMENT_MODIFIER','BEVEL')
        renewed=workproof.evolution_nodes(workproof._runtime)
        assert max(node['id'] for node in renewed)>previous_max
        workproof._runtime.paused=False
        assert bpy.ops.workproof.export()=={'FINISHED'}
        wait_for(lambda:bool(workproof._runtime.exported),'Graph export: '+workproof._runtime.last_error)
        graph_path=pathlib.Path(filename+'.wgraph')
        graph=json.loads(graph_path.read_text())
        assert len(graph['snapshots'])>=2
        assert graph['snapshots'][0]['nodes']!=graph['snapshots'][-1]['nodes']
        serialized=graph_path.read_text()
        assert 'PRIVATE_' not in serialized and 'matrix' not in serialized and 'pointer' not in serialized
        for snapshot in graph['snapshots']:
            assert snapshot['source']=='blender'
            assert all(set(node)=={'id','parent','order','kind','relation'} for node in snapshot['nodes'])
        checked=subprocess.run([engine,'inspect-evolution',str(proof_path),str(graph_path)],capture_output=True,text=True)
        assert checked.returncode==0,checked.stdout+checked.stderr
        report=json.loads(checked.stdout)
        assert report['valid'] and report['certificate_valid'] and not report['complete_history_verified']
        selected=pathlib.Path(tmp,'selected.wproof')
        seqs=','.join(str(snapshot['seq']) for snapshot in graph['snapshots'])
        assert subprocess.run([engine,'disclose',str(proof_path),str(selected),seqs],capture_output=True).returncode==0
        assert subprocess.run([engine,'inspect-evolution',str(selected),str(graph_path)],capture_output=True).returncode==0
        graph['snapshots'][-1]['nodes'][0]['kind']='layer'
        changed_graph=pathlib.Path(tmp,'changed.wgraph');changed_graph.write_text(json.dumps(graph))
        assert subprocess.run([engine,'inspect-evolution',str(proof_path),str(changed_graph)],capture_output=True).returncode==2
        # New endpoint must require authorization, reject browser use of the native secret,
        # derive source/session itself, and reject unknown fields and stale sequence.
        import urllib.request,urllib.error
        route='http://127.0.0.1:43127/v1/sessions/'+workproof._runtime.session+'/evolution-checkpoint'
        token=json.loads(pathlib.Path(tmp,'connection.json').read_text())['token']
        body={'seq':workproof._runtime.seq,'event_kind':'mesh','nodes':[]}
        def rejected(headers,payload,status):
            req=urllib.request.Request(route,data=json.dumps(payload).encode(),headers=dict({'Content-Type':'application/json'},**headers))
            try:urllib.request.urlopen(req,timeout=10)
            except urllib.error.HTTPError as error:assert error.code==status,(error.code,error.read())
            else:raise AssertionError('Unauthorized or malformed graph request accepted')
        rejected({},body,401)
        rejected({'Authorization':'Bearer '+token,'Origin':'https://example.invalid'},body,403)
        rejected({'Authorization':'Bearer '+token},dict(body,source='photoshop'),422)
        rejected({'Authorization':'Bearer '+token},dict(body,seq=0),400)
        result={'host':bpy.app.version_string,'native_adapter':'passed','opt_in_graph_full_and_selective':'passed','lost_ack_immutable_retry':'passed','observed_modifier_retirement':'passed','graph_tamper_and_endpoint_auth':'passed','signed_metrics':'passed','pause_gap':'passed','real_blend_file_binding':'passed','tampered_metric_rejected':'passed','viewport_rotation_and_zoom':'passed','paused_viewport_not_counted':'passed','viewport_tamper_rejected':'passed','idle_viewport_sample_p95_ms':sorted(timings)[94],'sample_scope':'100 synchronous samples in factory-startup scene, not general editor performance','events':len(events)}
        (root/'test-blender-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result))
    finally:
        if registered:workproof.unregister()
        proc.terminate();proc.wait(timeout=10)
