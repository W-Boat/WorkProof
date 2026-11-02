"""Actions-only real PDF export/explicit-CA verification; no source reserialization."""
import argparse,json,os,pathlib,shutil,subprocess,sys,tempfile
from pypdf import PdfReader,PdfWriter
assert os.environ.get('GITHUB_ACTIONS')=='true'
parser=argparse.ArgumentParser()
parser.add_argument('tool');parser.add_argument('fixture')
parser.add_argument('--desktop-report',type=pathlib.Path)
parser.add_argument('--desktop-embed-report',type=pathlib.Path)
args=parser.parse_args()
tool,fixture=(str(pathlib.Path(p).resolve()) for p in [args.tool,args.fixture])
verified_reports=[];embedded_reports=[]
openssl=shutil.which('openssl');assert openssl
def run(*args,ok=True):
    result=subprocess.run(list(map(str,args)),capture_output=True,timeout=60)
    assert (result.returncode==0)==ok,result.stderr.decode(errors='replace')[:1200]
    return result
def pdf(encrypted=False):
    objects=[b'<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(existing.txt) 6 0 R] >> >> /AF [6 0 R] >>',
      b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      b'<< /Length 40 >>\nstream\nBT /F1 12 Tf 20 200 Td (Hello PDF) Tj ET\nendstream',
      b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      b'<< /Type /Filespec /F (existing.txt) /AFRelationship /Data /EF << /F 7 0 R >> >>',
      b'<< /Type /EmbeddedFile /Length 8 >>\nstream\nexisting\nendstream']
    # Calculate stream lengths from the actual synthetic bytes.
    content=b'BT /F1 12 Tf 20 200 Td (Hello PDF) Tj ET'
    objects[3]=b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream'
    data=bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');offsets=[0]
    for i,o in enumerate(objects,1):
        offsets.append(len(data));data+=f'{i} 0 obj\n'.encode()+o+b'\nendobj\n'
    start=len(data);data+=b'xref\n0 8\n0000000000 65535 f \n'
    for offset in offsets[1:]:data+=f'{offset:010} 00000 n \n'.encode()
    data+=b'trailer\n<< /Size 8 /Root 1 0 R'+(b' /Encrypt << /Filter /Standard /V 1 /R 2 >>' if encrypted else b'')+f' >>\nstartxref\n{start}\n%%EOF\n'.encode()
    return bytes(data)
with tempfile.TemporaryDirectory(prefix='workproof-pdf-ci-') as directory:
    root=pathlib.Path(directory);source=root/'source.pdf';original=pdf();source.write_bytes(original)
    run(fixture,source,root)
    config=root/'openssl.cnf'
    config.write_text('[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Synthetic WorkProof PDF\n[root]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n',encoding='ascii')
    for prefix in ['ca','wrong']:
        run(openssl,'req','-config',config,'-extensions','root','-x509','-sha256','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/(prefix+'.key'),'-out',root/(prefix+'.pem'),'-days','2','-subj','/CN='+prefix)
    run(openssl,'req','-config',config,'-new','-sha256','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/'signer.key','-out',root/'signer.csr')
    (root/'ext.cnf').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n',encoding='ascii')
    run(openssl,'x509','-req','-sha256','-in',root/'signer.csr','-CA',root/'ca.pem','-CAkey',root/'ca.key','-CAcreateserial','-out',root/'signer.pem','-days','2','-extfile',root/'ext.cnf')
    (root/'chain.pem').write_bytes((root/'signer.pem').read_bytes()+(root/'ca.pem').read_bytes())
    def embed(src,proof,dst,ok=True):
        return run(tool,'embed',src,proof,root/'chain.pem',root/'signer.key',dst,'--allow-public-process',ok=ok)
    for scope in ['full','selected']:
        signed=root/(scope+'.pdf')
        report=json.loads(embed(source,root/(scope+'.wproof'),signed).stdout)
        embedded_reports.append(report)
        assert report['original_pdf_checked'] and not report['c2pa_trusted']
        assert signed.read_bytes().startswith(original) and source.read_bytes()==original
        parsed=PdfReader(signed)
        assert len(parsed.pages)==1 and 'Hello PDF' in parsed.pages[0].extract_text()
        assert parsed.attachments['existing.txt']==[b'existing']
        assert 'WorkProof provenance.c2pa' in parsed.attachments
        assert len(parsed.trailer['/Root']['/AF'])==2
        checked=json.loads(run(tool,'verify',signed,root/'ca.pem').stdout)
        verified_reports.append(checked)
        assert checked['c2pa_trusted'] and checked['original_pdf_checked'] and checked['workproof']['valid']
        assert checked['workproof']['scope']==('selective' if scope=='selected' else 'full')
        assert not any(checked[k] for k in ['network_used','identity_verified','creation_time_verified','revocation_checked'])
        run(tool,'verify',signed,root/'wrong.pem',ok=False)
        embed(signed,root/(scope+'.wproof'),root/'nested.pdf',ok=False);assert not (root/'nested.pdf').exists()
        changed=root/'changed.pdf';changed.write_bytes(signed.read_bytes().replace(b'Hello PDF',b'Other PDF'))
        run(tool,'verify',changed,root/'ca.pem',ok=False)
        extra=root/'extra.pdf';extra.write_bytes(signed.read_bytes()+b'\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n')
        run(tool,'verify',extra,root/'ca.pem',ok=False)
    wrong=root/'wrong-source.pdf';wrong.write_bytes(original.replace(b'Hello PDF',b'Other PDF'))
    embed(wrong,root/'full.wproof',root/'wrong-proof.pdf',ok=False);assert not (root/'wrong-proof.pdf').exists()
    encrypted=root/'encrypted.pdf'
    writer=PdfWriter();writer.add_blank_page(width=300,height=300);writer.encrypt('synthetic-ci-password')
    with encrypted.open('wb') as out:writer.write(out)
    assert PdfReader(encrypted).is_encrypted
    run(fixture,encrypted,root)
    embed(encrypted,root/'full.wproof',root/'encrypted-out.pdf',ok=False);assert not (root/'encrypted-out.pdf').exists()
    print('PASS PDF full/selective real signatures, explicit CA and wrong CA, exact original prefix, existing attachments, tampering/revisions, wrong proof, preexisting C2PA and encrypted refusal')
    # Export only actual CLI results, and only after every negative probe passed.
    for path,reports in [(args.desktop_report,verified_reports),(args.desktop_embed_report,embedded_reports)]:
        if path:
            path.write_text(json.dumps(reports,ensure_ascii=False),encoding='utf-8')
