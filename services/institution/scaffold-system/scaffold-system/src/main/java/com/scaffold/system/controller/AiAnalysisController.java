package com.scaffold.system.controller;
import com.scaffold.common.domain.R;
import com.scaffold.common.exception.BusinessException;
import com.scaffold.framework.audit.OperLog;
import com.scaffold.framework.security.RequiresPermission;
import com.scaffold.system.service.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
@RestController
@RequestMapping("/api/workproof/analysis")
public class AiAnalysisController{
    private final AiAnalysisService analysis;private final AuthService auth;
    public AiAnalysisController(AiAnalysisService analysis,AuthService auth){this.analysis=analysis;this.auth=auth;}
    @GetMapping("/capabilities") @RequiresPermission("workproof:analysis:run")
    public R<Map<String,Object>> capabilities(){return R.success(analysis.capabilities());}
    @PostMapping(value="/tasks/{engine}/{format}",consumes="application/octet-stream") @RequiresPermission("workproof:analysis:run")
    @OperLog(module="AI辅助分析",action="提交文档",recordParams=false)
    public R<Map<String,Object>> submit(@PathVariable String engine,@PathVariable String format,@RequestParam(defaultValue="false") boolean consent,HttpServletRequest request)throws Exception{if(!consent)throw new BusinessException("请先确认同意发送文档进行辅助分析。");return R.success(analysis.submit(auth.currentUser().userId(),engine,format,request.getInputStream()));}
    @GetMapping("/tasks/{id}") @RequiresPermission("workproof:analysis:run")
    public R<Map<String,Object>> status(@PathVariable String id){return R.success(analysis.status(auth.currentUser().userId(),id));}
    @DeleteMapping("/tasks/{id}") @RequiresPermission("workproof:analysis:run") @OperLog(module="AI辅助分析",action="取消分析",recordParams=false)
    public R<Map<String,Object>> cancel(@PathVariable String id){return R.success(analysis.cancel(auth.currentUser().userId(),id));}
}
