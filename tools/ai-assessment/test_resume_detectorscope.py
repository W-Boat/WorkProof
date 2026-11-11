import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import resume_detectorscope as resume


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.environment = patch.dict(os.environ, GITHUB_SHA='f' * 40, GITHUB_RUN_ID='123')
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.checkpoint = self.root / 'checkpoint'
        self.checkpoint.mkdir()
        resume.write(self.checkpoint / 'frozen-policy.json', {'threshold': 1})
        self.manifest = [{'id': str(i), 'input_hash': str(i) * 64, 'language': 'zh',
                          'truth': 'human' if i < 3 else 'ai', 'domain': 'news', 'generator': 'fixture'}
                         for i in range(6)]
        self.frozen = {'manifests': {'heldout-zh': self.manifest}}

    def write_shard(self, shard, rows=None, **overrides):
        folder = self.root / f'detectorscope-heldout-zh-{shard}'
        folder.mkdir()
        conversion = folder / resume.CONVERSION_FILE
        resume.write(conversion, {})
        rows = self.manifest[shard::resume.SHARDS] if rows is None else rows
        result = {**resume.binding('zh', shard, self.checkpoint, conversion),
                  'peak_rss_kib': 8, 'samples': [dict(row, status='completed', input_tokens=128,
                                                    score=.5, elapsed_seconds=1) for row in rows]}
        result.update(overrides)
        resume.write(folder / 'heldout-shard.json', result)

    def merge(self):
        with patch.object(resume, 'audit_conversion'):
            return resume.merge_shards(self.root, 'zh', self.checkpoint, self.frozen)

    def test_complete_shards_restore_frozen_manifest_order(self):
        self.write_shard(0, list(reversed(self.manifest[::2])))
        self.write_shard(1)
        rows, peak, provenance = self.merge()
        self.assertEqual([r['id'] for r in rows], [r['id'] for r in self.manifest])
        self.assertEqual(peak, 8)
        self.assertEqual([p['shard'] for p in provenance], [0, 1])

    def test_wrong_policy_refused(self):
        self.write_shard(0, policy_sha256='wrong')
        with self.assertRaisesRegex(ValueError, 'HELDOUT_SHARD_PROVENANCE'):
            self.merge()

    def test_duplicate_samples_refused(self):
        self.write_shard(0)
        self.write_shard(1, self.manifest[::2])
        with self.assertRaisesRegex(ValueError, 'REPORT_SAMPLE_ID'):
            self.merge()

    def test_missing_shard_refused(self):
        self.write_shard(0)
        with self.assertRaises(FileNotFoundError):
            self.merge()


if __name__ == '__main__':
    unittest.main()
