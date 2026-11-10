import copy
import unittest
import audit_detectorscope as audit

def fixture():
    def rows(prefix):
        return [dict(id=f'{prefix}-{i}',input_hash=f'{i+(1000 if prefix=="heldout" else 0):064x}',truth='human' if i<100 else 'ai',
            language='en',domain='news',generator='human' if i<100 else 'synthetic',input_tokens=64,status='completed',
            score=-1. if i<100 else 1.,elapsed_seconds=.1) for i in range(200)]
    calibration,heldout=rows('calibration'),rows('heldout')
    fields=('id','input_hash','truth','language','domain','generator')
    frozen={'manifests':{k:[{f:r[f] for f in fields} for r in rows] for k,rows in [('calibration-en',calibration),('heldout-en',heldout)]},
            'manifest_sha256':{'calibration-en':'a'*64,'heldout-en':'b'*64}}
    threshold=audit.choose_logit_threshold(calibration)
    policy=dict(model_revision=audit.REVISION,dtype='float16',head='logreg',tau=.85,language='en',manifest_sha256=frozen['manifest_sha256'],
        conversion_report_sha256='c'*64,production_enabled=False,direction='higher',score_kind='detectorscope_logit',decision_rule='threshold_gte',
        empirical_calibration_fp_budget=.05,threshold=threshold,calibration_summary=audit.summary(calibration,threshold))
    report=dict(samples=heldout,language='en',threshold=threshold,overall=audit.summary(heldout,threshold),groups=audit.grouped_summary(heldout,threshold),peak_rss_kib=7000000)
    return frozen,'en',calibration,policy,report,'c'*64

class AuditTests(unittest.TestCase):
    def test_complete_consistent_report(self): self.assertTrue(audit.audit(*fixture())['audit_passed'])
    def test_missing_duplicate_and_changed_identity(self):
        for mutation in ('missing','duplicate','hash'):
            args=list(fixture());rows=args[4]['samples']
            if mutation=='missing':rows.pop()
            elif mutation=='duplicate':rows[1]=copy.deepcopy(rows[0])
            else:rows[0]['input_hash']='f'*64
            with self.assertRaises(ValueError):audit.audit(*args)
    def test_forged_metrics_threshold_and_model(self):
        for mutation in ('metric','threshold','model','derivative'):
            args=list(fixture())
            if mutation=='metric':args[4]['overall']['false_negative']['count']=100
            elif mutation=='threshold':args[3]['threshold']=100
            elif mutation=='model':args[3]['model_revision']='wrong'
            else:args[3]['conversion_report_sha256']='wrong'
            with self.assertRaises(ValueError):audit.audit(*args)
    def test_unsupported_cannot_hide_a_scored_value_or_in_range_input(self):
        args=list(fixture());args[4]['samples'][0].update(status='unsupported',reason='TOKEN_BUDGET_8_TO_512_NO_TRUNCATION')
        with self.assertRaises(ValueError):audit.audit(*args)

if __name__=='__main__':unittest.main()
