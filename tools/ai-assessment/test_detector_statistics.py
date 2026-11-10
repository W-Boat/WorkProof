import math
import unittest
from detector_statistics import choose_logit_threshold

def completed(truth,values): return [{'truth':truth,'status':'completed','score':v} for v in values]

class LogitThresholdTests(unittest.TestCase):
    def test_negative_logits_and_empirical_five_percent_boundary(self):
        human=[-10+i/100 for i in range(100)]
        rows=completed('human',human)+completed('ai',[-5]*100)
        threshold=choose_logit_threshold(rows)
        self.assertEqual(sum(v>=threshold for v in human),5)
        self.assertGreater(threshold,human[94])
        self.assertEqual(threshold,choose_logit_threshold(list(reversed(rows))))

    def test_ties_are_not_split_and_ai_scores_do_not_tune_threshold(self):
        human=completed('human',[0]*100)
        threshold=choose_logit_threshold(human+completed('ai',[1]*100))
        self.assertGreater(threshold,0)
        self.assertEqual(threshold,choose_logit_threshold(human+completed('ai',[-100]*100)))

    def test_coverage_and_sample_minima_fail_closed(self):
        rows=completed('human',[0]*100)+completed('ai',[1]*100)
        with self.assertRaisesRegex(ValueError,'COVERAGE'): choose_logit_threshold(rows[:-1])
        with self.assertRaisesRegex(ValueError,'COVERAGE'):
            choose_logit_threshold(rows+[{'truth':'human','status':'unsupported'}]*23)

    def test_nonfinite_and_boolean_scores_are_not_accepted(self):
        for value in (math.nan,math.inf,-math.inf,True,'1'):
            rows=completed('human',[0]*100)+completed('ai',[1]*100)
            rows[0]['score']=value
            with self.assertRaisesRegex(ValueError,'LOGIT_INVALID'): choose_logit_threshold(rows)

if __name__=='__main__': unittest.main()
