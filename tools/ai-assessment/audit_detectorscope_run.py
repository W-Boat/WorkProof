"""Actions-only authenticated artifact audit of one completed independent evaluation."""
import hashlib
import io
import json
import os
import pathlib
import re
import urllib.error
import urllib.request
import zipfile
import evaluate as ev
from audit_detectorscope import audit

REPOSITORY='W-Boat/WorkProof'
def api(route):
    req=urllib.request.Request('https://api.github.com/repos/'+REPOSITORY+'/'+route,
        headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'Accept':'application/vnd.github+json','User-Agent':'WorkProof-report-audit'})
    with urllib.request.urlopen(req,timeout=30) as response: raw=response.read(4*1024*1024+1)
    assert len(raw)<=4*1024*1024
    return json.loads(raw)

def artifact_bytes(identifier,expected_size,expected_digest):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*arguments): return None
    req=urllib.request.Request(f'https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{identifier}/zip',
        headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'User-Agent':'WorkProof-report-audit'})
    try:
        urllib.request.build_opener(NoRedirect()).open(req,timeout=30)
        raise ValueError('EXPECTED_ARTIFACT_REDIRECT')
    except urllib.error.HTTPError as response:
        assert response.code==302
        location=response.headers['Location']
    assert location.startswith('https://')
    # Fresh request intentionally has no GitHub authorization header.
    with urllib.request.urlopen(location,timeout=60) as response: raw=response.read(16*1024*1024+1)
    assert len(raw)==expected_size and len(raw)<=16*1024*1024
    assert 'sha256:'+hashlib.sha256(raw).hexdigest()==expected_digest
    return raw

def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true'
    run_id=os.environ['WORKPROOF_EVALUATION_RUN'];assert re.fullmatch(r'[1-9][0-9]{0,19}',run_id)
    run=api('actions/runs/'+run_id)
    assert run['repository']['full_name']==REPOSITORY and run['head_repository']['full_name']==REPOSITORY
    assert run['name']=='Independent DetectorScope bilingual calibration and heldout evaluation'
    assert run['event'] in ('push','workflow_dispatch') and run['head_branch']=='codex/workproof-mvp'
    assert run['status']=='completed' and run['conclusion']=='success','EVALUATION_NOT_COMPLETED_SUCCESSFULLY'
    assert re.fullmatch(r'[0-9a-f]{40}',run['head_sha'])
    listed=api('actions/runs/'+run_id+'/artifacts?per_page=100')
    assert listed['total_count']<=100
    root=pathlib.Path(__file__).resolve().parents[2]
    frozen=ev.strict_json((root/'docs/evidence/detectorscope-selection-70beaf5/selection-receipt.json').read_bytes())
    results={}
    for language in ('en','zh'):
        matches=[a for a in listed['artifacts'] if a['name']=='detectorscope-independent-'+language]
        assert len(matches)==1
        meta=matches[0];assert not meta['expired'] and 0<meta['size_in_bytes']<=16*1024*1024
        assert re.fullmatch(r'sha256:[0-9a-f]{64}',meta['digest'])
        raw=artifact_bytes(meta['id'],meta['size_in_bytes'],meta['digest'])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            def member(suffix):
                entries=[i for i in archive.infolist() if i.filename==suffix or i.filename.endswith('/'+suffix)]
                assert len(entries)==1 and 0<entries[0].file_size<=8*1024*1024
                return archive.read(entries[0])
            selection=ev.strict_json(member('detectorscope-data-selection.json'))
            assert selection['manifest_sha256']==frozen['manifest_sha256']
            assert selection['prior_index_sha256']==frozen['prior_index_sha256']
            conversion=member('detectorscope-conversion-results.json')
            prefix='detectorscope-evaluation-'+language+'/'
            result=audit(frozen,language,ev.strict_json(member(prefix+'calibration-report.json')),
                ev.strict_json(member(prefix+'frozen-policy.json')),ev.strict_json(member(prefix+'heldout-report.json')),
                hashlib.sha256(conversion).hexdigest())
            results[language]=dict(result,artifact_id=meta['id'],artifact_digest=meta['digest'])
    report={'evaluation_run':int(run_id),'evaluation_source_commit':run['head_sha'],'auditor_source_commit':os.environ['GITHUB_SHA'],
            'languages':results,'scope':'artifact integrity and statistical consistency only; no identity, label truth or production certification'}
    (root/'detectorscope-independent-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Both language artifacts passed integrity and statistical audit; production remains disabled.')

if __name__=='__main__':
    try: main()
    except Exception:
        print('Independent report audit did not complete; no validated conclusion published.')
        raise SystemExit(1)
