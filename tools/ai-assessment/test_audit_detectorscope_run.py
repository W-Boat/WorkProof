import copy
import hashlib
import io
import os
import unittest
import urllib.error
from unittest import mock
import audit_detectorscope_run as audit

def valid_run():
    return {'repository':{'full_name':audit.REPOSITORY},'head_repository':{'full_name':audit.REPOSITORY},
            'name':'Independent DetectorScope bilingual calibration and heldout evaluation','event':'push',
            'head_branch':'codex/workproof-mvp','status':'completed','conclusion':'success','head_sha':'a'*40}

class ProvenanceTests(unittest.TestCase):
    def test_only_completed_expected_workflow_and_repository_are_accepted(self):
        audit.validate_run(valid_run())
        for field,value in [('status','in_progress'),('conclusion','failure'),('event','pull_request'),
                            ('head_branch','unreviewed'),('name','different workflow'),('head_sha','short')]:
            run=valid_run();run[field]=value
            with self.assertRaises(AssertionError):audit.validate_run(run)
        for key in ('repository','head_repository'):
            run=valid_run();run[key]={'full_name':'someone/fork'}
            with self.assertRaises(AssertionError):audit.validate_run(run)

    def transfer(self,expected_size,expected_digest):
        body=b'synthetic artifact bytes'
        opener=mock.Mock()
        opener.open.side_effect=urllib.error.HTTPError('https://api.github.com/',302,'redirect',{'Location':'https://delivery.example.test/file'},None)
        downloaded=[]
        def download(request,**kwargs):
            self.assertIsInstance(request,str)  # Fresh URL, no authenticated API Request reused.
            self.assertEqual(request,'https://delivery.example.test/file')
            downloaded.append(request)
            return io.BytesIO(body)
        with mock.patch.dict(os.environ,{'GITHUB_TOKEN':'synthetic-test-token'}), mock.patch.object(audit.urllib.request,'build_opener',return_value=opener), mock.patch.object(audit.urllib.request,'urlopen',side_effect=download):
            result=audit.artifact_bytes(123,expected_size,expected_digest)
        api_request=opener.open.call_args.args[0]
        self.assertEqual(api_request.get_header('Authorization'),'Bearer synthetic-test-token')
        self.assertEqual(len(downloaded),1)
        return result

    def test_artifact_digest_size_and_credential_separation(self):
        body=b'synthetic artifact bytes';digest='sha256:'+hashlib.sha256(body).hexdigest()
        self.assertEqual(self.transfer(len(body),digest),body)
        with self.assertRaises(AssertionError):self.transfer(len(body)+1,digest)
        with self.assertRaises(AssertionError):self.transfer(len(body),'sha256:'+'0'*64)

if __name__=='__main__':unittest.main()
