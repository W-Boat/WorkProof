"""CI-only native fingerprint cross-check against BLAKE3's published abc vector."""
import json,os,pathlib,subprocess,sys,tempfile
assert os.environ.get('GITHUB_ACTIONS')=='true'
with tempfile.TemporaryDirectory() as directory:
    artifact=pathlib.Path(directory)/'word copy with spaces.docx';artifact.write_bytes(b'abc')
    result=subprocess.run([sys.argv[1],'fingerprint',str(artifact)],capture_output=True,text=True,check=True)
    assert json.loads(result.stdout)=={'hash':'6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85','bytes':3}
    assert artifact.read_bytes()==b'abc'
    assert subprocess.run([sys.argv[1],'fingerprint',directory],capture_output=True).returncode!=0
print('PASS: file fingerprint matches fixed BLAKE3 vector; original unchanged; directories rejected')
