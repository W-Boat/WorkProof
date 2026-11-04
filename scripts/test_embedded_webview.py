"""Actions-only real installed Linux WebView. No mocked IPC or browser engine."""
import base64,json,os,pathlib,signal,subprocess,sys,tempfile,time,urllib.request,urllib.error

assert os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform=='linux'
evidence=pathlib.Path('test-results/embedded-webview');evidence.mkdir(parents=True,exist_ok=True)
session=None
def call(method,path,body=None):
    payload=json.dumps(body).encode() if body is not None else None
    request=urllib.request.Request('http://127.0.0.1:4444'+path,data=payload,headers={'Content-Type':'application/json'},method=method)
    try:
        with urllib.request.urlopen(request,timeout=90) as response:
            value=json.load(response)['value']
    except urllib.error.HTTPError as error:
        try:
            details=json.loads(error.read(65536)).get('value',{})
            code=details.get('error') if isinstance(details,dict) else None
        except Exception:code=None
        if code:raise RuntimeError('Native WebDriver: '+code) from error
        raise
    if isinstance(value,dict) and value.get('error'):raise RuntimeError(value['error'])
    return value
def wait(action):
    deadline=time.monotonic()+60;last=None
    while time.monotonic()<deadline:
        try:return action()
        except Exception as error:last=error;time.sleep(.3)
    raise AssertionError('Native WebView operation timed out') from last
def execute(script,args=None):return call('POST',f'/session/{session}/execute/sync',{'script':script,'args':args or []})
def handles():return call('GET',f'/session/{session}/window/handles')
def switch(handle):call('POST',f'/session/{session}/window',{'handle':handle})
def click_element(element):
    identifier=element['element-6066-11e4-a52e-4f735466cecf']
    # The page intentionally uses smooth scrolling. Bring the target into view
    # without waiting for a WebDriver-internal scroll animation to finish.
    execute("arguments[0].scrollIntoView({block:'center',behavior:'instant'});return true",[element])
    def visible():
        assert execute("const r=arguments[0].getBoundingClientRect();return r.width>0&&r.height>0&&r.top+r.height/2>=0&&r.top+r.height/2<innerHeight",[element])
    wait(visible)
    call('POST',f'/session/{session}/element/{identifier}/click',{})

def click(selector):
    click_element(call('POST',f'/session/{session}/element',{'using':'css selector','value':selector}))

def select_file(selector,path):
    element=call('POST',f'/session/{session}/element',{'using':'css selector','value':selector})
    identifier=element['element-6066-11e4-a52e-4f735466cecf']
    call('POST',f'/session/{session}/element/{identifier}/value',{'text':str(path.resolve())})
    def displayed():
        assert execute("const input=document.querySelector(arguments[0]);const card=input.closest('.upload-field')||input.closest('button');return card?.querySelector('strong')?.textContent===arguments[1]",[selector,path.name])
    wait(displayed)

def click_text(text):
    element=execute('return Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes('+json.dumps(text)+'))')
    assert element
    click_element(element)
def screenshot(name):
    data=call('GET',f'/session/{session}/screenshot');(evidence/name).write_bytes(base64.b64decode(data))
