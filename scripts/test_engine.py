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
        assert result['manifest']['protocol']=='workproof/3'
        assert len(result['manifest']['merkle_root'])==64
        assert not result['manifest']['demo']
        checks.append('restart restores committed events and signing identity')
        certificate=state/'real-session.wproof'
        certificate.write_text(json.dumps(result),encoding='utf-8')
        verified=subprocess.run([exe,'verify',str(fixture/'essay.md'),str(certificate)],capture_output=True,text=True)
        assert verified.returncode==0,verified.stdout+verified.stderr
        selected=state/'real-session.selected.wproof'
        disclosed=subprocess.run([exe,'disclose',str(certificate),str(selected),'5,20'],capture_output=True,text=True)
        assert disclosed.returncode==0,disclosed.stdout+disclosed.stderr
        partial=subprocess.run([exe,'verify',str(fixture/'essay.md'),str(selected)],capture_output=True,text=True)
        assert partial.returncode==0,partial.stdout+partial.stderr
        partial_report=json.loads(partial.stdout)
        assert partial_report['scope']=='selective' and not partial_report['chain_valid'] and partial_report['merkle_valid']
        checks.append('real HTTP export commits a signed Merkle root and yields independently verifiable selective evidence')
        changed=state/'changed.md';changed.write_text('altered',encoding='utf-8')
        mismatch=subprocess.run([exe,'verify',str(changed),str(certificate)],capture_output=True,text=True)
        assert mismatch.returncode==2
        checks.append('independent CLI accepts real session and rejects replaced file')
        native=state/'native.blend';native.write_bytes(b'local-native-artifact')
        native_id=request('/v1/sessions',{'file_name':native.name,'started_at':'2026-10-31T00:00:00Z','source':'blender'})['session_id']
        native_endpoint='/v1/sessions/'+native_id
        initial=dict(seq=0,elapsed_ms=0,kind='start',inserted=0,deleted=0,chars=0,checkpoint='',metrics={'vertices':8})
        request(native_endpoint+'/events',{'events':[initial]})
        seal_event=dict(initial,seq=1,elapsed_ms=1000,kind='save')
        rejected(native_endpoint+'/seal',{'path':str(state/'different.blend'),'event':seal_event},{},400)
        native_proof=request(native_endpoint+'/seal',{'path':str(native),'event':seal_event})
        retried=request(native_endpoint+'/seal',{'path':str(native),'event':seal_event})
        assert native_proof==retried
        native_certificate=state/'native.wproof';native_certificate.write_text(json.dumps(native_proof),encoding='utf-8')
        assert subprocess.run([exe,'verify',str(native),str(native_certificate)],capture_output=True).returncode==0
        checks.append('native file sealing binds bytes, preserves signed metrics and retries idempotently')
        # Synthetic Word observations traverse the same event and export routes
        # as the add-in. No installed Word or user document is involved.
        revision_metrics = [
            {'word_revision_tracking':1,'word_revision_total':2,'word_revision_insert':1,'word_revision_delete':1,'word_revision_format':0,'word_revision_other':0},
            {'word_revision_tracking':1,'word_revision_total':4,'word_revision_insert':2,'word_revision_delete':1,'word_revision_format':1,'word_revision_other':0},
            {'word_revision_tracking':0,'word_revision_total':3,'word_revision_insert':1,'word_revision_delete':1,'word_revision_format':1,'word_revision_other':0},
        ]
        revision_id=request('/v1/sessions',{'file_name':'essay.md','started_at':'2026-11-11T00:00:00Z','source':'word','demo':True})['session_id']
        revision_endpoint='/v1/sessions/'+revision_id
        revision_events=[]
        for index,(kind,metrics) in enumerate(zip(('start','interaction','save'),revision_metrics)):
            revision_events.append(dict(initial,seq=index,elapsed_ms=index*1500,kind=kind,
                checkpoint=proof['manifest']['artifact_hash'] if kind=='save' else '',metrics=metrics))
        assert request(revision_endpoint+'/events',{'events':revision_events})['next_seq']==3
        revision_proof=request(revision_endpoint+'/export',{'artifact_hash':proof['manifest']['artifact_hash'],'artifact_bytes':proof['manifest']['artifact_bytes']})
        assert revision_proof['manifest']['source']=='word'
        assert [entry['event']['metrics'] for entry in revision_proof['records']]==revision_metrics
        revision_cert=state/'word-revision.wproof'
        revision_cert.write_text(json.dumps(revision_proof),encoding='utf-8')
        assert subprocess.run([exe,'verify',str(fixture/'essay.md'),str(revision_cert)],capture_output=True).returncode==0
        browser_fixture=os.environ.get('WORKPROOF_WORD_REVISION_FIXTURE')
        if browser_fixture:
            pathlib.Path(browser_fixture).write_bytes(revision_cert.read_bytes())
        checks.append('Word revision observations are preserved by the real collector and verified after signing')
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
(root/'test-engine-results.json').write_text(json.dumps({'passed':checks},indent=2),encoding='utf-8')
print(json.dumps({'passed':checks},indent=2))

# The shipped binary can serve the verifier without Node/Python on the user's machine.
with tempfile.TemporaryDirectory(prefix='workproof-static-') as tmp:
    (pathlib.Path(tmp)/'index.html').write_text('WorkProof static test',encoding='utf-8')
    server=subprocess.Popen([exe,'serve-web',tmp],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        for _ in range(50):
            try:
                with urllib.request.urlopen('http://127.0.0.1:4173',timeout=2) as response:
                    assert response.read()==b'WorkProof static test'
                break
            except urllib.error.URLError:time.sleep(.1)
        else:raise AssertionError('Static server did not become ready')
    finally:server.terminate();server.wait(timeout=10)
print('Native static verifier server passed')
