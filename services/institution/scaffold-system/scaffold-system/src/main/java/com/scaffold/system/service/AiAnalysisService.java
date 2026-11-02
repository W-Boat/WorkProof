package com.scaffold.system.service;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.scaffold.common.exception.ServiceException;
import com.scaffold.common.exception.BusinessException;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Optional institution analysis. Private temporary input; no content in audit or task results. */
@Service
public class AiAnalysisService {
    public static final int MAX_BYTES=8*1024*1024;
    private record Engine(String label,String language,String model,String revision,String scoreKind){}
    private static final Map<String,Engine> ENGINES=Map.of(
        "mpu-zh-v3",new Engine("中文 MPU v3","zh","yuchuantian/AIGC_detector_zhv3","47695ff451b32c225dd938f4f478f7fdc6aa6bb0","uncalibrated_class_softmax"),
        "mpu-en-v3",new Engine("英文 MPU v3","en","yuchuantian/AIGC_detector_env3","3ceb1d1bb7b9ca11585ce3f4299950e1c465b6d8","uncalibrated_class_softmax"),
        "desklib-en-v1.01",new Engine("英文 Desklib v1.01","en","desklib/ai-text-detector-v1.01","5fdea974cd4287c61674951ec78803aa274e2fb7","uncalibrated_binary_sigmoid"));
    private final String python,script,models;
    private final boolean enabled;
    private final ObjectMapper mapper;
    private final Semaphore slot=new Semaphore(1);
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"workproof-ai");t.setDaemon(true);return t;});
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"workproof-ai-deadline");t.setDaemon(true);return t;});
    private final ConcurrentMap<String,Job> jobs=new ConcurrentHashMap<>();
    public AiAnalysisService(@Value("${workproof.ai.enabled:false}") boolean enabled,
        @Value("${workproof.ai.python:}") String python,@Value("${workproof.ai.script:}") String script,
        @Value("${workproof.ai.models:}") String models,ObjectMapper mapper){
        this.enabled=enabled;this.python=python;this.script=script;this.models=models;
        this.mapper=mapper.copy().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
        clock.scheduleAtFixedRate(this::cleanExpired,60,60,TimeUnit.SECONDS);
    }
    private Path absolute(String value){try{Path p=Path.of(value);return p.isAbsolute()?p:null;}catch(RuntimeException e){return null;}}
    private boolean ready(String engine){
        Path p=absolute(python),s=absolute(script),m=absolute(models);
        return enabled&&p!=null&&Files.isRegularFile(p)&&Files.isExecutable(p)&&s!=null&&Files.isRegularFile(s)
            &&s.getFileName().toString().equals("detector.py")&&m!=null&&Files.isRegularFile(m.resolve(engine).resolve("workproof-model.json"));
    }
    public Map<String,Object> capabilities(){return Map.of("maxBytes",MAX_BYTES,"maxConcurrent",1,"retentionMinutes",10,
        "engines",List.of("mpu-zh-v3","mpu-en-v3","desklib-en-v1.01").stream().map(id->{Engine e=ENGINES.get(id);return Map.of("id",id,"label",e.label(),"language",e.language(),"model",e.model(),"model_revision",e.revision(),"score_kind",e.scoreKind(),"method_family","supervised_classifier","configured",ready(id));}).toList(),
        "message","仅作辅助参考。需要发送所选文档；分析后删除临时文件，不保存正文。模型准备状态不代表准确率或许可审查已完成。");}
    private void cleanExpired(){long cutoff=System.currentTimeMillis()-600000;jobs.entrySet().removeIf(e->e.getValue().finished&&e.getValue().created<cutoff);}
    public Map<String,Object> submit(long owner,String engine,String format,InputStream input)throws IOException{
        if(!ENGINES.containsKey(engine)||!Set.of("docx","txt","md").contains(format))throw new BusinessException("请选择支持的模型和 DOCX、TXT 或 Markdown 文件。");
        if(!ready(engine))throw new ServiceException(503,"所选模型尚未准备好，请联系管理员。");
        cleanExpired();if(jobs.size()>=16||!slot.tryAcquire())throw new ServiceException(429,"正在分析其他文档，请稍后重试。");
        Path file=null;
        try{
            byte[] bytes=input.readNBytes(MAX_BYTES+1);if(bytes.length>MAX_BYTES)throw new BusinessException("文档超过 8 MB，请选择较小的文件。");
            file=Files.createTempFile("workproof-ai-","."+format);
            try{Files.setPosixFilePermissions(file,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));}catch(UnsupportedOperationException ignored){}
            Files.write(file,bytes);
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            Job job=new Job(owner,engine,file,hash,bytes.length);jobs.put(job.id,job);worker.execute(job);return job.snapshot();
        }catch(Exception error){try{if(file!=null)Files.deleteIfExists(file);}finally{slot.release();}if(error instanceof ServiceException service)throw service;if(error instanceof BusinessException business)throw business;throw new ServiceException(503,"分析未能开始，请稍后重试。");}
    }
    private Job owned(long owner,String id){Job job=jobs.get(id);if(job==null||job.owner!=owner)throw new BusinessException(404,"找不到这项分析，请重新提交。");return job;}
    public Map<String,Object> status(long owner,String id){cleanExpired();return owned(owner,id).snapshot();}
    public Map<String,Object> cancel(long owner,String id){Job job=owned(owner,id);job.cancel();return job.snapshot();}
    private static void kill(Process process){if(process!=null){process.descendants().forEach(ProcessHandle::destroyForcibly);process.destroyForcibly();}}
    private class Job implements Runnable{
        final String id=UUID.randomUUID().toString(),engine,hash;final long owner,created=System.currentTimeMillis();final Path file;final int bytes;
        final AtomicBoolean cancelled=new AtomicBoolean(),timedOut=new AtomicBoolean();volatile boolean finished;volatile String state="queued";volatile Process child;volatile ObjectNode report;
        Job(long owner,String engine,Path file,String hash,int bytes){this.owner=owner;this.engine=engine;this.file=file;this.hash=hash;this.bytes=bytes;}
        synchronized void cancel(){if(!finished){cancelled.set(true);state="cancelling";kill(child);}}
        synchronized Map<String,Object> snapshot(){Map<String,Object> value=new LinkedHashMap<>();value.put("id",id);value.put("state",state);if(report!=null&&finished&&!state.equals("cleanup_failed"))value.put("report",report.deepCopy());return value;}
        public void run(){
            ScheduledFuture<?> deadline=null;
            try{
                synchronized(this){
                    if(cancelled.get())return;
                    ProcessBuilder command=new ProcessBuilder(python,script,"infer-file","--input-file",file.toString(),"--language",ENGINES.get(engine).language(),"--engine",engine,"--model-dir",Path.of(models).resolve(engine).toString()).redirectError(ProcessBuilder.Redirect.DISCARD);
                    command.environment().clear();command.environment().put("PATH","/usr/bin:/bin");
                    for(String key:List.of("SystemRoot","WINDIR")){String v=System.getenv(key);if(v!=null)command.environment().put(key,v);}
                    command.environment().put("HF_HUB_OFFLINE","1");command.environment().put("HF_HUB_DISABLE_TELEMETRY","1");
                    child=command.start();child.getOutputStream().close();state="running";
                }
                deadline=clock.schedule(()->{timedOut.set(true);kill(child);},120,TimeUnit.SECONDS);
                byte[] output=child.getInputStream().readNBytes(65537);if(output.length>65536)throw new IOException("OUTPUT_LIMIT");
                int exit=child.waitFor();JsonNode value=mapper.readTree(output);
                if(exit!=0||!"workproof-ai-assessment/1".equals(value.path("protocol").asText())||!engine.equals(value.path("engine_id").asText())||value.path("network_used").asBoolean(true)
                    ||!hash.equals(value.path("artifact_hash").asText())||value.path("artifact_bytes").asInt(-1)!=bytes)throw new IOException("INVALID_REPORT");
                Engine specification=ENGINES.get(engine);
                if(!specification.model().equals(value.path("model").asText())||!specification.revision().equals(value.path("model_revision").asText()))throw new IOException("UNEXPECTED_MODEL_VERSION");
                String result=value.path("status").asText();if(!Set.of("completed","unsupported","insufficient_input","not_configured").contains(result))throw new IOException("INVALID_STATUS");
                ObjectNode safe=mapper.createObjectNode();safe.put("status",result);safe.put("artifact_hash",hash);safe.put("engine_id",engine);
                safe.put("protocol","workproof-ai-assessment/1");safe.put("model",specification.model());safe.put("model_revision",specification.revision());safe.put("network_used",false);
                safe.put("scope",file.toString().endsWith(".docx")?"仅主文档源文字；不代表排版后的可见全文":"仅所选 UTF-8 文字");
                String reason=value.path("reason").asText();
                safe.put("message",switch(reason){
                    case "AT_LEAST_80_WORDS_OR_CHINESE_CHARACTERS_REQUIRED" -> "文字过短：中文至少需要 80 个汉字，英文至少需要 80 个单词。";
                    case "TEXT_EXCEEDS_512_TOKENS_NO_SILENT_TRUNCATION" -> "文字超过模型的单次处理长度，本次没有分析。请将要复核的段落另存为文本后重试，并保留完整作品。";
                    case "LANGUAGE_NOT_SUPPORTED_BY_SELECTED_ENGINE" -> "文档语言与所选模型不符，请更换模型。";
                    default -> result.equals("completed")?"模型已返回参考分数；没有确认作者身份或 AI 使用比例。":"本次没有完成分析，请核对模型准备状态、文档语言和长度。";
                });
                if(result.equals("completed")){
                    if(!specification.scoreKind().equals(value.path("score_kind").asText())||!value.path("calibration").isNull())throw new IOException("INVALID_SCORE_KIND");
                    safe.put("score_kind",specification.scoreKind());safe.putNull("calibration");
                    List<String> labels=List.of("Human","AI");ObjectNode scores=safe.putObject("raw_scores");double sum=0;
                    for(String label:labels){JsonNode v=value.path("raw_scores").path(label);double number=v.asDouble(Double.NaN);if(!v.isNumber()||!Double.isFinite(number)||number<0||number>1)throw new IOException("INVALID_SCORE");scores.put(label,number);sum+=number;}
                    if(Math.abs(sum-1)>0.0001)throw new IOException("INVALID_SCORE_SUM");
                }
                synchronized(this){if(!cancelled.get()&&!timedOut.get()){report=safe;state="finalizing";}}
            }catch(Exception ignored){state="failed";}
            finally{
                if(deadline!=null)deadline.cancel(false);kill(child);
                try{if(child!=null)child.waitFor(2,TimeUnit.SECONDS);Files.deleteIfExists(file);}catch(Exception ignored){state="cleanup_failed";}
                synchronized(this){if(!state.equals("cleanup_failed")){if(cancelled.get())state="cancelled";else if(timedOut.get())state="timeout";else if(state.equals("finalizing"))state="done";}finished=true;}
                slot.release();
            }
        }
    }
    @PreDestroy public void close(){jobs.values().forEach(Job::cancel);worker.shutdown();clock.shutdown();}
}
