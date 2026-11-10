"""Independent structural/statistical audit; does not prove model truth or score provenance."""
import math
from detector_statistics import choose_logit_threshold
from evaluate_lrr import summary, grouped_summary

REVISION='9baaff9e2d1cdb79cafa90cdb27811b847e69dae'

def require(value,code):
    if not value: raise ValueError(code)

def check_rows(rows,manifest):
    require(isinstance(rows,list) and len(rows)==len(manifest),'REPORT_SAMPLE_COUNT')
    expected={r['id']:r for r in manifest};seen=set()
    require(len(expected)==len(manifest),'MANIFEST_DUPLICATE')
    allowed={'id','input_hash','truth','language','domain','generator','input_tokens','status','score','elapsed_seconds','reason'}
    for row in rows:
        require(isinstance(row,dict) and set(row)<=allowed,'REPORT_FIELDS')
        key=row.get('id');require(key in expected and key not in seen,'REPORT_SAMPLE_ID');seen.add(key)
        for field,value in expected[key].items(): require(row.get(field)==value,'REPORT_SAMPLE_IDENTITY')
        tokens=row.get('input_tokens');require(type(tokens) is int and tokens>=0,'REPORT_TOKENS')
        if row.get('status')=='completed':
            value=row.get('score');elapsed=row.get('elapsed_seconds')
            require(type(value) in (int,float) and math.isfinite(value) and 8<=tokens<=512,'REPORT_SCORE')
            require(type(elapsed) in (int,float) and math.isfinite(elapsed) and elapsed>=0,'REPORT_ELAPSED')
            require('reason' not in row,'REPORT_COMPLETED_REASON')
        else:
            require(row.get('status')=='unsupported' and not 8<=tokens<=512 and 'score' not in row and
                    row.get('reason')=='TOKEN_BUDGET_8_TO_512_NO_TRUNCATION','REPORT_UNSUPPORTED')

def audit(frozen,language,calibration,policy,heldout,conversion_digest):
    require(language in ('en','zh'),'REPORT_LANGUAGE')
    check_rows(calibration,frozen['manifests']['calibration-'+language])
    check_rows(heldout.get('samples'),frozen['manifests']['heldout-'+language])
    require(policy.get('model_revision')==REVISION and policy.get('dtype')=='float16' and
            policy.get('head')=='logreg' and policy.get('tau')==.85,'POLICY_MODEL')
    require(policy.get('language')==language and heldout.get('language')==language,'POLICY_LANGUAGE')
    require(policy.get('manifest_sha256')==frozen['manifest_sha256'],'POLICY_MANIFEST')
    require(policy.get('conversion_report_sha256')==conversion_digest,'POLICY_DERIVATIVE')
    require(policy.get('production_enabled') is False and policy.get('direction')=='higher' and
            policy.get('score_kind')=='detectorscope_logit' and policy.get('decision_rule')=='threshold_gte' and
            policy.get('empirical_calibration_fp_budget')==.05,'POLICY_CONTRACT')
    threshold=choose_logit_threshold(calibration)
    require(type(policy.get('threshold')) in (int,float) and policy['threshold']==threshold and
            heldout.get('threshold')==threshold,'POLICY_THRESHOLD')
    require(policy.get('calibration_summary')==summary(calibration,threshold),'CALIBRATION_SUMMARY')
    require(heldout.get('overall')==summary(heldout['samples'],threshold),'HELDOUT_SUMMARY')
    require(heldout.get('groups')==grouped_summary(heldout['samples'],threshold),'HELDOUT_GROUPS')
    peak=heldout.get('peak_rss_kib');require(type(peak) is int and 0<peak<=10*1024**2,'REPORT_MEMORY')
    return {'audit_passed':True,'language':language,'threshold':threshold,'overall':heldout['overall'],
            'score_provenance_independently_proved':False,'accuracy_certified':False,'production_enabled':False}
