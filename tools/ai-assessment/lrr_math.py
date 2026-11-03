"""Independent implementation of the formula in DetectLLM §3.1.

https://aclanthology.org/2023.findings-emnlp.827.pdf
No upstream source copied. Higher ratio is the paper's machine-like direction,
not a calibrated verdict. Ties use competition rank: 1 + strictly greater count.
"""
import math
import torch


def compute_lrr(logits,targets,*,chunk_rows=16):
    if (not isinstance(logits,torch.Tensor) or not isinstance(targets,torch.Tensor) or
            logits.ndim!=2 or targets.ndim!=1 or logits.shape[0]!=targets.shape[0] or
            logits.shape[0]<1 or logits.shape[1]<1 or not logits.is_floating_point() or
            targets.dtype!=torch.int64 or targets.device!=logits.device or
            type(chunk_rows) is not int or chunk_rows<1):raise ValueError('INVALID_LRR_SHAPE')
    if bool((targets<0).any()) or bool((targets>=logits.shape[1]).any()):raise ValueError('INVALID_LRR_TARGET')
    nll=0.;log_rank=0.
    for start in range(0,logits.shape[0],chunk_rows):
        rows=logits[start:start+chunk_rows].float()
        if not bool(torch.isfinite(rows).all()):raise ValueError('NONFINITE_LRR_INPUT')
        target=targets[start:start+chunk_rows]
        chosen=rows.gather(1,target[:,None]).squeeze(1)
        ranks=1+(rows>chosen[:,None]).sum(dim=1)
        nll+=(torch.logsumexp(rows,dim=1)-chosen).double().sum().item()
        log_rank+=ranks.double().log().sum().item()
    if log_rank<=0 or not math.isfinite(nll+log_rank):raise ValueError('UNSCORABLE_LRR')
    value=nll/log_rank
    if not math.isfinite(value) or value<0:raise ValueError('UNSCORABLE_LRR')
    return {'value':value,'scored_tokens':int(targets.numel()),'negative_log_likelihood_sum':nll,
        'log_rank_sum':log_rank,'tie_policy':'one_plus_strictly_greater_count'}
