package com.scaffold.system.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.scaffold.common.domain.R;
import com.scaffold.framework.audit.OperLog;
import com.scaffold.framework.security.RequiresPermission;
import com.scaffold.system.service.NativeCertificateInspector;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/workproof/certificates")
public class CertificateInspectionController {
    private final NativeCertificateInspector inspector;
    public CertificateInspectionController(NativeCertificateInspector inspector) { this.inspector = inspector; }

    @GetMapping("/capabilities")
    @RequiresPermission("workproof:certificate:inspect")
    public R<Map<String, Object>> capabilities() { return R.success(inspector.capabilities()); }

    @PostMapping(value = "/inspect", consumes = MediaType.APPLICATION_JSON_VALUE)
    @RequiresPermission("workproof:certificate:inspect")
    @OperLog(module = "证书核验", action = "内容检查", recordParams = false)
    public R<JsonNode> inspect(HttpServletRequest request) throws IOException {
        return R.success(inspector.inspect(request.getInputStream()));
    }
}
