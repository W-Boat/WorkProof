package com.scaffold.system.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.scaffold.common.exception.ServiceException;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;

/** Runs the shared Rust verifier. No shell, artifact upload, persistent proof file or content log. */
@Service
public class NativeCertificateInspector {
    public static final int MAX_PROOF_BYTES = 32 * 1024 * 1024;
    private static final int MAX_REPORT_BYTES = 16 * 1024;
    private final String executable;
    private final ObjectMapper mapper;
    private final NativeToolRunner runner = new NativeToolRunner();

    public NativeCertificateInspector(@Value("${workproof.verifier.executable:}") String executable, ObjectMapper mapper) {
        this.executable = executable; this.mapper = mapper.copy().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    private Path configuredPath() {
        try {
            if (executable == null || executable.isBlank()) return null;
            Path path = Path.of(executable);
            String name = path.getFileName() == null ? "" : path.getFileName().toString();
            boolean inspector = name.equals("workproof-inspector") || name.equalsIgnoreCase("workproof-inspector.exe");
            return inspector && path.isAbsolute() && Files.isRegularFile(path) && Files.isExecutable(path) ? path : null;
        } catch (RuntimeException ignored) { return null; }
    }

    public Map<String, Object> capabilities() {
        boolean configured = configuredPath() != null;
        return Map.of("configured", configured, "maxProofBytes", MAX_PROOF_BYTES,
                "maxConcurrent", 2, "artifactChecked", false, "identityVerified", false,
                "message", !configured ? "尚未配置证书检查工具，请联系管理员。" : "可以检查证书内容；作品需在本机另行核对。");
    }

    public JsonNode inspect(InputStream input) {
        Path path = configuredPath();
        if (path == null) throw new ServiceException(503, "尚未配置证书检查工具，请联系管理员。");
        byte[] output=runner.run(path,java.util.List.of(),input,MAX_PROOF_BYTES,MAX_REPORT_BYTES);
        try {
                JsonNode result = mapper.readTree(output);
                if (!(result instanceof ObjectNode object)
                        || !"workproof-inspection/1".equals(result.path("protocol").asText())
                        || !result.path("certificate_valid").isBoolean()
                        || !result.path("artifact_checked").isBoolean() || result.path("artifact_checked").asBoolean()
                        || !result.path("identity_verified").isBoolean() || result.path("identity_verified").asBoolean()
                        || !result.path("time_verified").isBoolean() || result.path("time_verified").asBoolean()) {
                    throw new IllegalStateException("INVALID_VERIFIER_CONTRACT");
                }
                JsonNode signature = object.remove("signature");
                if (result.path("certificate_valid").asBoolean()
                        && (!result.path("signature_valid").asBoolean() || !result.path("manifest").isObject()
                        || !("full".equals(result.path("scope").asText()) && result.path("chain_valid").asBoolean()
                            || "selective".equals(result.path("scope").asText()) && result.path("merkle_valid").asBoolean()
                                && !result.path("chain_valid").asBoolean())
                        || signature == null || !signature.isTextual() || !signature.asText().matches("[0-9a-fA-F]{128}"))) {
                    throw new IllegalStateException("INVALID_POSITIVE_RESULT");
                }
                if (result.path("signature_valid").asBoolean() && signature != null && signature.isTextual()
                        && signature.asText().matches("[0-9a-fA-F]{128}")) {
                    byte[] bytes = HexFormat.of().parseHex(signature.asText());
                    object.put("certificateId", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));
                } else object.putNull("certificateId");
                return object;
        } catch (Exception error) { throw new ServiceException(503, "证书检查工具未能完成操作，请联系管理员检查配置。"); }
    }

    @PreDestroy public void close() { runner.close(); }
}
