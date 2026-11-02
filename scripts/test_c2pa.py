"""Real, offline C2PA PNG/JPEG round trips with synthetic image, process records and CA."""
import argparse
import io
from PIL import Image
import hashlib, json, os, pathlib, shutil, struct, subprocess, sys, tempfile, zlib
assert os.environ.get('GITHUB_ACTIONS') == 'true'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('tool')
parser.add_argument('fixture')
parser.add_argument('--desktop-report',help='Write actual successful CLI reports for desktop compatibility tests.')
parser.add_argument('--desktop-embed-report',help='Write actual CLI embedding reports, which do not establish CA trust.')
parser.add_argument('--public-fixtures-out',help='Export only synthetic public validation files for manual UI acceptance; never private keys.')
parser.add_argument('--trust-probe',help='Optional CI-only SDK trust-chain diagnostic executable for synthetic public certificates.')
parser.add_argument('--without-network-trace',action='store_true',help='Explicitly skip syscall tracing on platforms without strace; report this as unmeasured.')
options=parser.parse_args()
tool, fixture = map(lambda p: str(pathlib.Path(p).resolve()), (options.tool,options.fixture))
trace_enabled=not options.without_network_trace
if trace_enabled:
    assert shutil.which('strace'), 'strace is required by default; unsupported platforms must explicitly select --without-network-trace'
traces_performed=0
desktop_reports=[]
desktop_embed_reports=[]
openssl = shutil.which('openssl')
assert openssl
def run(*args, ok=True):
    result = subprocess.run(list(map(str,args)),capture_output=True,timeout=60)
    assert (result.returncode == 0) == ok, result.stderr.decode(errors='replace')[:800]
    return result
def verify_network_trace(signed,root_ca,trace):
    global traces_performed
    if not trace_enabled:
        return
    run('strace','-f','-e','trace=network','-o',trace,tool,'verify',signed,root_ca)
    calls=trace.read_text()
    assert 'connect(' not in calls and 'sendto(' not in calls
    traces_performed+=1

