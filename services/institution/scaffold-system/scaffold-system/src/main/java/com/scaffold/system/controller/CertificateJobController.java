package com.scaffold.system.controller;

import com.scaffold.common.domain.R;
import com.scaffold.framework.audit.OperLog;
import com.scaffold.framework.security.RequiresPermission;
import com.scaffold.system.service.CertificateJobService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/workproof/certificate-jobs")
public class CertificateJobController {
    private final CertificateJobService jobs;
    public CertificateJobController(CertificateJobService jobs){this.jobs=jobs;}
    public record Create(String clientKey,boolean consent,int expectedItems){}
    @GetMapping("/capabilities") @RequiresPermission("workproof:certificate:list")
    public R<Map<String,Object>> capabilities(){return R.success(jobs.capabilities());}
    @GetMapping @RequiresPermission("workproof:certificate:list")
    public R<List<Map<String,Object>>> list(){return R.success(jobs.list());}
    @GetMapping("/{id}") @RequiresPermission("workproof:certificate:list")
    public R<Map<String,Object>> detail(@PathVariable String id){return R.success(jobs.detail(id));}
    @PostMapping @RequiresPermission("workproof:certificate:add")
    @OperLog(module="证书后台任务",action="新建上传任务",recordParams=false)
    public R<Map<String,Object>> create(@RequestBody Create body){return R.success(jobs.create(body.clientKey(),body.consent(),body.expectedItems()));}
    @PutMapping(value="/{id}/items/{index}",consumes=MediaType.APPLICATION_OCTET_STREAM_VALUE)
    @RequiresPermission("workproof:certificate:add") @OperLog(module="证书后台任务",action="上传待检查证书",recordParams=false)
    public R<Map<String,Object>> upload(@PathVariable String id,@PathVariable int index,HttpServletRequest request)throws Exception{return R.success(jobs.upload(id,index,request.getInputStream()));}
    @PostMapping("/{id}/submit") @RequiresPermission("workproof:certificate:add")
    @OperLog(module="证书后台任务",action="提交后台处理",recordParams=false)
    public R<Map<String,Object>> submit(@PathVariable String id){return R.success(jobs.submit(id));}
    @DeleteMapping("/{id}") @RequiresPermission("workproof:certificate:add")
    @OperLog(module="证书后台任务",action="请求取消后台处理",recordParams=false)
    public R<Map<String,Object>> cancel(@PathVariable String id){return R.success(jobs.cancel(id));}
}
