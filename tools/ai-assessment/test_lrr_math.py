"""Small analytic fixtures; no model, download or upstream code."""
import math
import unittest
import torch
from lrr_math import compute_lrr


class Formula(unittest.TestCase):
    def test_known_ratio(self):
        logits=torch.tensor([[0.,math.log(2),math.log(3)],[0.,0.,math.log(2)]])
        targets=torch.tensor([1,0])
        score=compute_lrr(logits,targets)
        self.assertAlmostEqual(score['value'],(math.log(3)+math.log(4))/(2*math.log(2)),places=6)
        self.assertEqual(score['scored_tokens'],2)
        self.assertAlmostEqual(compute_lrr(logits+10,targets,chunk_rows=1)['value'],score['value'],places=5)
        self.assertAlmostEqual(compute_lrr(logits,targets,chunk_rows=1)['value'],score['value'],places=6)

    def test_invalid_and_rank_one(self):
        with self.assertRaises(ValueError):compute_lrr(torch.zeros(2,3),torch.tensor([0,0]))
        for logits,targets in [(torch.tensor([[float('nan'),0.]]),torch.tensor([1])),
            (torch.tensor([[float('inf'),0.]]),torch.tensor([1])),
            (torch.ones(2,3),torch.tensor([0])),(torch.ones(1,3),torch.tensor([3])),
            (torch.ones(1,3),torch.tensor([-1])),(torch.ones(1,3),torch.tensor([1.]))]:
            with self.subTest(),self.assertRaises(ValueError):compute_lrr(logits,targets)


if __name__=='__main__':unittest.main()
