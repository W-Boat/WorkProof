import hashlib
import json
import pathlib
import tempfile
import unittest
import observed_samples as observed

class ObservedSamplesTests(unittest.TestCase):
    def test_all_outcomes_are_excluded_and_reports_cannot_silently_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            rows = [{'input_hash':'a'*64,'status':'completed','score':0.9},
                    {'input_hash':'b'*64,'status':'unsupported'}]
            (root/'first.json').write_text(json.dumps({'samples':rows}))
            (root/'second.json').write_text(json.dumps([rows[0]]))
            reports = [{'path':name,'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest(),'samples':count}
                       for name,count in [('first.json',2),('second.json',1)]]
            index = {'protocol':'workproof-observed-sample-index/1','reports':reports}
            hashes, receipts = observed.load_exclusions(root,index)
            self.assertEqual(hashes, {'a'*64,'b'*64});self.assertEqual(len(receipts),2)
            (root/'first.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'REPORT_CHANGED'): observed.load_exclusions(root,index)

    def test_invalid_counts_hashes_and_paths_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory);path = root/'report.json'
            for rows,count,error in [([{'input_hash':'bad'}],1,'HASH_INVALID'),([{'input_hash':'a'*64}],2,'COUNT_INVALID')]:
                path.write_text(json.dumps(rows))
                entry = {'path':'report.json','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'samples':count}
                index = {'protocol':'workproof-observed-sample-index/1','reports':[entry]}
                with self.assertRaisesRegex(ValueError,error): observed.load_exclusions(root,index)
            entry['path'] = '../outside.json'
            with self.assertRaisesRegex(ValueError,'PATH_INVALID'): observed.load_exclusions(root,index)

if __name__ == '__main__': unittest.main()