def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
def png(pixel):
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'+pixel))+chunk(b'IEND',b'')
with tempfile.TemporaryDirectory(prefix='workproof-c2pa-ci-') as name:
    root=pathlib.Path(name);original=root/'original.png';original.write_bytes(png(b'\x14\x99\x88\xff'))
    snapshot=original.read_bytes();run(fixture,original,root)
    proof_snapshot=(root/'full.wproof').read_bytes()
    print('Synthetic certificate provider:',run(openssl,'version').stdout.decode(errors='replace').strip(),flush=True)
    # OpenSSL 1.1 may load v3_ca from the runner's default openssl.cnf and
    # append -addext values, producing duplicate Basic Constraints. Such a CA
    # is correctly rejected. Own the complete fixture config instead of
    # inheriting machine extensions or relaxing either verifier.
    request_config=root/'request.cnf'
    request_config.write_text('[req]\ndistinguished_name=dn\nprompt=no\ndefault_md=sha256\n[dn]\nCN=WorkProof synthetic CI\n[root_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n',encoding='ascii')
    run(openssl,'req','-config',request_config,'-extensions','root_ca','-x509','-sha256','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/'ca.key','-out',root/'ca.pem','-days','2','-subj','/CN=WorkProof synthetic C2PA CA')
    run(openssl,'req','-config',request_config,'-new','-sha256','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/'signer.key','-out',root/'signer.csr','-subj','/CN=WorkProof synthetic C2PA signer')
    (root/'ext.cnf').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    run(openssl,'x509','-req','-sha256','-in',root/'signer.csr','-CA',root/'ca.pem','-CAkey',root/'ca.key','-CAcreateserial','-out',root/'signer.pem','-days','2','-extfile',root/'ext.cnf')
    # Do not inherit a provider's legacy digest defaults: the SDK trust path
    # accepts ECDSA SHA-256/384/512, not SHA-1. Inspect actual certificates, not
    # just the command line, and retain diagnostics from each native runner.
    for certificate in ['ca.pem','signer.pem']:
        details=run(openssl,'x509','-in',root/certificate,'-noout','-text').stdout.decode(errors='replace')
        algorithms=[line.strip() for line in details.splitlines() if 'Signature Algorithm:' in line]
        print(certificate,algorithms,flush=True)
        print('Synthetic public certificate '+certificate+':\n'+details,flush=True)
        assert algorithms and all(line.split(':',1)[1].strip()=='ecdsa-with-SHA256' for line in algorithms), algorithms
        assert details.count('X509v3 Basic Constraints:')==1, 'Duplicate or missing Basic Constraints: '+certificate
        assert details.count('X509v3 Key Usage:')==1, 'Duplicate or missing Key Usage: '+certificate
        assert details.count('X509v3 Subject Key Identifier:')==1, 'Duplicate or missing SKI: '+certificate
        assert details.count('X509v3 Authority Key Identifier:')==1, 'Duplicate or missing AKI: '+certificate
    independent_chain=subprocess.run([openssl,'verify','-CAfile',str(root/'ca.pem'),str(root/'signer.pem')],capture_output=True,timeout=60)
    print('OpenSSL synthetic chain verification:',independent_chain.returncode,
          independent_chain.stdout.decode(errors='replace'),independent_chain.stderr.decode(errors='replace'),flush=True)
    if options.trust_probe:
        for source,destination in [('ca.pem','ca.der'),('signer.pem','signer.der')]:
            run(openssl,'x509','-in',root/source,'-outform','DER','-out',root/destination)
        diagnostic=run(str(pathlib.Path(options.trust_probe).resolve()),root/'ca.pem',root/'ca.der',root/'signer.der')
        print('SDK synthetic certificate trust probes:\n'+diagnostic.stdout.decode(errors='replace'),flush=True)
        if diagnostic.stderr:print(diagnostic.stderr.decode(errors='replace'),flush=True)
    assert independent_chain.returncode==0, 'Synthetic fixture chain was rejected by its own explicit root CA'
    (root/'chain.pem').write_bytes((root/'signer.pem').read_bytes()+(root/'ca.pem').read_bytes())
    signed=root/'signed.png'
    def embed(proof='full.wproof',destination=signed,source=original,consent=True,ok=True):
        args=[tool,'embed',source,root/proof,root/'chain.pem',root/'signer.key',destination]
        if consent: args.append('--allow-public-process')
        return run(*args,ok=ok)
    embed(consent=False,ok=False);assert not signed.exists()
    packaged=json.loads(embed().stdout);assert packaged['original_png_checked'] and not packaged['c2pa_trusted']
    desktop_embed_reports.append(packaged)
    report=json.loads(run(tool,'verify',signed,root/'ca.pem').stdout)
    desktop_reports.append(report)
    assert report['c2pa_integrity_valid'] and report['c2pa_trusted'] and report['original_png_checked'] and report['workproof']['valid'] and report['workproof']['scope']=='full'
    assert not any(report[k] for k in ['identity_verified','creation_time_verified','revocation_checked','network_used'])
    signed_snapshot=signed.read_bytes();embed(ok=False);assert signed.read_bytes()==signed_snapshot
    embed(source=signed,destination=root/'nested.png',ok=False);assert not (root/'nested.png').exists()
    # Independent wrong trust anchor; does not depend on any other workflow's fixture.
    run(openssl,'req','-config',request_config,'-extensions','root_ca','-x509','-sha256','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',root/'wrong.key','-out',root/'wrong.pem','-days','2','-subj','/CN=Wrong synthetic CA')
    # The negative anchor is independently valid, rather than malformed: only
    # its identity and key differ from the deliberately trusted fixture root.
    run(openssl,'verify','-CAfile',root/'wrong.pem',root/'wrong.pem')
    run(tool,'verify',signed,root/'wrong.pem',ok=False)
    # Change actual image pixels while retaining structurally valid chunks and valid CRCs.
    data=signed_snapshot;pos=8;changed=data[:8];assertion_changed=data[:8];found=False
    while pos<len(data):
        length=int.from_bytes(data[pos:pos+4],'big');kind=data[pos+4:pos+8];body=data[pos+8:pos+8+length]
        changed+=chunk(kind,zlib.compress(b'\0\xff\0\0\xff') if kind==b'IDAT' else body)
        altered=body
        if kind==b'caBX' and b'png-remove-cabx-v1' in body:
            altered=body.replace(b'png-remove-cabx-v1',b'png-remove-cabx-v0',1);found=True
        assertion_changed+=chunk(kind,altered);pos+=12+length
    assert found, 'Expected uncompressed custom assertion in the actual C2PA chunk'
    (root/'changed.png').write_bytes(changed);run(tool,'verify',root/'changed.png',root/'ca.pem',ok=False)
    (root/'assertion-changed.png').write_bytes(assertion_changed);run(tool,'verify',root/'assertion-changed.png',root/'ca.pem',ok=False)
    proof=json.loads(proof_snapshot);proof['records'][1]['event']['elapsed_ms']+=1
    (root/'bad.wproof').write_text(json.dumps(proof));embed(proof='bad.wproof',destination=root/'bad.png',ok=False);assert not (root/'bad.png').exists()
    selected=root/'selected.png';desktop_embed_reports.append(json.loads(embed(proof='selected.wproof',destination=selected).stdout))
    partial=json.loads(run(tool,'verify',selected,root/'ca.pem').stdout)
    desktop_reports.append(partial)
    # The protocol always includes start/save boundary records, plus the selected edit.
    assert partial['workproof']['scope']=='selective' and partial['workproof']['disclosed_events']==3 and partial['workproof']['total_events']==5, partial['workproof']
    # Runtime evidence for offline verification, in addition to disabled HTTP features.
    verify_network_trace(signed,root/'ca.pem',root/'network.trace')
    assert original.read_bytes()==snapshot and (root/'full.wproof').read_bytes()==proof_snapshot

    def app(marker, body):
        assert len(body) <= 65533
        return b'\xff'+bytes([marker])+struct.pack('>H',len(body)+2)+body

    def header_segments(data):
        assert data[:2] == b'\xff\xd8'
        pos=2
        while pos<len(data):
            assert data[pos]==255
            begin=pos
            while data[pos]==255:pos+=1
            marker=data[pos];pos+=1
            if marker==0xda:return  # Entropy is opaque; do not misread stuffed FF00 or restart markers.
            assert marker not in (0,0xd8,0xd9)
            length=int.from_bytes(data[pos:pos+2],'big');assert length>=2
            end=pos+length;assert end<=len(data)
            yield marker,begin,end,data[pos+2:end]
            pos=end

    jpeg_results=[]
    for progressive in (False,True):
        folder=root/('progressive' if progressive else 'baseline');folder.mkdir()
        source=folder/'original.jpg';destination=folder/'signed.jpg'
        pixels=Image.new('RGB',(24,16));pixels.putdata([(x*9%256,y*13%256,(x+y)*7%256) for y in range(16) for x in range(24)])
        buffer=io.BytesIO();pixels.save(buffer,format='JPEG',quality=91,progressive=progressive)
        # Keep unrelated APP11, EXIF and XMP outside the C2PA store; all must survive byte-for-byte.
        metadata=[app(0xeb,b'WorkProof-unrelated-APP11-keep'),
                  app(0xe1,b'Exif\0\0II*\0\x08\0\0\0\0\0\0\0\0\0'),
                  app(0xe1,b'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/">fixture</x:xmpmeta>')]
        original_jpeg=buffer.getvalue()[:2]+b''.join(metadata)+buffer.getvalue()[2:]
        source.write_bytes(original_jpeg)
        with Image.open(source) as decoded: decoded.load();assert decoded.size==(24,16)
        # A larger genuine process proof exercises JPEG C2PA APP11 packet segmentation.
        run(fixture,source,folder,1500)
        proof_bytes=(folder/'full.wproof').read_bytes()
        args=[tool,'embed',source,folder/'full.wproof',root/'chain.pem',root/'signer.key',destination,'--allow-public-process']
        embedded=json.loads(run(*args).stdout)
        desktop_embed_reports.append(embedded)
        assert embedded['original_jpeg_checked'] and embedded['original_asset_checked']
        assert not embedded['original_png_checked'] and embedded['media_type']=='image/jpeg'
        signed_bytes=destination.read_bytes()
        for segment in metadata:assert signed_bytes.count(segment)==1,'JPEG metadata was lost or rewritten'
        with Image.open(destination) as decoded:decoded.load();assert decoded.size==(24,16)
        checked=json.loads(run(tool,'verify',destination,root/'ca.pem').stdout)
        desktop_reports.append(checked)
        assert checked['original_jpeg_checked'] and checked['original_asset_checked'] and checked['c2pa_trusted']
        assert checked['workproof']['valid'] and checked['workproof']['scope']=='full'
        assert not any(checked[k] for k in ['identity_verified','creation_time_verified','revocation_checked','network_used'])
        packets=[s for s in header_segments(signed_bytes) if s[0]==0xeb and s[3].startswith(b'JP')]
        assert len(packets)>1,'Large proof did not produce segmented APP11 C2PA store'
        # Tamper pixels through valid JPEG quantization data, keeping framing structurally valid.
        quant=next(s for s in header_segments(signed_bytes) if s[0]==0xdb)
        changed=bytearray(signed_bytes);index=quant[1]+5;changed[index]=changed[index]^1 or 2
        image_tamper=folder/'image-changed.jpg';image_tamper.write_bytes(changed)
        with Image.open(image_tamper) as decoded:decoded.load()
        run(tool,'verify',image_tamper,root/'ca.pem',ok=False)
        metadata_tamper=folder/'metadata-changed.jpg'
        metadata_tamper.write_bytes(signed_bytes.replace(b'WorkProof-unrelated-APP11-keep',b'WorkProof-unrelated-APP11-fake',1))
        run(tool,'verify',metadata_tamper,root/'ca.pem',ok=False)
        # Existing embedded C2PA cannot be wrapped again, even when a new proof binds its bytes.
        nested=folder/'nested';nested.mkdir();run(fixture,destination,nested)
        nested_output=nested/'nested.jpg'
        run(tool,'embed',destination,nested/'full.wproof',root/'chain.pem',root/'signer.key',nested_output,'--allow-public-process',ok=False)
        assert not nested_output.exists()
        partial_output=folder/'selected.jpg'
        desktop_embed_reports.append(json.loads(run(tool,'embed',source,folder/'selected.wproof',root/'chain.pem',root/'signer.key',partial_output,'--allow-public-process').stdout))
        partial_report=json.loads(run(tool,'verify',partial_output,root/'ca.pem').stdout)
        desktop_reports.append(partial_report)
        assert partial_report['workproof']['scope']=='selective' and partial_report['workproof']['disclosed_events']==3 and partial_report['workproof']['total_events']==1500
        run(tool,'verify',destination,root/'wrong.pem',ok=False)
        verify_network_trace(destination,root/'ca.pem',folder/'network.trace')

        assert source.read_bytes()==original_jpeg and (folder/'full.wproof').read_bytes()==proof_bytes
        jpeg_results.append({'progressive':progressive,'segmented_app11_packets':len(packets),'metadata_preserved':True,'full_and_selective':True})

    if options.public_fixtures_out:
        export=pathlib.Path(options.public_fixtures_out)
        export.mkdir(parents=True,exist_ok=False)
        # An explicit allowlist prevents accidentally publishing signing keys,
        # CSRs or temporary files when the fixture gains additional materials.
        for source,name in [(signed,'full.png'),(selected,'selected.png'),(original,'unsigned.png'),
                            (root/'ca.pem','synthetic-ca.pem'),(root/'wrong.pem','wrong-ca.pem'),
                            (root/'baseline/signed.jpg','baseline.jpg'),(root/'progressive/signed.jpg','progressive.jpg')]:
            (export/name).write_bytes(source.read_bytes())
        (export/'README.txt').write_text('SYNTHETIC CI VALIDATION ONLY\nNot real authorship, identity or public C2PA accreditation.\nThe synthetic CA expires after two days. All private keys are discarded.\nfull.png/baseline.jpg/progressive.jpg should pass using synthetic-ca.pem; selected.png discloses only three records.\nwrong-ca.pem must be rejected; unsigned.png has no embedded certificate.\nThese files are for manual UI acceptance, not real delivery.\n',encoding='utf-8')
        (export/'VALIDATION.json').write_text(json.dumps({
            'purpose':'synthetic public manual UI acceptance fixtures only',
            'source_commit':os.environ.get('GITHUB_SHA'),
            'build_run':os.environ.get('GITHUB_RUN_ID'),
            'private_keys_included':False,
            'synthetic_ca_lifetime_days':2,
            'expected':{
                'full.png':'full success with synthetic-ca.pem',
                'selected.png':'selective success; 3 disclosed of 5 total',
                'baseline.jpg':'full success with synthetic-ca.pem',
                'progressive.jpg':'full success with synthetic-ca.pem',
                'unsigned.png':'reject missing embedded manifest',
                'wrong-ca.pem':'reject trust for every signed image'
            }
        },indent=2),encoding='utf-8')
        (export/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(export.iterdir()) if p.is_file()),encoding='utf-8')

pathlib.Path('test-c2pa-results.json').write_text(json.dumps({'real_c2pa_png':True,'real_c2pa_jpeg':jpeg_results,'explicit_ca':True,'full_and_selective':True,'tamper_rejected':True,'original_bytes_unchanged':True,'verification_network_calls':False if traces_performed else None,'network_trace_performed':bool(traces_performed),'network_traces':traces_performed,'synthetic_authority_only':True},indent=2))
assert traces_performed == (3 if trace_enabled else 0)
if options.desktop_report:
    pathlib.Path(options.desktop_report).write_text(json.dumps(desktop_reports,indent=2),encoding='utf-8')
if options.desktop_embed_report:
    assert len(desktop_embed_reports)==6
    assert all(report['c2pa_trusted'] is False and report['trust_policy']=='not-verified' for report in desktop_embed_reports)
    pathlib.Path(options.desktop_embed_report).write_text(json.dumps(desktop_embed_reports,indent=2),encoding='utf-8')
print('PASS: real C2PA PNG and baseline/progressive JPEG packaging, exact original-byte binding, explicit CA trust, full/partial scope, tamper/wrong-root/overwrite rejection and verification; network syscall trace: '+('measured' if traces_performed else 'not performed'))
