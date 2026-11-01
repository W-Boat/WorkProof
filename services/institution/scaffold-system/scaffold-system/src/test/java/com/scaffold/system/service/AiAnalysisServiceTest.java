package com.scaffold.system.service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.scaffold.common.exception.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
@EnabledOnOs({OS.LINUX,OS.MAC})
class AiAnalysisServiceTest{
    @TempDir Path root;
    private AiAnalysisService service(String command)throws Exception{
        Path python=root.resolve("python");Files.writeString(python,"#!/bin/sh\n"+command);python.toFile().setExecutable(true,true);
        Path script=root.resolve("detector.py");Files.writeString(script,"fixture");
        Files.createDirectories(root.resolve("mpu-zh-v3"));Files.writeString(root.resolve("mpu-zh-v3/workproof-model.json"),"{}");
        return new AiAnalysisService(true,python.toString(),script.toString(),root.toString(),new ObjectMapper());
    }
    private Map<String,Object> done(AiAnalysisService service,String id)throws Exception{
        for(int i=0;i<100;i++){var value=service.status(1,id);if(!Set.of("queued","running","cancelling").contains(value.get("state")))return value;Thread.sleep(50);}
        fail("Job did not finish");return null;
    }
    @Test void unconfiguredAndInvalidFormatFailClosed()throws Exception{
        var service=new AiAnalysisService(false,"","","",new ObjectMapper());
        try{assertEquals(503,assertThrows(ServiceException.class,()->service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0]))).code());assertThrows(BusinessException.class,()->service.submit(1,"../anything","txt",new ByteArrayInputStream(new byte[0])));}finally{service.close();}
    }
    @Test void validWhitelistedReportAndOwnerIsolation()throws Exception{
        byte[] data="sample".getBytes();String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        String output="{\"protocol\":\"workproof-ai-assessment/1\",\"engine_id\":\"mpu-zh-v3\",\"network_used\":false,\"artifact_hash\":\""+hash+"\",\"artifact_bytes\":6,\"status\":\"completed\",\"score_kind\":\"uncalibrated_class_softmax\",\"calibration\":null,\"raw_scores\":{\"Human\":0.4,\"AI\":0.6},\"text\":\"MUST_NOT_RETURN\"}";
        var service=service("printf '%s' '"+output+"'\n");
        try{String id=(String)service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(data)).get("id");assertEquals(404,assertThrows(BusinessException.class,()->service.status(2,id)).code());assertEquals("done",done(service,id).get("state"));assertFalse(new ObjectMapper().writeValueAsString(service.status(1,id)).contains("MUST_NOT_RETURN"));}finally{service.close();}
    }
    @Test void cancellationStopsJobAndReleasesCapacity()throws Exception{
        var service=service("exec sleep 30\n");
        try{String id=(String)service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0])).get("id");assertEquals(429,assertThrows(ServiceException.class,()->service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0]))).code());service.cancel(1,id);assertEquals("cancelled",done(service,id).get("state"));String second=(String)service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0])).get("id");service.cancel(1,second);assertEquals("cancelled",done(service,second).get("state"));}finally{service.close();}
    }
}
