"""Local Blender adapter. bpy stays on the main thread; transport uses a bounded queue."""
bl_info = {"name":"WorkProof · 开源证人","author":"WorkProof contributors","version":(0,2,0),"blender":(4,2,0),"location":"View3D > Sidebar > WorkProof","category":"System"}
import datetime,json,os,pathlib,queue,threading,time,urllib.request
import bpy
from bpy.app.handlers import persistent
_runtime=None
_dirty=False
_last_metrics=None

def request(route,body):
    directory=os.environ.get('WORKPROOF_DATA_DIR') or os.path.join(os.environ.get('LOCALAPPDATA',os.path.expanduser('~/.local/share')),'WorkProof')
    info=json.loads(pathlib.Path(directory,'connection.json').read_text(encoding='utf-8'))
    token=info.get('token','')
    if info.get('port')!=43127 or len(token)!=64 or any(c not in '0123456789abcdef' for c in token):raise RuntimeError('无效的本地引擎连接信息')
    req=urllib.request.Request('http://127.0.0.1:43127'+route,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=10) as response:return json.load(response)

def metrics():
    return {'vertices':sum(len(m.vertices) for m in bpy.data.meshes),'edges':sum(len(m.edges) for m in bpy.data.meshes),'faces':sum(len(m.polygons) for m in bpy.data.meshes),'objects':len(bpy.data.objects),'modifiers':sum(len(o.modifiers) for o in bpy.data.objects)}

class Runtime:
    def __init__(self,filename):
        self.filename=filename;self.queue=queue.Queue(maxsize=2048)
        self.closed=threading.Event();self.retry=threading.Event()
        self.session=None;self.seq=0;self.started=time.monotonic()
        self.paused=False;self.failed=False;self.last_error='';self.exported='';self.committed=0
        self.thread=threading.Thread(target=self._work,daemon=True,name='WorkProof-local-transport');self.thread.start()
        self.put('begin',{'file_name':pathlib.Path(filename).name,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'blender'})
    def put(self,operation,payload):
        try:self.queue.put_nowait((operation,payload));return True
        except queue.Full:self.paused=True;self.last_error='离线队列已满，已暂停；继续时将记录缺口。';return False
    def event(self,kind,values=None):
        return self.put('event',{'elapsed_ms':int((time.monotonic()-self.started)*1000),'kind':kind,'inserted':0,'deleted':0,'chars':0,'checkpoint':'','metrics':values or {}})
    def seal(self,filename,values):
        event={'elapsed_ms':int((time.monotonic()-self.started)*1000),'kind':'save','inserted':0,'deleted':0,'chars':0,'checkpoint':'','metrics':values}
        self.exported='';return self.put('seal',{'path':filename,'event':event})
    def _execute(self,operation,payload):
        if operation=='begin':self.session=request('/v1/sessions',payload)['session_id'];return
        if self.session is None:raise RuntimeError('记录会话尚未建立')
        endpoint='/v1/sessions/'+self.session
        if operation=='event':
            request(endpoint+'/events',{'events':[dict(payload,seq=self.seq)]});self.seq+=1;self.committed+=1
        elif operation=='seal':
            proof=request(endpoint+'/seal',{'path':payload['path'],'event':dict(payload['event'],seq=self.seq)})
            output=pathlib.Path(payload['path']+'.wproof');temporary=output.with_name(output.name+'.tmp')
            temporary.write_text(json.dumps(proof,ensure_ascii=False,indent=2),encoding='utf-8');temporary.replace(output)
            self.seq+=1;self.committed+=1;self.exported=str(output)
    def _work(self):
        pending=None
        while not self.closed.is_set():
            if pending is None:
                try:pending=self.queue.get(timeout=.2)
                except queue.Empty:continue
            if self.failed:
                if not self.retry.wait(.2):continue
                self.retry.clear();self.failed=False
            try:self._execute(*pending);pending=None;self.last_error=''
            except Exception as error:self.last_error=str(error);self.failed=True;self.paused=True
    def close(self):self.closed.set();self.retry.set()

@persistent
def on_change(*_):
    global _dirty
    if _runtime and not _runtime.paused:_dirty=True
@persistent
def on_undo(*_):
    if _runtime and not _runtime.paused:_runtime.event('undo',metrics())
    on_change()
@persistent
def on_redo(*_):
    if _runtime and not _runtime.paused:_runtime.event('redo',metrics())
    on_change()
@persistent
def on_save(*_):
    if _runtime and not _runtime.paused:_runtime.event('save',metrics())
