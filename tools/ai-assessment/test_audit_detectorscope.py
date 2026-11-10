import copy
import json
import pathlib
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

class ConversionAuditTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]
        self.reference=json.loads((root/'docs/evidence/detectorscope-883ad40/detectorscope-conversion-results.json').read_bytes())
        self.inventory=json.loads((root/'docs/research/detectorscope-model-inventory-20261110.json').read_bytes())

    def test_previously_value_verified_derivative_matches(self):
        report=copy.deepcopy(self.reference)
        report['derived_files'].reverse()  # File order and machine-specific RSS need not match.
        for row in report['derived_files']:
            if row['path'].endswith('.safetensors'):row['peak_rss_kib']=7000000
        self.assertTrue(audit.audit_conversion(report,self.reference,self.inventory)['verified_reference_matched'])

    def test_changed_missing_duplicated_or_extra_derivatives_are_rejected(self):
        for mutation in ('missing','duplicate','extra','source','derived','size','tensor_bytes','revision',
                         'method','unverified','memory','observed_memory','production','inference','boolean_size'):
            report=copy.deepcopy(self.reference);row=report['derived_files'][0]
            if mutation=='missing':report['derived_files'].pop()
            elif mutation=='duplicate':report['derived_files'][1]=copy.deepcopy(row)
            elif mutation=='extra':report['derived_files'].append(copy.deepcopy(row))
            elif mutation in ('source','derived'):row[mutation+'_sha256']='0'*64
            elif mutation=='size':row['derived_size']+=1
            elif mutation=='tensor_bytes':row['tensor_bytes']+=2
            elif mutation=='revision':report['model_revision']='0'*40
            elif mutation=='method':row['conversion']='unverified conversion'
            elif mutation=='unverified':row['all_values_verified']=False
            elif mutation=='memory':row['peak_rss_kib']=10*1024**2+1
            elif mutation=='observed_memory':row['parent_observed_peak_rss_bytes']=10*1024**3+1
            elif mutation=='production':report['production_enabled']=True
            elif mutation=='inference':report['inference_completed']=True
            elif mutation=='boolean_size':row['derived_size']=True
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):
                audit.audit_conversion(report,self.reference,self.inventory)

    def test_reference_cannot_override_original_weight_inventory(self):
        reference=copy.deepcopy(self.reference)
        reference['derived_files'][0]['source_sha256']='f'*64
        with self.assertRaises(ValueError):audit.audit_conversion(reference,reference,self.inventory)

if __name__=='__main__':unittest.main()
