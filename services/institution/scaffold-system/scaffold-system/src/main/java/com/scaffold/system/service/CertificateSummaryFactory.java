package com.scaffold.system.service;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** Shared mapping of a trusted native inspection into the existing V3 summary. */
final class CertificateSummaryFactory {
    private CertificateSummaryFactory() {}
    static Map<String,Object> row(JsonNode report,String hash,long owner,Long dept,String username){
        var manifest=report.path("manifest");Map<String,Object> row=new HashMap<>();
        row.put("ownerUserId",owner);row.put("deptId",dept);row.put("createBy",username);
        row.put("certificateId",report.path("certificateId").asText());row.put("proofHash",hash);
        row.put("fileName",manifest.path("file_name").asText());row.put("artifactHash",manifest.path("artifact_hash").asText());
        row.put("scope",report.path("scope").asText());row.put("disclosedEvents",report.path("disclosed_events").longValue());
        row.put("totalEvents",report.path("total_events").longValue());row.put("demo",manifest.path("demo").asBoolean()?1:0);
        return row;
    }
}
