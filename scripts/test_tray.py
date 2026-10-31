"""Windows CI smoke test: real tray binary starts a collector without a webview."""
import json,os,pathlib,subprocess,sys,tempfile,time,urllib.request
with tempfile.TemporaryDirectory(prefix='workproof-tray-') as tmp:
    proc=subprocess.Popen([str(pathlib.Path(sys.argv[1]).resolve())],env=dict(os.environ,WORKPROOF_DATA_DIR=tmp))
    try:
        for _ in range(150):
            if proc.poll() is not None:
                error=pathlib.Path(tmp)/'startup-error.txt'
                raise RuntimeError(error.read_text() if error.exists() else 'Tray exited before readiness')
            try:
                info=json.loads((pathlib.Path(tmp)/'connection.json').read_text())
                req=urllib.request.Request('http://127.0.0.1:'+str(info['port'])+'/v1/status',headers={'Authorization':'Bearer '+info['token']})
                with urllib.request.urlopen(req,timeout=2) as res:status=json.load(res)
                assert status['protocol']=='workproof/1'
                break
            except (OSError,ValueError):time.sleep(.2)
        else:raise RuntimeError('Tray collector did not become ready')
        result={'tray_startup':'passed','protocol':status['protocol'],'webview_opened':False}
        pathlib.Path('test-tray-results.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
