"""Native CI smoke test: real tray binary starts a collector without a webview."""
import json,os,pathlib,subprocess,sys,tempfile,time,urllib.request
with tempfile.TemporaryDirectory(prefix='workproof-tray-') as tmp:
    command = [str(pathlib.Path(sys.argv[1]).resolve())]
    env = dict(os.environ, WORKPROOF_DATA_DIR=tmp)
    if sys.platform == 'win32':
        command.append('--login-startup')
        env.pop('WORKPROOF_HEADLESS', None)
    else:
        env['WORKPROOF_HEADLESS'] = '1'
    proc = subprocess.Popen(command, env=env)
    try:
        for _ in range(150):
            if proc.poll() is not None:
                error=pathlib.Path(tmp)/'startup-error.txt'
                raise RuntimeError(error.read_text() if error.exists() else 'Tray exited before readiness')
            try:
                info=json.loads((pathlib.Path(tmp)/'connection.json').read_text())
                req=urllib.request.Request('http://127.0.0.1:'+str(info['port'])+'/v1/status',headers={'Authorization':'Bearer '+info['token']})
                with urllib.request.urlopen(req,timeout=2) as res:status=json.load(res)
                assert status['protocol']=='workproof/3'
                break
            except (OSError,ValueError):time.sleep(.2)
        else:raise RuntimeError('Tray collector did not become ready')
        if sys.platform == 'win32':
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.WinDLL('user32', use_last_error=True)
            callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
            visible = []
            @callback_type
            def inspect_window(window, _):
                owner = wintypes.DWORD()
                user32.GetWindowThreadProcessId(window, ctypes.byref(owner))
                if owner.value == proc.pid and user32.IsWindowVisible(window):
                    visible.append(window)
                return True
            user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
            user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
            user32.IsWindowVisible.argtypes = [wintypes.HWND]
            if not user32.EnumWindows(inspect_window, 0):
                raise ctypes.WinError(ctypes.get_last_error())
            assert not visible, 'Login startup opened a visible WorkProof window'
        result={'tray_startup':'passed','protocol':status['protocol'],'webview_opened':False}
        pathlib.Path('test-tray-results.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
