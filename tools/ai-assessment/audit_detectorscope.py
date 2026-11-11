"""Independent structural/statistical audit; does not prove model truth or score provenance."""
import math
import re
from detector_statistics import choose_logit_threshold
from evaluate_lrr import summary, grouped_summary

REVISION='9baaff9e2d1cdb79cafa90cdb27811b847e69dae'

def require(value,code):
    if not value: raise ValueError(code)

def audit_conversion(report,reference,inventory):
    """Check continuity with the previously verified derivative; no weights are loaded."""
    require(report.get('model_revision')==REVISION and reference.get('model_revision')==REVISION and
            inventory.get('revision')==REVISION,'CONVERSION_REVISION')
    require(report.get('production_enabled') is False and report.get('inference_completed') is False,
            'CONVERSION_SCOPE')
    names={f'extractor/model-{i:05d}-of-00003.safetensors' for i in (1,2,3)}
    names.update(('extractor/config.json','extractor/model.safetensors.index.json'))
    def indexed(rows):
        require(isinstance(rows,list) and len(rows)==5 and all(isinstance(r,dict) for r in rows),
                'CONVERSION_FILES')
        require(all(isinstance(r.get('path'),str) for r in rows),'CONVERSION_PATH')
        result={r['path']:r for r in rows}
        require(set(result)==names,'CONVERSION_PATHS')
        return result
    actual=indexed(report.get('derived_files'));expected=indexed(reference.get('derived_files'))
    originals={r['path']:r for r in inventory['files']}
    for path,item in actual.items():
        for field in ('source_sha256','derived_sha256'):
            value=item.get(field)
            require(isinstance(value,str) and re.fullmatch(r'[0-9a-f]{64}',value) and
                    value==expected[path].get(field),'CONVERSION_DIGEST')
        if not path.endswith('.safetensors'): continue
        require(item['source_sha256']==originals[path]['lfs']['oid'],'CONVERSION_SOURCE')
        for field in ('derived_size','tensor_bytes'):
            value=item.get(field)
            require(type(value) is int and value>0 and value==expected[path].get(field),'CONVERSION_SIZE')
        require(item.get('all_values_verified') is True and
                item.get('conversion')=='float32-to-float16, round-to-nearest torch.to','CONVERSION_METHOD')
        peak=item.get('peak_rss_kib');observed=item.get('parent_observed_peak_rss_bytes')
        require(type(peak) is int and 0<peak<=10*1024**2 and type(observed) is int and
                0<=observed<=10*1024**3,'CONVERSION_MEMORY')
    return {'verified_reference_matched':True,'derived_files':5,
            'weights_recomputed_by_auditor':False,'production_enabled':False}

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

def audit_policy(frozen,language,calibration,policy,conversion_digest):
    require(language in ('en','zh'),'REPORT_LANGUAGE')
    check_rows(calibration,frozen['manifests']['calibration-'+language])
    require(policy.get('model_revision')==REVISION and policy.get('dtype')=='float16' and
            policy.get('head')=='logreg' and policy.get('tau')==.85,'POLICY_MODEL')
    require(policy.get('language')==language,'POLICY_LANGUAGE')
    require(policy.get('manifest_sha256')==frozen['manifest_sha256'],'POLICY_MANIFEST')
    require(policy.get('conversion_report_sha256')==conversion_digest,'POLICY_DERIVATIVE')
    require(policy.get('production_enabled') is False and policy.get('direction')=='higher' and
            policy.get('score_kind')=='detectorscope_logit' and policy.get('decision_rule')=='threshold_gte' and
            policy.get('empirical_calibration_fp_budget')==.05,'POLICY_CONTRACT')
    threshold=choose_logit_threshold(calibration)
    require(type(policy.get('threshold')) in (int,float) and policy['threshold']==threshold,'POLICY_THRESHOLD')
    require(policy.get('calibration_summary')==summary(calibration,threshold),'CALIBRATION_SUMMARY')
    return threshold


def audit(frozen,language,calibration,policy,heldout,conversion_digest):
    threshold=audit_policy(frozen,language,calibration,policy,conversion_digest)
    check_rows(heldout.get('samples'),frozen['manifests']['heldout-'+language])
    require(heldout.get('language')==language,'REPORT_LANGUAGE')
    require(heldout.get('threshold')==threshold,'POLICY_THRESHOLD')
    require(heldout.get('overall')==summary(heldout['samples'],threshold),'HELDOUT_SUMMARY')
    require(heldout.get('groups')==grouped_summary(heldout['samples'],threshold),'HELDOUT_GROUPS')
    peak=heldout.get('peak_rss_kib');require(type(peak) is int and 0<peak<=10*1024**2,'REPORT_MEMORY')
    return {'audit_passed':True,'language':language,'threshold':threshold,'overall':heldout['overall'],
            'score_provenance_independently_proved':False,'accuracy_certified':False,'production_enabled':False}
