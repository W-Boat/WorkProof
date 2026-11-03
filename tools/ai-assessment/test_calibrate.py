"""Threshold/leakage fixtures, not actual model calibration or quality evidence."""
import pathlib
import tempfile
import json
import unittest
import calibrate as cal


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.registry={'fixture':dict(revision='fixed',score_kind='uncalibrated_binary_sigmoid',language='en')}
        self.rows=[dict(id=f'sample-{i}',input_hash=cal.ev.digest(str(i).encode()),language='en',truth='human' if i<100 else 'ai',status='completed',score=.2 if i<100 else .8) for i in range(200)]
        self.report=dict(protocol='workproof-ai-evaluation/1',engine_id='fixture',model_revision='fixed',score_kind='uncalibrated_binary_sigmoid',score_label='AI',dataset_sha256='a'*64,samples=self.rows)
        self.heldout=['f'*64]

    def freeze(self):return cal.freeze(self.report,self.registry,self.heldout,'https://example.org/calibration-source')

    def test_freezes_above_tied_human_scores_and_is_loadable(self):
        self.rows[0]['score']=.9
        policy=self.freeze()
        self.assertGreater(policy['threshold'],.2);self.assertLess(policy['threshold'],.8)
        self.assertEqual(policy['calibration_summary']['human_false_positive'],1)
        self.assertEqual(policy['calibration_summary']['ai_false_negative'],0)
        self.assertEqual(len(policy['calibration_input_sha256']),200)
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'policy.json';path.write_text(json.dumps(policy))
            cal.ev.load_policy(path,'b'*64,self.registry)

    def test_overlap_including_unscored_inputs_rejected(self):
        self.rows[0]['status']='unsupported';self.heldout=[self.rows[0]['input_hash']]
        with self.assertRaisesRegex(ValueError,'CALIBRATION_HELDOUT_OVERLAP'):self.freeze()

    def test_unfeasible_too_few_and_errors_are_not_silent_quality(self):
        self.rows[0]['score']=float('nan')
        with self.assertRaisesRegex(ValueError,'INVALID_CALIBRATION_SCORE'):self.freeze()
        self.rows[0]['score']=.2;self.rows[0]['status']='error'
        with self.assertRaisesRegex(ValueError,'CALIBRATION_INFERENCE_FAILURE'):self.freeze()
        self.rows[0]['status']='unsupported'
        with self.assertRaisesRegex(ValueError,'CALIBRATION_SAMPLE_COUNT_TOO_SMALL'):self.freeze()
        self.rows[0]['status']='completed'
        for row in self.rows[:100]:row['score']=1.
        with self.assertRaisesRegex(ValueError,'NO_FEASIBLE_THRESHOLD'):self.freeze()

    def test_duplicate_wrong_model_language_and_budget_rejected(self):
        for key,value in (('input_hash',self.rows[1]['input_hash']),('language','zh'),('score',True)):
            original=self.rows[0][key];self.rows[0][key]=value
            with self.assertRaises(ValueError):self.freeze()
            self.rows[0][key]=original
        self.report['model_revision']='changed'
        with self.assertRaisesRegex(ValueError,'CALIBRATION_MODEL_MISMATCH'):self.freeze()
        self.report['model_revision']='fixed'
        for budget in (float('nan'),-.1,.11,True):
            with self.assertRaises(ValueError):cal.freeze(self.report,self.registry,self.heldout,'https://example.org/source',budget)


if __name__=='__main__':unittest.main()
