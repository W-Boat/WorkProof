"""Calibration-only logit threshold selection; never accepts heldout data or publishes accuracy."""
import math

def choose_logit_threshold(rows):
    if not isinstance(rows, list) or not rows: raise ValueError('CALIBRATION_EMPTY')
    human, ai = [], []
    for row in rows:
        if row.get('truth') not in ('human','ai') or row.get('status') not in ('completed','unsupported'):
            raise ValueError('CALIBRATION_ROW_INVALID')
        if row['status'] != 'completed': continue
        value = row.get('score')
        if type(value) not in (int,float) or not math.isfinite(value): raise ValueError('CALIBRATION_LOGIT_INVALID')
        (human if row['truth']=='human' else ai).append(value)
    if len(human)<100 or len(ai)<100 or (len(human)+len(ai))/len(rows)<.9:
        raise ValueError('INSUFFICIENT_CALIBRATION_COVERAGE')
    candidates=sorted({math.nextafter(value,math.inf) for value in human})
    for threshold in candidates:
        if math.isfinite(threshold) and sum(score>=threshold for score in human)/len(human)<=.05:
            return threshold
    raise ValueError('NO_FINITE_CALIBRATION_THRESHOLD')
