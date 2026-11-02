"""Actions-only real installed Linux WebView. No mocked IPC or browser engine."""
import base64,json,os,pathlib,signal,subprocess,sys,tempfile,time,urllib.request,urllib.error

assert os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform=='linux'
evidence=pathlib.Path('test-results/embedded-webview');evidence.mkdir(parents=True,exist_ok=True)
session=None
def call(method,path,body=None):
    payload=json.dumps(body).encode() if body is not None else None
    request=urllib.request.Request('http://127.0.0.1:4444'+path,data=payload,headers={'Content-Type':'application/json'},method=method)
    with urllib.request.urlopen(request,timeout=90) as response:
        value=json.load(response)['value']
    if isinstance(value,dict) and value.get('error'):raise RuntimeError(value['error'])
    return value
def wait(action):
    deadline=time.monotonic()+60;last=None
    while time.monotonic()<deadline:
        try:return action()
        except Exception as error:last=error;time.sleep(.3)
    raise AssertionError('Native WebView operation timed out') from last
def execute(script):return call('POST',f'/session/{session}/execute/sync',{'script':script,'args':[]})
def handles():return call('GET',f'/session/{session}/window/handles')
def switch(handle):call('POST',f'/session/{session}/window',{'handle':handle})
def click(selector):
    element=call('POST',f'/session/{session}/element',{'using':'css selector','value':selector})
    identifier=element['element-6066-11e4-a52e-4f735466cecf']
    call('POST',f'/session/{session}/element/{identifier}/click',{})
def screenshot(name):
    data=call('GET',f'/session/{session}/screenshot');(evidence/name).write_bytes(base64.b64decode(data))
with tempfile.TemporaryDirectory(prefix='workproof-native-webview-') as temporary:
    env=dict(os.environ,WORKPROOF_DATA_DIR=temporary+'/engine',XDG_CONFIG_HOME=temporary+'/config',XDG_DATA_HOME=temporary+'/data',WEBKIT_DISABLE_DMABUF_RENDERER='1')
    env.pop('WORKPROOF_HEADLESS',None)
    driver=subprocess.Popen([sys.argv[1]],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        wait(lambda:call('GET','/status'))
        value=call('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'wry','tauri:options':{'application':'/usr/bin/workproof-desktop'}}}})
        session=value['sessionId']
        call('POST',f'/session/{session}/timeouts',{'script':30000,'pageLoad':60000,'implicit':0})
        def ready():
            assert '可以开始记录' in execute("return document.getElementById('status')?.textContent || ''")
        wait(ready);workbench=handles()[0];screenshot('workbench.png')
        click('#verify')
        def second():
            result=handles();assert len(result)==2;return next(h for h in result if h!=workbench)
        verifier=wait(second);switch(verifier)
        def loaded():assert execute("return !!document.querySelector('input[aria-label=\"选择最终作品\"]')")
        wait(loaded)
        url=call('GET',f'/session/{session}/url');assert url.startswith('http://127.0.0.1:')
        blocked=call('POST',f'/session/{session}/execute/async',{'script':"const done=arguments[arguments.length-1];const invoke=window.__TAURI__?.core?.invoke;if(!invoke){done(true);}else{invoke('pending_adapters').then(()=>done(false),()=>done(true));}",'args':[]})
        assert blocked is True,'Embedded page acquired workbench commands'
        element=execute("return Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('先体验一份演示证据'))")
        assert element
        identifier=element['element-6066-11e4-a52e-4f735466cecf']
        call('POST',f'/session/{session}/element/{identifier}/click',{})
        def verified():assert execute("return !!document.querySelector('.result-banner.success')")
        wait(verified)
        execute("window.location.href='http://127.0.0.1:43127/';return true")
        assert call('GET',f'/session/{session}/url')==url,'Navigation escaped verifier origin'
        screenshot('verifier.png')
        switch(workbench);click('#verify');assert len(handles())==2,'Repeated open created another verifier'
        (evidence/'acceptance.json').write_text(json.dumps({'source_commit':os.environ['GITHUB_SHA'],'scope':'Installed Linux package and native WebKit WebView; real open/reuse, demo Wasm and IPC/navigation rejection. File picker/download/printing not covered.','url':url,'checks':['workbench IPC status','native embedded page','real demo Wasm verification','no workbench command access','navigation restriction','window reuse']},indent=2),encoding='utf-8')
        print('PASS: installed native WebView opens and reuses local verifier; workbench commands unavailable')
    finally:
        if session:
            try:screenshot('last-ui.png');call('DELETE',f'/session/{session}')
            except Exception:pass
        try:os.killpg(driver.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:driver.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(driver.pid,signal.SIGKILL);driver.wait()
