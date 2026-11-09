package com.scaffold.system.service;

import com.fasterxml.jackson.databind.*;
import com.scaffold.common.exception.ServiceException;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.io.InputStream;
import java.nio.file.*;
import java.util.*;

/** Optional receipt issuance; never accepts executable/key paths from HTTP input. */
@Service
public class NativeReceiptIssuer {
    private final String executable,privateKey,publicKey,issuer;
    private final long lifetime;
    private final ObjectMapper mapper;
    private final NativeToolRunner runner=new NativeToolRunner();
    public NativeReceiptIssuer(@Value("${workproof.receipt.executable:}") String executable,
            @Value("${workproof.receipt.private-key:}") String privateKey,
            @Value("${workproof.receipt.public-key:}") String publicKey,
            @Value("${workproof.receipt.issuer-id:}") String issuer,
            @Value("${workproof.receipt.lifetime-seconds:86400}") long lifetime,ObjectMapper mapper){
        this.executable=executable;this.privateKey=privateKey;this.publicKey=publicKey;this.issuer=issuer;this.lifetime=lifetime;
        this.mapper=mapper.copy().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    }
    private Path configured(){
        try{
            if(executable==null||privateKey==null||publicKey==null||issuer==null||!issuer.matches("[A-Za-z0-9._:-]{1,128}")||lifetime<1||lifetime>2678400)return null;
            Path tool=Path.of(executable),secret=Path.of(privateKey),trusted=Path.of(publicKey);
            String name=tool.getFileName()==null?"":tool.getFileName().toString();
            if(!(name.equals("workproof-receipt")||name.equalsIgnoreCase("workproof-receipt.exe"))||!tool.isAbsolute()||!Files.isRegularFile(tool)||!Files.isExecutable(tool)
                    ||!secret.isAbsolute()||!trusted.isAbsolute()||!Files.isRegularFile(secret)||!Files.isRegularFile(trusted)||!Files.isReadable(secret)||!Files.isReadable(trusted)
                    ||Files.size(secret)>128||Files.size(trusted)>128)return null;
            PrivateJobSpool.verify(secret,false);
            return tool;
        }catch(Exception error){return null;}
    }
    public Map<String,Object> capabilities(){boolean ready=configured()!=null;return Map.of("configured",ready,"maxProofBytes",NativeCertificateInspector.MAX_PROOF_BYTES,"maxConcurrent",2,"clientOriginVerified",false,"message",ready?"可签发接收回执；不认证客户端来源或操作真实。":"签发尚未配置或私钥权限不符合要求，请联系管理员。");}
    public JsonNode issue(InputStream input){
        Path tool=configured();if(tool==null)throw new ServiceException(503,"签发尚未配置或私钥权限不符合要求，请联系管理员。");
        byte[] output=runner.run(tool,List.of("issue-stdin",issuer,Long.toString(lifetime),privateKey,publicKey),input,NativeCertificateInspector.MAX_PROOF_BYTES,16*1024);
        try{
            JsonNode result=mapper.readTree(output),payload=result.path("payload");
            Set<String> fields=new HashSet<>();result.fieldNames().forEachRemaining(fields::add);
            Set<String> payloadFields=new HashSet<>();payload.fieldNames().forEachRemaining(payloadFields::add);
            if(!fields.equals(Set.of("payload","signature"))||!payload.isObject()||!"workproof-server-receipt/1".equals(payload.path("protocol").asText())
                    ||!payloadFields.equals(Set.of("protocol","purpose","issuer_id","receipt_id","received_at_ms","expires_at_ms","evidence_digest","proof_signature","artifact_hash","session_id","scope","received_events"))
                    ||!"server-received".equals(payload.path("purpose").asText())||!issuer.equals(payload.path("issuer_id").asText())
                    ||!result.path("signature").asText().matches("[0-9a-fA-F]{128}")||!payload.path("receipt_id").asText().matches("[0-9a-fA-F]{64}")
                    ||!payload.path("evidence_digest").asText().matches("[0-9a-fA-F]{64}")||!payload.path("artifact_hash").asText().matches("[0-9a-fA-F]{64}")||!payload.path("proof_signature").asText().matches("[0-9a-fA-F]{128}")
                    ||!payload.path("session_id").isTextual()||payload.path("session_id").asText().length()>512||!Set.of("full","selective").contains(payload.path("scope").asText())
                    ||!payload.path("received_events").isIntegralNumber()||!payload.path("received_events").canConvertToLong()||payload.path("received_events").asLong()<0
                    ||!payload.path("received_at_ms").isIntegralNumber()||!payload.path("expires_at_ms").isIntegralNumber()||!payload.path("received_at_ms").canConvertToLong()||!payload.path("expires_at_ms").canConvertToLong()
                    ||payload.path("received_at_ms").asLong()<0||payload.path("expires_at_ms").asLong()<=payload.path("received_at_ms").asLong()
                    ||payload.path("expires_at_ms").asLong()-payload.path("received_at_ms").asLong()!=lifetime*1000)throw new IllegalStateException("INVALID_RECEIPT_CONTRACT");
            return result;
        }catch(Exception error){throw new ServiceException(503,"签发工具未能返回有效回执，请联系管理员。");}
    }
    @PreDestroy public void close(){runner.close();}
}