with tempfile.TemporaryDirectory(prefix='workproof-native-webview-') as temporary:
    env=dict(os.environ,WORKPROOF_DATA_DIR=temporary+'/engine',XDG_CONFIG_HOME=temporary+'/config',XDG_DATA_HOME=temporary+'/data',WEBKIT_DISABLE_DMABUF_RENDERER='1')
    env.pop('WORKPROOF_HEADLESS',None)
    # Synthetic CI session only: preserve native-driver diagnostics for failures.
    driver_log=(evidence/'native-driver.log').open('wb')
    driver=subprocess.Popen([sys.argv[1]],env=env,stdout=driver_log,stderr=subprocess.STDOUT,start_new_session=True)
    try:
        wait(lambda:call('GET','/status'))
        value=call('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'wry','tauri:options':{'application':'/usr/bin/workproof-desktop'}}}})
        session=value['sessionId']
        call('POST',f'/session/{session}/timeouts',{'script':30000,'pageLoad':60000,'implicit':0})
        def ready():
            assert '可以开始记录' in execute("return document.getElementById('status')?.textContent || ''")
        wait(ready);workbench=handles()[0];screenshot('workbench.png')
        # The PC shell keeps verification in its own workspace. Exercise the
        # real navigation before opening the embedded verifier window.
        # The separate historical milestone also runs this script against an
        # older installed package, which has no workspace navigation.
        if execute("return !!document.querySelector('.workspace-nav button[data-view=verification]')"):
            click('.workspace-nav button[data-view="verification"]')
            def verification_workspace():
                assert execute("return document.body.dataset.view==='verification' && document.getElementById('verify').getBoundingClientRect().height>0")
            wait(verification_workspace)
            screenshot('workbench-verification.png')
        click('#verify')
        def second():
            result=handles();assert len(result)==2;return next(h for h in result if h!=workbench)
        verifier=wait(second);switch(verifier)
        def loaded():assert execute("return !!document.querySelector('input[aria-label=\"选择最终作品\"]')")
        wait(loaded)
        url=call('GET',f'/session/{session}/url');assert url.startswith('http://127.0.0.1:')
        blocked=call('POST',f'/session/{session}/execute/async',{'script':"const done=arguments[arguments.length-1];const invoke=window.__TAURI__?.core?.invoke;if(!invoke){done(true);}else{invoke('pending_adapters').then(()=>done(false),()=>done(true));}",'args':[]})
        assert blocked is True,'Embedded page acquired workbench commands'
        click_text('先体验一份演示证据')
        def verified():assert execute("return !!document.querySelector('.result-banner.success')")
        wait(verified)
        result_flow=os.environ.get('WORKPROOF_EXPECT_RESULT_FLOW')=='1'
        if result_flow:
            def focused_result():assert execute("return document.activeElement?.id==='verification-result'")
            wait(focused_result)
            assert execute("return Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='查看核验结果')")
            click_text('查看核验结果');wait(focused_result)
        # Select actual filesystem files through WebDriver's file-input command.
        # No File/DataTransfer injection, mocked worker or app-only test bridge.
        files=pathlib.Path(temporary)/'个人资料';files.mkdir(mode=0o700)
        for name in ('essay.md','essay.md.wproof'):
            with urllib.request.urlopen(url.rstrip('/')+'/demo/'+name,timeout=10) as response:
                body=response.read(262145)
            assert len(body)<=262144
            (files/name).write_bytes(body)
        click('button[aria-label="清空重新核验"]')
        if result_flow:
            def upload_focused():
                assert execute("return document.activeElement===document.querySelector('.uploads .upload')"),'Clear did not restore file-selection focus'
            wait(upload_focused)
        select_file('input[aria-label="选择最终作品"]',files/'essay.md')
        select_file('input[aria-label="选择 .wproof 证书"]',files/'essay.md.wproof')
        def selected():assert execute("return Array.from(document.querySelectorAll('.upload-copy strong')).map(e=>e.textContent).includes('essay.md.wproof')")
        wait(selected);click_text('开始本地核验');wait(verified);screenshot('files-verified.png')
        changed=pathlib.Path(temporary)/'changed';changed.mkdir(mode=0o700)
        (changed/'essay.md').write_bytes((files/'essay.md').read_bytes()+b'\nchanged by acceptance fixture\n')
        select_file('input[aria-label="选择最终作品"]',changed/'essay.md')
        click_text('开始本地核验')
        def rejected():assert execute("return !!document.querySelector('.result-banner.failure')")
        wait(rejected);screenshot('files-rejected.png')
        if result_flow:wait(focused_result)
        select_file('input[aria-label="选择最终作品"]',files/'essay.md')
        click_text('开始本地核验');wait(verified)
        call('POST',f'/session/{session}/window/rect',{'width':480,'height':640})
        assert execute('return document.documentElement.scrollWidth<=window.innerWidth'),'Narrow native window overflowed horizontally'
        execute('window.scrollTo(0,0);return true')
        call('POST',f'/session/{session}/actions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue00f'},{'type':'keyUp','value':'\ue00f'}]}]})
        def scrolled():assert execute('return window.scrollY>0')
        wait(scrolled);screenshot('narrow-scrolled.png')
        call('POST',f'/session/{session}/window/rect',{'width':1120,'height':800})
        execute("window.location.href='http://127.0.0.1:43127/';return true")
        assert call('GET',f'/session/{session}/url')==url,'Navigation escaped verifier origin'
        screenshot('verifier.png')
        switch(workbench);click('#verify');assert len(handles())==2,'Repeated open created another verifier'
        (evidence/'acceptance.json').write_text(json.dumps({'test_source_commit':os.environ['GITHUB_SHA'],'application_source_commit':os.environ.get('WORKPROOF_APPLICATION_COMMIT',os.environ['GITHUB_SHA']),'scope':'Installed Linux package and native WebKit WebView; real open/reuse, demo Wasm, filesystem file input, tamper rejection, narrow keyboard scrolling and IPC/navigation rejection. OS file chooser UI, download and printing not covered.','result_flow_checked':result_flow,'url':url,'checks':['workbench IPC status','native embedded page','real demo Wasm verification','filesystem file input via WebDriver','selected-file Wasm verification','tampered file rejection','original file reselection','narrow layout and PageDown scrolling','no workbench command access','navigation restriction','window reuse']+(['result focus on pass and failure','view completed result','clear restores file selection focus'] if result_flow else [])},indent=2),encoding='utf-8')
        print('PASS: installed native WebView verifies filesystem input, rejects changed bytes, scrolls and reuses the local verifier; workbench commands unavailable')
    except Exception as error:
        (evidence/'failure.json').write_text(json.dumps({'exception_type':type(error).__name__,'driver_exit_code':driver.poll(),'test_source_commit':os.environ['GITHUB_SHA'],'application_source_commit':os.environ.get('WORKPROOF_APPLICATION_COMMIT',os.environ['GITHUB_SHA']),'scope':'Synthetic CI installed-package session; diagnostic record is not acceptance.'},indent=2),encoding='utf-8')
        raise
    finally:
        if session:
            try:screenshot('last-ui.png');call('DELETE',f'/session/{session}')
            except Exception:pass
        try:os.killpg(driver.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:driver.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(driver.pid,signal.SIGKILL);driver.wait()
        driver_log.close()
