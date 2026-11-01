"""Isolated notice collection boundaries; run in Actions, never import real packages."""
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import collect_notices as collector


class NoticeCollectionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.installed = self.root / 'site-packages'
        self.installed.mkdir()
        self.output = self.root / 'notices'

    def distribution(self, files, name='fixture'):
        return SimpleNamespace(metadata={'Name': name}, version='1.2.3', files=files,
                               locate_file=lambda _: self.installed)

    def file(self, name, data):
        path = self.installed / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def collect(self, distributions):
        with patch.object(collector, 'roots', return_value=(self.installed,)), \
                patch.object(collector.importlib.metadata, 'distributions', return_value=distributions):
            collector.collect(self.output)
        raw = (self.output / 'manifest.json').read_text(encoding='utf-8')
        self.assertNotIn(str(self.root), raw)
        self.assertNotIn(self.root.as_posix(), raw)
        return json.loads(raw)

    def test_original_bytes_and_missing_notices_remain_visible(self):
        original = b'Copyright Fixture\r\nLicense\x00raw\xff\n'
        self.file('fixture-1.2.3.dist-info/licenses/vendor.txt', original)
        manifest = self.collect([
            self.distribution(['fixture-1.2.3.dist-info/licenses/vendor.txt']),
            self.distribution(['other/code.py'], 'no-license'),
            self.distribution(None, 'no-record'),
        ])
        recorded = manifest['packages'][0]['files'][0]
        self.assertEqual((self.output / recorded['archive']).read_bytes(), original)
        self.assertEqual(recorded['sha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(recorded['source'], 'fixture-1.2.3.dist-info/licenses/vendor.txt')
        self.assertFalse(manifest['commercial_clearance'])
        self.assertEqual(manifest['packages'][1]['issues'][0]['reason'], 'NO_NOTICE_FILES_IN_DISTRIBUTION_RECORD')
        self.assertEqual(manifest['packages'][2]['issues'][0]['reason'], 'DISTRIBUTION_FILE_LIST_MISSING')
        before = (self.output / 'manifest.json').read_bytes()
        with patch.object(collector, 'roots', return_value=(self.installed,)):
            with self.assertRaises(FileExistsError):
                collector.collect(self.output)
        self.assertEqual((self.output / 'manifest.json').read_bytes(), before)

    def test_traversal_absolute_and_unreadable_notices_are_not_copied(self):
        outside = self.root / 'LICENSE.secret'
        outside.write_text('must never archive this', encoding='utf-8')
        manifest = self.collect([self.distribution(['../LICENSE.secret', str(outside), 'missing/LICENSE'])])
        package = manifest['packages'][0]
        self.assertEqual(package['files'], [])
        self.assertEqual([item['reason'] for item in package['issues']],
                         ['OUTSIDE_DISTRIBUTION_ROOT', 'OUTSIDE_DISTRIBUTION_ROOT', 'SOURCE_UNREADABLE'])
        self.assertNotIn('must never archive this', json.dumps(manifest))

    def test_symbolic_link_is_not_followed(self):
        outside = self.root / 'private.txt'
        outside.write_bytes(b'do not copy')
        try:
            (self.installed / 'LICENSE').symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest('Host does not permit symlinks; Linux Actions must exercise this fixture')
        manifest = self.collect([self.distribution(['LICENSE'])])
        self.assertEqual(manifest['packages'][0]['files'], [])
        self.assertEqual(manifest['packages'][0]['issues'][0]['reason'], 'SYMLINK_REJECTED')

    def test_file_and_total_limits_are_reported_without_fabricated_notices(self):
        self.file('a/LICENSE', b'abcd')
        self.file('b/NOTICE', b'1234')
        self.file('c/COPYING', b'123456')
        with patch.object(collector, 'MAX_FILE', 5), patch.object(collector, 'MAX_TOTAL', 6):
            manifest = self.collect([self.distribution(['a/LICENSE', 'b/NOTICE', 'c/COPYING'])])
        self.assertEqual(manifest['bytes'], 4)
        self.assertEqual(len(manifest['packages'][0]['files']), 1)
        self.assertEqual([item['reason'] for item in manifest['packages'][0]['issues']],
                         ['TOTAL_SIZE_LIMIT', 'FILE_SIZE_LIMIT'])

    def test_output_inside_installation_tree_is_rejected(self):
        self.output = self.installed / 'notices'
        with patch.object(collector, 'roots', return_value=(self.installed,)):
            with self.assertRaisesRegex(ValueError, 'OUTPUT_MUST_BE_OUTSIDE_SITE_PACKAGES'):
                collector.collect(self.output)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
