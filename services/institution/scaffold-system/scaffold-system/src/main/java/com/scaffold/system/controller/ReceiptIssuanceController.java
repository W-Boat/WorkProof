package com.scaffold.system.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.scaffold.common.domain.R;
import com.scaffold.common.exception.BusinessException;
import com.scaffold.framework.audit.OperLog;
import com.scaffold.framework.security.RequiresPermission;
import com.scaffold.system.service.NativeReceiptIssuer;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/workproof/receipts")
public class ReceiptIssuanceController {
    private final NativeReceiptIssuer issuer;
    public ReceiptIssuanceController(NativeReceiptIssuer issuer){this.issuer=issuer;}
    @GetMapping("/capabilities") @RequiresPermission("workproof:receipt:issue")
    public R<Map<String,Object>> capabilities(){return R.success(issuer.capabilities());}
    @PostMapping(consumes=MediaType.APPLICATION_JSON_VALUE)
    @RequiresPermission("workproof:receipt:issue")
    @OperLog(module="证据回执",action="签发接收回执",recordParams=false)
    public R<JsonNode> issue(HttpServletRequest request,@RequestHeader(value="X-WorkProof-Receipt-Consent",defaultValue="false") String consent)throws IOException{
        if(!"true".equals(consent))throw new BusinessException("请先确认同意向机构提交证书并申请接收回执。");
        return R.success(issuer.issue(request.getInputStream()));
    }
}
