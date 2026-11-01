"""Bounded local text extraction. Never executes Office, relationships or macros."""
import hashlib,io,pathlib,zipfile,xml.etree.ElementTree as ET
NAMESPACES={'http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main'}
def preflight_zip(data):
    # Bound actual central-directory entries before ZipFile allocates ZipInfo objects.
    end=data.rfind(b'PK\x05\x06',max(0,len(data)-65557))
    if end<0 or end+22>len(data):raise ValueError('INVALID_ZIP_END')
    number=lambda start,width:int.from_bytes(data[end+start:end+start+width],'little')
    if end+22+number(20,2)!=len(data) or number(4,2) or number(6,2):raise ValueError('UNSUPPORTED_ZIP_END')
    count,size,offset=number(10,2),number(12,4),number(16,4)
    if count>4096 or number(8,2)!=count or size>4*1024*1024 or offset+size>end:raise ValueError('EXCESS_ZIP_DIRECTORY')
    position=offset;actual=0
    while position<offset+size:
        if position+46>offset+size or data[position:position+4]!=b'PK\x01\x02':raise ValueError('INVALID_ZIP_DIRECTORY')
        extra=sum(int.from_bytes(data[position+i:position+i+2],'little') for i in (28,30,32))
        position+=46+extra;actual+=1
        if actual>4096 or position>offset+size:raise ValueError('EXCESS_ZIP_DIRECTORY')
    if actual!=count:raise ValueError('ZIP_ENTRY_COUNT_MISMATCH')
def extract(path):
    path=pathlib.Path(path)
    with path.open('rb') as stream:
        if not stream.seekable():raise ValueError('REGULAR_FILE_REQUIRED')
        data=stream.read(64*1024*1024+1)
    if len(data)>64*1024*1024:raise ValueError('DOCUMENT_TOO_LARGE')
    suffix=path.suffix.lower()
    if suffix in {'.txt','.md'}:
        if len(data)>32768:raise ValueError('TEXT_TOO_LARGE')
        text=data.decode('utf-8-sig');scope='utf8-plain-text'
    elif suffix=='.docx':
        preflight_zip(data)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries=archive.infolist();names=[e.filename for e in entries]
            if len(entries)>4096 or len(set(names))!=len(names):raise ValueError('EXCESS_OR_DUPLICATE_ZIP_ENTRIES')
            if any(e.flag_bits&1 or e.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED) for e in entries):raise ValueError('UNSUPPORTED_ZIP_ENCODING')
            if sum(e.file_size for e in entries)>128*1024*1024:raise ValueError('EXCESS_DECLARED_EXPANSION')
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names:raise ValueError('DOCX_PARTS_MISSING')
            if any('vbaproject' in n.lower() for n in names):raise ValueError('MACRO_PACKAGE_NOT_SUPPORTED')
            member=archive.getinfo('word/document.xml')
            if member.file_size>4*1024*1024 or member.file_size>max(1,member.compress_size)*200:raise ValueError('EXCESS_XML_EXPANSION')
            with archive.open(member) as part:xml=part.read(4*1024*1024+1)
            if len(xml)>4*1024*1024:raise ValueError('XML_TOO_LARGE')
        decoded=xml.decode('utf-8-sig')
        if '\x00' in decoded or '<!DOCTYPE' in decoded.upper() or '<!ENTITY' in decoded.upper():raise ValueError('DTD_OR_NON_UTF8_XML_NOT_SUPPORTED')
        pieces=[];depth=0;nodes=0;root_checked=False
        for event,element in ET.iterparse(io.StringIO(decoded),events=('start','end')):
            if event=='start':
                depth+=1;nodes+=1
                if depth>128 or nodes>100000:raise ValueError('EXCESS_XML_STRUCTURE')
                if not root_checked:
                    if element.tag not in {f'{{{ns}}}document' for ns in NAMESPACES}:raise ValueError('UNSUPPORTED_WORD_XML')
                    root_checked=True
            else:
                if element.tag in {f'{{{ns}}}t' for ns in NAMESPACES}:pieces.append(element.text or '')
                elif element.tag in {f'{{{ns}}}{tag}' for ns in NAMESPACES for tag in ('p','br','cr')}:pieces.append('\n')
                elif element.tag in {f'{{{ns}}}tab' for ns in NAMESPACES}:pieces.append('\t')
                depth-=1;element.clear()
        text=''.join(pieces);scope='docx-main-part-w:t-source-text-not-rendered'
    else:raise ValueError('SUPPORTED_FORMATS_DOCX_TXT_MD_ONLY')
    if len(text.encode('utf-8'))>32768:raise ValueError('EXTRACTED_TEXT_TOO_LARGE_NO_TRUNCATION')
    return text,{'artifact_hash':hashlib.sha256(data).hexdigest(),'artifact_hash_algorithm':'sha256','artifact_bytes':len(data),'extraction_scope':scope,'extraction_limitations':['No Office rendering, OCR, headers, footnotes or comments. Source XML text may include hidden/revision content; scores do not describe the rendered document.']}
