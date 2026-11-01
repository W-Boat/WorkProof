package com.scaffold.system.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.scaffold.common.exception.BusinessException;
import com.scaffold.common.exception.ServiceException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

@EnabledOnOs({OS.LINUX, OS.MAC})
class NativeCertificateInspectorTest {
    @TempDir Path directory;
    private NativeCertificateInspector helper(String script) throws Exception {
        Path executable = directory.resolve("workproof-inspector");
        Files.writeString(executable, "#!/bin/sh\n" + script);
        assertTrue(executable.toFile().setExecutable(true, true));
        return new NativeCertificateInspector(executable.toString(), new ObjectMapper());
    }
    private ByteArrayInputStream input() { return new ByteArrayInputStream("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8)); }

    @Test void unconfiguredAndWrongExecutableAreNotReportedReady() throws Exception {
        Path wrong = directory.resolve("workproof-engine"); Files.writeString(wrong, "#!/bin/sh\nexit 0\n"); wrong.toFile().setExecutable(true, true);
        var service = new NativeCertificateInspector(wrong.toString(), new ObjectMapper());
        try { assertEquals(false, service.capabilities().get("configured")); assertEquals(503, assertThrows(ServiceException.class, () -> service.inspect(input())).code()); }
        finally { service.close(); }
    }
    @Test void aToolCannotClaimAnArtifactWasChecked() throws Exception {
        var service = helper("cat >/dev/null\nprintf '%s\\n' '{\"protocol\":\"workproof-inspection/1\",\"certificate_valid\":true,\"artifact_checked\":true,\"identity_verified\":false,\"time_verified\":false}'\n");
        try { assertEquals(503, assertThrows(ServiceException.class, () -> service.inspect(input())).code()); }
        finally { service.close(); }
    }
    @Test void oversizedInputIsRejectedBeforeTheToolRuns() throws Exception {
        var service = helper("exit 77\n");
        try { assertEquals(400, assertThrows(BusinessException.class, () -> service.inspect(new ByteArrayInputStream(new byte[NativeCertificateInspector.MAX_PROOF_BYTES + 1]))).code()); }
        finally { service.close(); }
    }
    @Test void aHungToolIsTerminatedAndDoesNotHoldTheRequestForever() throws Exception {
        var service = helper("cat >/dev/null\nexec sleep 30\n");
        try { assertTimeoutPreemptively(Duration.ofSeconds(25), () -> assertEquals(504, assertThrows(ServiceException.class, () -> service.inspect(input())).code())); }
        finally { service.close(); }
    }
}
