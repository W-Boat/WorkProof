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
        for(int i=0;i<2400;i++){var value=service.status(1,id);if(!Set.of("queued","running","cancelling","finalizing").contains(value.get("state")))return value;Thread.sleep(50);}
        fail("Job did not finish");return null;
    }
    @Test void unconfiguredAndInvalidFormatFailClosed()throws Exception{
        var service=new AiAnalysisService(false,"","","",new ObjectMapper());
        try{assertEquals(503,assertThrows(ServiceException.class,()->service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0]))).code());assertThrows(BusinessException.class,()->service.submit(1,"../anything","txt",new ByteArrayInputStream(new byte[0])));assertThrows(BusinessException.class,()->service.submit(1,"roberta-gpt2-reference","txt",new ByteArrayInputStream(new byte[0])));}finally{service.close();}
    }
    @Test void validWhitelistedReportAndOwnerIsolation()throws Exception{
        byte[] data="sample".getBytes();String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        String output="{\"protocol\":\"workproof-ai-assessment/1\",\"engine_id\":\"mpu-zh-v3\",\"model\":\"yuchuantian/AIGC_detector_zhv3\",\"model_revision\":\"47695ff451b32c225dd938f4f478f7fdc6aa6bb0\",\"network_used\":false,\"artifact_hash\":\""+hash+"\",\"artifact_bytes\":6,\"status\":\"completed\",\"score_kind\":\"uncalibrated_class_softmax\",\"calibration\":null,\"raw_scores\":{\"Human\":0.4,\"AI\":0.6},\"text\":\"MUST_NOT_RETURN\"}";
        var service=service("printf '%s' '"+output+"'\n");
        try{String id=(String)service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(data)).get("id");assertEquals(404,assertThrows(BusinessException.class,()->service.status(2,id)).code());assertEquals("done",done(service,id).get("state"));assertFalse(new ObjectMapper().writeValueAsString(service.status(1,id)).contains("MUST_NOT_RETURN"));}finally{service.close();}
    }
    @Test void cancellationStopsJobAndReleasesCapacity()throws Exception{
        var service=service("exec sleep 30\n");
        try{String id=(String)service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0])).get("id");assertEquals(429,assertThrows(ServiceException.class,()->service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0]))).code());service.cancel(1,id);assertEquals("cancelled",done(service,id).get("state"));String second=(String)service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(new byte[0])).get("id");service.cancel(1,second);assertEquals("cancelled",done(service,second).get("state"));}finally{service.close();}
    }
    @Test void unexpectedModelRevisionDoesNotPublishReport()throws Exception{
        byte[] data="sample".getBytes();String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        var value=new ObjectMapper().createObjectNode();value.put("protocol","workproof-ai-assessment/1");value.put("engine_id","mpu-zh-v3");value.put("network_used",false);value.put("artifact_hash",hash);value.put("artifact_bytes",data.length);value.put("status","insufficient_input");value.put("model","yuchuantian/AIGC_detector_zhv3");value.put("model_revision","wrong");
        var service=service("printf '%s' '"+value+"'\n");
        try{String id=(String)service.submit(1,"mpu-zh-v3","txt",new ByteArrayInputStream(data)).get("id");var result=done(service,id);assertEquals("failed",result.get("state"));assertFalse(result.containsKey("report"));}finally{service.close();}
    }
    @Test @EnabledIfEnvironmentVariable(named="WORKPROOF_REAL_AI_ENGINE",matches=".+")
    void realConfiguredPythonModelRoundTrip()throws Exception{
        String engine=System.getenv("WORKPROOF_REAL_AI_ENGINE");
        Files.createSymbolicLink(root.resolve(engine),Path.of("/tmp/workproof-ai-model"));
        String script=Path.of(System.getenv("WORKPROOF_REAL_AI_SCRIPT")).toAbsolutePath().toString();
        var service=new AiAnalysisService(true,System.getenv("WORKPROOF_REAL_AI_PYTHON"),script,root.toString(),new ObjectMapper());
        try{
            String text=engine.equals("mpu-zh-v3")?"这是一段用于持续集成的合成中文，只检查机构服务能否调用真实模型并返回参考数值，不是检测准确率验收，也不证明作者身份或原创性。".repeat(3):"This synthetic paragraph exercises an optional classifier through the actual institution process service. It is not an accuracy benchmark and does not establish authorship or originality. ".repeat(4);
            String id=(String)service.submit(1,engine,"txt",new ByteArrayInputStream(text.getBytes(java.nio.charset.StandardCharsets.UTF_8))).get("id");
            assertEquals("done",done(service,id).get("state"));
            var report=new ObjectMapper().valueToTree(service.status(1,id).get("report"));assertEquals("completed",report.path("status").asText());assertTrue(report.path("raw_scores").isObject());assertFalse(report.has("text"));
        }finally{service.close();}
    }
}
