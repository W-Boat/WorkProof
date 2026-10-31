"""Real HTTP + SQLite restart + standalone verifier integration tests. CI only."""
import json, os, pathlib, subprocess, sys, tempfile, time, urllib.request, urllib.error

exe = str(pathlib.Path(sys.argv[1]).resolve())
root = pathlib.Path(__file__).resolve().parents[1]
fixture = root / 'apps/verifier/public/demo'
proof = json.loads((fixture / 'essay.md.wproof').read_text(encoding='utf-8'))
events = [r['event'] for r in proof['records']]
checks = []
with tempfile.TemporaryDirectory(prefix='workproof-test-') as tmp:
    state = pathlib.Path(tmp)
    env = dict(os.environ, WORKPROOF_DATA_DIR=tmp)
    def launch():
        proc = subprocess.Popen([exe], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for _ in range(100):
            if proc.poll() is not None:
                raise RuntimeError(proc.communicate())
            try:
                info = json.loads((state/'connection.json').read_text())
                request('/v1/status', info=info)
                return proc, info
            except (OSError, ValueError, urllib.error.URLError):
                time.sleep(.1)
        proc.terminate()
        raise RuntimeError('Collector startup timed out')
    def request(route, body=None, info=None, extra=None):
        info = info or connection
        headers = {'Authorization':'Bearer '+info['token'], 'Content-Type':'application/json'}
        headers.update(extra or {})
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request('http://127.0.0.1:'+str(info['port'])+route, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as result:
            return json.load(result)
    def rejected(route, body, extra, code):
        try:
            request(route,body,extra=extra)
            raise AssertionError('Request unexpectedly accepted')
        except urllib.error.HTTPError as error:
            assert error.code == code, error.code
    proc, connection = launch()
    try:
        rejected('/v1/status',None,{'Authorization':'Bearer wrong'},401)
        rejected('/v1/status',None,{'Origin':'https://malicious.example'},403)
        checks.append('unauthenticated and browser-origin requests denied')
        session = request('/v1/sessions',{'file_name':'essay.md','started_at':'2026-10-31T00:00:00Z','source':'integration-test'})['session_id']
        endpoint = '/v1/sessions/'+session
        a = request(endpoint+'/events',{'events':events[:40]})
        assert a['next_seq']==40
        b = request(endpoint+'/events',{'events':events[:40]})
        assert b['next_seq']==40
        checks.append('durable batch and idempotent retry')
        conflict = dict(events[0], inserted=1)
        rejected(endpoint+'/events',{'events':[conflict]}, {},400)
        rejected(endpoint+'/events',{'events':[events[41]]}, {},400)
        checks.append('conflicting duplicate and missing sequence rejected')
        proc.terminate();proc.wait(timeout=10)
        proc, connection = launch()
        request(endpoint+'/events',{'events':events[40:]})
        result = request(endpoint+'/export',{'artifact_hash':proof['manifest']['artifact_hash'],'artifact_bytes':proof['manifest']['artifact_bytes']})
        assert result['manifest']['event_count']==len(events)
        assert not result['manifest']['demo']
        checks.append('restart restores committed events and signing identity')
        certificate=state/'real-session.wproof'
        certificate.write_text(json.dumps(result),encoding='utf-8')
        verified=subprocess.run([exe,'verify',str(fixture/'essay.md'),str(certificate)],capture_output=True,text=True)
        assert verified.returncode==0,verified.stdout+verified.stderr
        changed=state/'changed.md';changed.write_text('altered',encoding='utf-8')
        mismatch=subprocess.run([exe,'verify',str(changed),str(certificate)],capture_output=True,text=True)
        assert mismatch.returncode==2
        checks.append('independent CLI accepts real session and rejects replaced file')
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
(root/'test-engine-results.json').write_text(json.dumps({'passed':checks},indent=2),encoding='utf-8')
print(json.dumps({'passed':checks},indent=2))
