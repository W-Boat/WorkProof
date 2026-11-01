"""Metric/protocol fixtures only; never model-quality evidence."""
import copy
import json
import pathlib
import os
import subprocess
import sys
import time
import tempfile
import unittest
import evaluate as ev


class EvaluationTests(unittest.TestCase):
    def sample(self, name, truth='human', kind='human_original'):
        return dict(id=name, truth=truth, kind=kind, language='en', generator='human' if truth=='human' else 'test-model', text='fixture-'+name,
                    source=dict(url='https://example.org/fixture', license='test-fixture-only', record=name))

    def policy(self):
        return dict(engine_id='fixture', model_revision='fixed', threshold=.7, score_label='AI', score_kind='uncalibrated_class_softmax', calibration_dataset_sha256='a'*64, calibration_input_sha256=['b'*64], threshold_source='Independent fixture; not an actual calibration')

    def test_rates_coverage_mixed_and_no_text(self):
        rows=[self.sample('false-positive'),self.sample('unsupported'),self.sample('false-negative','ai','ai_original'),self.sample('mixed','mixed','mixed')]
        def predict(row):
            value=dict(protocol='workproof-ai-assessment/1',engine_id='fixture',model_revision='fixed',input_hash=ev.digest(row['text'].encode()),network_used=False,status='completed',score_kind='uncalibrated_class_softmax',calibration=None,raw_scores={'AI':.8,'Human':.2})
            if row['id']=='unsupported': value['status']='unsupported'
            if row['id']=='false-negative':value['raw_scores']={'AI':.1,'Human':.9}
            return value
        report=ev.evaluate(rows,'d'*64,self.policy(),'e'*64,predict)
        self.assertEqual(report['overall']['coverage'],.75)
        self.assertEqual(report['overall']['false_positive']['rate'],1)
        self.assertEqual(report['overall']['false_positive']['count'],1)
        self.assertEqual(report['overall']['false_negative']['rate'],1)
        self.assertEqual(report['overall']['mixed_excluded_from_binary_metrics'],1)
        self.assertNotIn('fixture-false-positive',json.dumps(report))
        self.assertIsNone(report['groups']['kind']['mixed']['false_positive']['rate'])

    def test_wilson_known_reference(self):
        interval=ev.wilson(0,10)['wilson95']
        self.assertAlmostEqual(interval[1],.2775328,places=6)
        self.assertAlmostEqual(ev.wilson(5,10)['wilson95'][0],.236593,places=5)
        self.assertIsNone(ev.wilson(0,0)['rate'])

    def test_bad_protocol_scores_do_not_become_human(self):
        rows=[self.sample('bad')]
        def bad_score(row):
            return dict(protocol='workproof-ai-assessment/1',engine_id='fixture',model_revision='fixed',input_hash=ev.digest(row['text'].encode()),network_used=False,status='completed',score_kind='uncalibrated_class_softmax',calibration=None,raw_scores={'AI':float('nan'),'Human':.2})
        report=ev.evaluate(rows,'d'*64,self.policy(),'e'*64,bad_score)
        self.assertEqual(report['overall']['statuses'],{'error':1})
        self.assertEqual(report['overall']['scored'],0)
        self.assertIsNone(report['overall']['false_positive']['rate'])

    def test_missing_provenance_duplicate_text_and_wrong_labels_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'data.jsonl'
            sample=self.sample('a')
            bad=copy.deepcopy(sample);del bad['source']
            for rows in ([bad],[sample,dict(sample,id='b')],[dict(sample,kind='mixed')]):
                path.write_text('\n'.join(json.dumps(row) for row in rows),encoding='utf-8')
                with self.assertRaises(ValueError):ev.load_dataset(path)

    def test_policy_is_independent_and_revision_pinned(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'policy.json'
            policy=self.policy();path.write_text(json.dumps(policy),encoding='utf-8')
            registry={'fixture':{'revision':'fixed'}}
            ev.load_policy(path,'b'*64,registry)
            with self.assertRaises(ValueError):ev.load_policy(path,'a'*64,registry)
            with self.assertRaises(ValueError):ev.load_policy(path,'b'*64,{'fixture':{'revision':'other'}})

    def test_exact_calibration_sample_overlap_rejected(self):
        rows=[self.sample('overlap')];policy=self.policy()
        policy['calibration_input_sha256']=[ev.digest(rows[0]['text'].encode())]
        with self.assertRaisesRegex(ValueError,'CALIBRATION_SAMPLE_OVERLAP'):
            ev.evaluate(rows,'d'*64,policy,'e'*64,lambda row:None)

    @unittest.skipUnless(os.name=='posix','POSIX process control only')
    def test_child_output_limit_exit_code_protocol_and_stderr(self):
        command=lambda text:[sys.executable,'-c',text]
        with self.assertRaisesRegex(ValueError,'RESULT_TOO_LARGE'):
            ev.run_detector(command('import sys;sys.stdout.buffer.write(b"x"*70000);sys.stdout.flush()'),b'',timeout=5)
        with self.assertRaisesRegex(ValueError,'DETECTOR_EXIT_FAILED'):
            ev.run_detector(command('import sys;print(\'{"protocol":"workproof-ai-assessment/1"}\');sys.exit(7)'),b'',timeout=5)
        with self.assertRaisesRegex(ValueError,'WRONG_PROTOCOL'):
            ev.run_detector(command('print("{}")'),b'',timeout=5)
        result=ev.run_detector(command('import sys;sys.stderr.write("private stderr"*100000);print(\'{"protocol":"workproof-ai-assessment/1"}\')'),b'',timeout=5)
        self.assertEqual(result['protocol'],'workproof-ai-assessment/1')

    @unittest.skipUnless(sys.platform=='linux','Linux /proc checks inherited process-group cleanup')
    def test_timeout_stops_inherited_descendant(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt=pathlib.Path(directory)/'descendant.pid'
            code='import subprocess,sys,time;child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);open(sys.argv[1],"w").write(str(child.pid));time.sleep(60)'
            with self.assertRaises(subprocess.TimeoutExpired):
                ev.run_detector([sys.executable,'-c',code,str(receipt)],b'',timeout=1)
            child=int(receipt.read_text())
            for _ in range(100):
                status=pathlib.Path('/proc')/str(child)/'stat'
                if not status.exists() or status.read_text().split()[2]=='Z':break
                time.sleep(.02)
            else:self.fail('Inherited descendant remained running after timeout')


if __name__=='__main__':unittest.main()
