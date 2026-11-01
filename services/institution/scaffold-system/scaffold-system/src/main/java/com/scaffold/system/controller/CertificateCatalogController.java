package com.scaffold.system.controller;

import com.scaffold.common.domain.*;
import com.scaffold.framework.audit.OperLog;
import com.scaffold.framework.security.RequiresPermission;
import com.scaffold.system.service.CertificateCatalogService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/workproof/certificates")
public class CertificateCatalogController {
    private final CertificateCatalogService catalog;
    public CertificateCatalogController(CertificateCatalogService catalog) { this.catalog=catalog; }
    @GetMapping("/status")
    @RequiresPermission("workproof:certificate:list")
    public R<CertificateCatalogService.Status> status() { return R.success(catalog.status()); }
    @GetMapping
    @RequiresPermission("workproof:certificate:list")
    public R<PageResult<Map<String,Object>>> list(PageQuery page,@RequestParam(required=false) String keyword,@RequestParam(required=false) String scope) {
        return R.success(catalog.list(page,keyword,scope));
    }
    @GetMapping("/{id}")
    @RequiresPermission("workproof:certificate:list")
    public R<Map<String,Object>> detail(@PathVariable long id) { return R.success(catalog.detail(id)); }
    @PostMapping(consumes=MediaType.APPLICATION_JSON_VALUE)
    @RequiresPermission("workproof:certificate:add")
    @OperLog(module="证书管理",action="检查并保存摘要",recordParams=false)
    public R<CertificateCatalogService.Saved> save(HttpServletRequest request) throws Exception { return R.success(catalog.save(request.getInputStream())); }
    @GetMapping("/export")
    @RequiresPermission("workproof:certificate:export")
    @OperLog(module="证书管理",action="导出摘要列表",recordParams=false)
    public ResponseEntity<String> export(@RequestParam(required=false) String keyword,@RequestParam(required=false) String scope) {
        return ResponseEntity.ok().contentType(new MediaType("text","csv",StandardCharsets.UTF_8))
            .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"workproof-certificates.csv\"")
            .body("\ufeff"+catalog.export(keyword,scope));
    }
}
