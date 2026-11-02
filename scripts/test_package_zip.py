"""CI regression checks for archived dependency evidence."""
import contextlib
import hashlib
import io
import os
import pathlib
import tempfile
import unittest
import zipfile

from verify_package_zip import verify

class PackageEvidenceTests(unittest.TestCase):
    def archive(self, files, manifest):
        path = pathlib.Path(self.directory.name) / 'package.zip'
        with zipfile.ZipFile(path, 'w') as package:
            for name, content in files.items():
                package.writestr(name, content)
            package.writestr('SHA256SUMS.txt', manifest)
        return path

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.notice = 'c2pa/third-party/sample/.upstream/LICENSE'
        self.content = b'Upstream copyright\r\nPermission text\r\n'
        self.manifest = hashlib.sha256(self.content).hexdigest() + '  ' + self.notice + '\n'

    def test_hidden_notice_is_checked_byte_for_byte(self):
        with contextlib.redirect_stdout(io.StringIO()):
            verify(self.archive({self.notice: self.content}, self.manifest))

    def test_missing_or_normalized_notice_is_rejected(self):
        for files in ({}, {self.notice: self.content.replace(b'\r\n', b'\n')}):
            with self.assertRaises(ValueError):
                verify(self.archive(files, self.manifest))

    def test_unlisted_or_unsafe_member_is_rejected(self):
        for name in ('unlisted.txt', '../escape.txt', '/absolute.txt', 'folder\\ambiguous.txt'):
            with self.assertRaises(ValueError):
                verify(self.archive({self.notice: self.content, name: b'extra'}, self.manifest))

    def test_duplicate_manifest_entry_is_rejected(self):
        with self.assertRaises(ValueError):
            verify(self.archive({self.notice: self.content}, self.manifest * 2))

    def test_unsafe_paths_are_rejected_even_when_listed_and_hashed(self):
        for name in ('../escape.txt', '/absolute.txt', 'C:/absolute.txt', 'folder\\ambiguous.txt'):
            manifest = hashlib.sha256(self.content).hexdigest() + '  ' + name + '\n'
            with self.assertRaisesRegex(ValueError, 'Unsafe archive member'):
                verify(self.archive({name: self.content}, manifest))

if __name__ == '__main__':
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('Run package tests in GitHub Actions only.')
    unittest.main()
