"""CI-only extraction and hostile OOXML boundaries."""
import hashlib,os,pathlib,tempfile,unittest,warnings,zipfile
from documents import extract
assert os.environ.get('GITHUB_ACTIONS')=='true'
NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
class Documents(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def package(self,xml,duplicate=False):
        path=self.root/'sample.docx'
        with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');z.writestr('word/document.xml',xml)
            if duplicate:
                with warnings.catch_warnings():warnings.simplefilter('ignore');z.writestr('word/document.xml',xml)
        return path
    def test_main_text_and_exact_artifact_hash(self):
        path=self.package(f'<w:document xmlns:w="{NS}"><w:body><w:p><w:r><w:t>Hello</w:t><w:tab/><w:t>世界</w:t></w:r></w:p></w:body></w:document>')
        before=path.read_bytes();text,report=extract(path);self.assertEqual(text,'Hello\t世界\n');self.assertEqual(report['artifact_hash'],hashlib.sha256(before).hexdigest());self.assertEqual(path.read_bytes(),before)
    def test_duplicate_dtd_and_non_utf8_rejected(self):
        simple=f'<w:document xmlns:w="{NS}"/>'
        for xml,duplicate in [(simple,True),('<!DOCTYPE x [<!ENTITY x "explosive">]>'+simple,False),(simple.encode('utf-16'),False)]:
            with self.subTest(duplicate=duplicate),self.assertRaises(ValueError):extract(self.package(xml,duplicate))
    def test_compression_bomb_rejected_before_parse(self):
        with self.assertRaises(ValueError):extract(self.package('A'*1000000))
    def test_forged_central_directory_count(self):
        path=self.package(f'<w:document xmlns:w="{NS}"/>');data=bytearray(path.read_bytes());end=data.rfind(b'PK\x05\x06');data[end+8:end+12]=b'\x01\x00\x01\x00';path.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'ZIP_ENTRY_COUNT_MISMATCH'):extract(path)
    def test_plain_utf8_and_unsupported_format(self):
        path=self.root/'plain.txt';path.write_text('你好，世界',encoding='utf-8');self.assertEqual(extract(path)[0],'你好，世界')
        path=self.root/'old.doc';path.write_bytes(b'unsupported')
        with self.assertRaises(ValueError):extract(path)
if __name__=='__main__':unittest.main()