@persistent
def on_load(*_):
    global _runtime
    if _runtime:_runtime.close();_runtime=None
def sample():
    global _dirty,_last_metrics
    if _runtime and bpy.data.filepath!=_runtime.filename:_runtime.paused=True;_runtime.last_error='文件路径已改变，请停止后重新开始记录。'
    if _runtime and not _runtime.paused and _dirty:
        _dirty=False;values=metrics()
        _runtime.event('mesh',values);_last_metrics=values
    return 1.0

class WORKPROOF_OT_start(bpy.types.Operator):
    bl_idname='workproof.start';bl_label='开始记录当前工程'
    def execute(self,context):
        global _runtime,_last_metrics
        if _runtime:self.report({'ERROR'},'请先停止当前记录');return {'CANCELLED'}
        if not bpy.data.filepath:self.report({'ERROR'},'请先保存当前 .blend 工程');return {'CANCELLED'}
        _runtime=Runtime(bpy.data.filepath);_last_metrics=metrics();_runtime.event('start',_last_metrics);return {'FINISHED'}
    def invoke(self,context,event):return context.window_manager.invoke_confirm(self,event)
class WORKPROOF_OT_pause(bpy.types.Operator):
    bl_idname='workproof.pause';bl_label='暂停 / 继续'
    def execute(self,context):
        if not _runtime:return {'CANCELLED'}
        if _runtime.paused:
            if not _runtime.event('gap',metrics()) or not _runtime.event('resume',metrics()):return {'CANCELLED'}
            _runtime.paused=False;_runtime.retry.set()
        else:_runtime.event('pause',metrics());_runtime.paused=True
        return {'FINISHED'}
class WORKPROOF_OT_export(bpy.types.Operator):
    bl_idname='workproof.export';bl_label='保存并导出过程证书'
    def execute(self,context):
        if not _runtime or _runtime.paused:self.report({'ERROR'},'请先开始或继续记录');return {'CANCELLED'}
        if bpy.data.filepath!=_runtime.filename:self.report({'ERROR'},'工程路径已改变');return {'CANCELLED'}
        bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath);_runtime.seal(bpy.data.filepath,metrics());return {'FINISHED'}
class WORKPROOF_OT_stop(bpy.types.Operator):
    bl_idname='workproof.stop';bl_label='停止记录'
    def execute(self,context):on_load();return {'FINISHED'}
class WORKPROOF_PT_panel(bpy.types.Panel):
    bl_label='WorkProof · 开源证人';bl_idname='WORKPROOF_PT_panel';bl_space_type='VIEW_3D';bl_region_type='UI';bl_category='WorkProof'
    def draw(self,context):
        layout=self.layout;layout.label(text='本地记录 · 不录屏 · 不保存网格内容',icon='SHIELD')
        if not _runtime:layout.operator('workproof.start',icon='PLAY')
        else:
            layout.label(text=('已暂停' if _runtime.paused else '记录中')+' · '+str(_runtime.committed)+' 条已提交事件')
            layout.operator('workproof.pause',icon='PAUSE');layout.operator('workproof.export',icon='EXPORT');layout.operator('workproof.stop',icon='CANCEL')
            if _runtime.exported:layout.label(text='证书已保存在工程旁边',icon='CHECKMARK')
            if _runtime.last_error:layout.label(text=_runtime.last_error[:90],icon='ERROR')
        layout.label(text='仅采集网格统计、撤销与保存。');layout.label(text='不代表真人认证；视口旋转暂未采集。')

CLASSES=(WORKPROOF_OT_start,WORKPROOF_OT_pause,WORKPROOF_OT_export,WORKPROOF_OT_stop,WORKPROOF_PT_panel)
HANDLERS=((bpy.app.handlers.depsgraph_update_post,on_change),(bpy.app.handlers.undo_post,on_undo),(bpy.app.handlers.redo_post,on_redo),(bpy.app.handlers.save_post,on_save),(bpy.app.handlers.load_pre,on_load))
def register():
    for cls in CLASSES:bpy.utils.register_class(cls)
    for handlers,fn in HANDLERS:
        if fn not in handlers:handlers.append(fn)
    if not bpy.app.timers.is_registered(sample):bpy.app.timers.register(sample,first_interval=1,persistent=True)
def unregister():
    on_load()
    if bpy.app.timers.is_registered(sample):bpy.app.timers.unregister(sample)
    for handlers,fn in HANDLERS:
        if fn in handlers:handlers.remove(fn)
    for cls in reversed(CLASSES):bpy.utils.unregister_class(cls)
