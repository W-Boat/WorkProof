"""Analytic reporting/calibration fixtures, no model imports or downloads."""
import math
import unittest
from evaluate_lrr import choose_threshold,summary,grouped_summary,rate


def row(truth,score,status='completed',domain='news',generator=None):
    return {'truth':truth,'score':score,'status':status,'domain':domain,
        'generator':generator or ('human' if truth=='human' else 'fixture-generator')}


class Reporting(unittest.TestCase):
    def test_ratio_threshold_is_not_probability(self):
        rows=[row('human',2+i/100) for i in range(100)]+[row('ai',5.) for _ in range(100)]
        threshold=choose_threshold(rows)
        self.assertGreater(threshold,1.)
        self.assertLessEqual(sum(r['score']>=threshold for r in rows[:100]),5)
        result=summary(rows,threshold)
        self.assertEqual(result['false_negative']['count'],0)
        self.assertEqual(result['false_positive']['total'],100)

    def test_no_threshold_from_insufficient_coverage(self):
        cases=[[row('human',2.)]*99+[row('ai',3.)]*100,
            [row('human',2.)]*100+[row('ai',3.)]*100+[row('human',None,'unsupported')]*30]
        for rows in cases:
            with self.subTest(),self.assertRaises(ValueError):choose_threshold(rows)

    def test_ties_and_heldout_are_not_calibration(self):
        rows=[row('human',4.)]*100+[row('ai',5.)]*100
        threshold=choose_threshold(rows)
        self.assertEqual(threshold,math.nextafter(4.,math.inf))
        heldout=[row('human',6.)]*10+[row('ai',3.)]*10
        report=summary(heldout,threshold)
        self.assertEqual(report['false_positive']['rate'],1.)
        self.assertEqual(report['false_negative']['rate'],1.)
        self.assertEqual(choose_threshold(rows),threshold)

    def test_unscored_and_one_class_groups(self):
        rows=[row('human',2.),row('ai',3.),row('human',None,'insufficient_input')]
        report=summary(rows,2.5)
        self.assertEqual(report['completed'],2)
        self.assertEqual(report['false_positive']['total'],1)
        groups=grouped_summary(rows,2.5)
        self.assertIsNone(groups['generator']['human']['false_negative']['rate'])
        self.assertEqual(groups['domain']['news']['samples'],3)
        self.assertIsNone(rate(0,0)['wilson95'])


if __name__=='__main__':unittest.main()
