package com.scaffold.system.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.scaffold.common.exception.*;
import com.scaffold.framework.security.PermissionResolver;
import com.scaffold.framework.audit.OperationLogRecorder;
import com.scaffold.framework.audit.OperationLogEntry;
import com.scaffold.system.mapper.AuthMapper;
import com.scaffold.system.mapper.CertificateCatalogMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import javax.sql.DataSource;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.nio.file.*;
import java.security.*;
import java.sql.Connection;
import java.util.*;
import java.util.concurrent.*;

/** Single-instance durable V4 queue. Original inputs live only in an explicit private spool. */
@Service
public class CertificateJobService {
    static final long MAX_TOTAL=64L*1024*1024;
    private final boolean enabled,catalogEnabled;private final String folder;private final OperationLogRecorder audit;
    private final JdbcTemplate db;private final TransactionTemplate tx;private final DataSource source;
    private final AuthService auth;private final AuthMapper users;private final PermissionResolver permissions;
    private final CertificateCatalogService catalog;private final CertificateCatalogMapper summaries;private final NativeCertificateInspector inspector;
    private ScheduledExecutorService worker;private volatile boolean stopping;private volatile Thread executing;private volatile String executingJob;
    private Path spool;private FileChannel lockFile;private FileLock directoryLock;private Connection queueLock;private String lockName;private long lockOwner;
    public CertificateJobService(@Value("${workproof.jobs.enabled:false}") boolean enabled,@Value("${workproof.jobs.spool:}") String folder,@Value("${workproof.catalog.enabled:false}") boolean catalogEnabled,OperationLogRecorder audit,
            JdbcTemplate db,PlatformTransactionManager manager,DataSource source,AuthService auth,AuthMapper users,PermissionResolver permissions,
            CertificateCatalogService catalog,CertificateCatalogMapper summaries,NativeCertificateInspector inspector){
        this.enabled=enabled;this.folder=folder;this.catalogEnabled=catalogEnabled;this.audit=audit;this.db=db;this.tx=new TransactionTemplate(manager);this.source=source;
        this.auth=auth;this.users=users;this.permissions=permissions;this.catalog=catalog;this.summaries=summaries;this.inspector=inspector;
    }
    @PostConstruct void start(){if(enabled){worker=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"workproof-certificate-jobs");t.setDaemon(true);return t;});worker.scheduleWithFixedDelay(this::tick,1,2,TimeUnit.SECONDS);}}
    private boolean schema(){try{
        db.queryForList("SELECT id,owner_user_id,dept_id,owner_name,client_key,state,cancel_requested,expected_items,total_bytes,manifest_hash,create_by,update_by,create_time,update_time FROM wp_certificate_job LIMIT 0");
        db.queryForList("SELECT job_id,item_index,spool_token,proof_hash,proof_bytes,state,claim_token,attempts,entry_id,result_code,cleanup_state,create_by,update_by,create_time,update_time FROM wp_certificate_job_item LIMIT 0");
        return index("wp_certificate_job","PRIMARY",List.of("id"))&&index("wp_certificate_job","uk_wp_job_owner_key",List.of("owner_user_id","client_key"))&&index("wp_certificate_job_item","PRIMARY",List.of("job_id","item_index"))&&index("wp_certificate_job_item","uk_wp_job_spool",List.of("spool_token"));
    }catch(RuntimeException e){return false;}}
    private boolean index(String table,String name,List<String> columns){
        var rows=db.queryForList("SELECT column_name,non_unique,sub_part FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=? ORDER BY seq_in_index",table,name);
        if(rows.size()!=columns.size())return false;
        for(int i=0;i<rows.size();i++)if(!columns.get(i).equals(rows.get(i).get("column_name"))||number(rows.get(i),"non_unique")!=0||rows.get(i).get("sub_part")!=null)return false;return true;
    }
    private void event(String action,String username,boolean success){audit.record(new OperationLogEntry("证书后台任务",action,"BACKGROUND","/internal/certificate-jobs","[]",username,null,0,success?1:0,null));}
    public synchronized Map<String,Object> capabilities(){boolean ready=enabled&&schema()&&(catalogEnabled&&summaries.schemaReady())&&spool!=null&&held();return Map.of("ready",ready,"enabled",enabled,"maxFiles",20,"maxFileBytes",NativeCertificateInspector.MAX_PROOF_BYTES,"maxTotalBytes",MAX_TOTAL,"message",ready?"上传全部证书并提交后，关闭页面也会继续处理；结果只对提交账号可见。":"后台批量任务尚未准备好，请联系管理员核对 V4、私有目录及检查工具；原证书功能可继续使用。");}
    private void requireReady(){try{if(spool!=null)PrivateJobSpool.verify(spool,true);}catch(IOException invalid){release();}if(!Boolean.TRUE.equals(capabilities().get("ready")))throw new ServiceException(503,"后台批量任务尚未准备好，请联系管理员。");}
    static String uuid(String value){try{String parsed=UUID.fromString(value).toString();if(!parsed.equals(value))throw new IllegalArgumentException();return parsed;}catch(Exception e){throw new BusinessException("任务编号格式不正确。");}}
    private long owner(){return auth.currentUser().userId();}
    private Map<String,Object> owned(String id,long user){var rows=db.queryForList("SELECT * FROM wp_certificate_job WHERE id=? AND owner_user_id=?",uuid(id),user);if(rows.isEmpty())throw new BusinessException(404,"找不到这项任务。");return rows.get(0);}
    private static long number(Map<String,Object> row,String key){return ((Number)row.get(key)).longValue();}
    private boolean permitted(Map<String,Object> job){String name=(String)job.get("owner_name");var user=users.selectUserByUsername(name);return user!=null&&user.getId()==number(job,"owner_user_id")&&permissions.hasPermission(name,"workproof:certificate:add")&&permissions.hasPermission(name,"workproof:certificate:list");}
    public synchronized Map<String,Object> create(String key,boolean consent,int expectedItems){
        requireReady();if(!consent)throw new BusinessException("请先同意发送证书并保存摘要。");uuid(key);if(expectedItems<1||expectedItems>20)throw new BusinessException("一次需选择 1 至 20 份证书。");var user=auth.currentUser();if(!permissions.hasPermission(user.username(),"workproof:certificate:list"))throw new BusinessException(403,"没有查询任务的权限。");
        var existing=db.queryForList("SELECT id,expected_items FROM wp_certificate_job WHERE owner_user_id=? AND client_key=?",user.userId(),key);
        if(!existing.isEmpty()){if(number(existing.get(0),"expected_items")!=expectedItems)throw new BusinessException(409,"这个提交编号已经用于不同数量的证书。");return detail((String)existing.get(0).get("id"));}
        if(db.queryForObject("SELECT COUNT(*) FROM wp_certificate_job WHERE state IN ('draft','queued','running','cleanup_failed')",Integer.class)>=8||db.queryForObject("SELECT COUNT(*) FROM wp_certificate_job WHERE owner_user_id=? AND state IN ('draft','queued','running','cleanup_failed')",Integer.class,user.userId())>=4)throw new ServiceException(429,"待处理任务较多，请先等待或取消已有任务。");
        String id=UUID.randomUUID().toString();
        db.update("INSERT INTO wp_certificate_job(id,owner_user_id,dept_id,owner_name,client_key,expected_items,create_by,update_by) VALUES(?,?,?,?,?,?,?,?)",id,user.userId(),user.deptId(),user.username(),key,expectedItems,user.username(),user.username());
        return detail(id);
    }
    private Path path(String token,String suffix){return spool.resolve(uuid(token)+suffix);}
    private static void privatePermissions(Path path,boolean directory)throws IOException{PrivateJobSpool.seal(path,directory);}
    public synchronized Map<String,Object> upload(String id,int index,InputStream input)throws Exception{
        requireReady();long user=owner();var job=owned(id,user);if(!"draft".equals(job.get("state"))||number(job,"cancel_requested")!=0)throw new BusinessException(409,"任务已提交或取消，不能再添加证书。");
        if(index<0||index>=number(job,"expected_items"))throw new BusinessException("一次最多上传 20 份证书。");
        String token=UUID.randomUUID().toString();Path temporary=path(token,".tmp"),finalPath=path(token,".proof");boolean retained=false;
        try{
            PrivateJobSpool.createFile(temporary);long bytes=0;MessageDigest hash=MessageDigest.getInstance("SHA-256");
            try(var channel=FileChannel.open(temporary,StandardOpenOption.WRITE)){byte[] block=new byte[65536];for(int count;(count=input.read(block))!=-1;){bytes+=count;if(bytes>NativeCertificateInspector.MAX_PROOF_BYTES)throw new BusinessException("每份证书最多 32 MB。");hash.update(block,0,count);ByteBuffer buffer=ByteBuffer.wrap(block,0,count);while(buffer.hasRemaining())channel.write(buffer);}channel.force(true);}
            String digest=HexFormat.of().formatHex(hash.digest());var old=db.queryForList("SELECT proof_hash,proof_bytes FROM wp_certificate_job_item WHERE job_id=? AND item_index=?",id,index);
            if(!old.isEmpty()){if(!digest.equals(old.get(0).get("proof_hash"))||bytes!=number(old.get(0),"proof_bytes"))throw new BusinessException(409,"这个序号已经上传过不同证书，请新建任务。");return detail(id);}
            if(number(job,"total_bytes")+bytes>MAX_TOTAL)throw new BusinessException("这一批证书合计最多 64 MB。");
            Files.move(temporary,finalPath,StandardCopyOption.ATOMIC_MOVE);privatePermissions(finalPath,false);final long length=bytes;
            tx.executeWithoutResult(status->{db.update("INSERT INTO wp_certificate_job_item(job_id,item_index,spool_token,proof_hash,proof_bytes,create_by,update_by) VALUES(?,?,?,?,?,?,?)",id,index,token,digest,length,job.get("owner_name"),job.get("owner_name"));db.update("UPDATE wp_certificate_job SET total_bytes=total_bytes+? WHERE id=?",length,id);});retained=true;return detail(id);
        }finally{Files.deleteIfExists(temporary);if(!retained)Files.deleteIfExists(finalPath);}
    }
    public synchronized Map<String,Object> submit(String id){requireReady();var job=owned(id,owner());if(!"draft".equals(job.get("state")))return detail(id);
        var items=db.queryForList("SELECT item_index,proof_hash,proof_bytes FROM wp_certificate_job_item WHERE job_id=? ORDER BY item_index",id);if(items.size()!=number(job,"expected_items"))throw new BusinessException("上传尚未完整，请上传全部所选证书后提交。");
        StringBuilder manifest=new StringBuilder();for(int i=0;i<items.size();i++){var row=items.get(i);if(number(row,"item_index")!=i)throw new BusinessException("上传尚未完整，请补齐缺少的证书后提交。");manifest.append(i).append(':').append(row.get("proof_hash")).append(':').append(row.get("proof_bytes")).append('\n');}
        String hash;try{hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(manifest.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}
        db.update("UPDATE wp_certificate_job SET state='queued',manifest_hash=? WHERE id=? AND state='draft' AND cancel_requested=0",hash,id);return detail(id);
    }
    public synchronized Map<String,Object> cancel(String id){requireReady();owned(id,owner());db.update("UPDATE wp_certificate_job SET cancel_requested=1 WHERE id=? AND state IN ('draft','queued','running','cleanup_failed')",id);if(id.equals(executingJob)&&executing!=null)executing.interrupt();return detail(id);}
    public synchronized Map<String,Object> detail(String id){requireReady();var job=owned(id,owner());return publicJob(job,true);}
    public synchronized List<Map<String,Object>> list(){requireReady();return db.queryForList("SELECT * FROM wp_certificate_job WHERE owner_user_id=? ORDER BY create_time DESC,id DESC LIMIT 100",owner()).stream().map(row->publicJob(row,false)).toList();}
    private Map<String,Object> publicJob(Map<String,Object> row,boolean ignored){
        Map<String,Object> result=new LinkedHashMap<>();String id=(String)row.get("id");
        result.put("id",id);result.put("state",row.get("state"));result.put("cancelRequested",number(row,"cancel_requested")!=0);result.put("totalBytes",row.get("total_bytes"));result.put("createdAt",String.valueOf(row.get("create_time")));result.put("expectedItems",row.get("expected_items"));
        List<Map<String,Object>> items=new ArrayList<>();int completed=0;
        for(var item:db.queryForList("SELECT item_index,state,entry_id,result_code,cleanup_state FROM wp_certificate_job_item WHERE job_id=? ORDER BY item_index",id)){
            Map<String,Object> value=new LinkedHashMap<>();String state=(String)item.get("state");
            value.put("index",item.get("item_index"));value.put("state",state);value.put("catalogId",item.get("entry_id"));value.put("cleanupState",item.get("cleanup_state"));
            String code=(String)item.get("result_code");value.put("message",code==null?"等待后台检查。":switch(code){case "SAVED"->"内容一致，摘要已保存；不确认作品、身份或实际时间。";case "CANCELLED"->"已取消；此前保存的摘要仍然保留。";case "PERMISSION_REVOKED"->"提交账号权限发生变化，未继续处理。";case "INVALID_CERTIFICATE"->"证书内容未能确认，没有保存。";default->"本项未能完成，请核对原始证书或联系管理员。";});
            if(!Set.of("queued","running").contains(state))completed++;items.add(value);
        }
        result.put("items",items);result.put("totalItems",items.size());result.put("completedItems",completed);result.put("cleanupPending",items.stream().anyMatch(item->!"deleted".equals(item.get("cleanupState"))));return result;
    }

    private boolean held(){try{if(queueLock==null||queueLock.isClosed()||!queueLock.isValid(1)||directoryLock==null||!directoryLock.isValid())return false;try(var statement=queueLock.prepareStatement("SELECT IS_USED_LOCK(?)")){statement.setString(1,lockName);try(var rows=statement.executeQuery()){return rows.next()&&rows.getLong(1)==lockOwner&&!rows.wasNull();}}}catch(Exception e){return false;}}
    private synchronized boolean initialize()throws Exception{
        if(held()){try{PrivateJobSpool.verify(spool,true);}catch(IOException invalid){release();throw invalid;}return true;}if(queueLock!=null||directoryLock!=null)release();
        if(!schema()||!(catalogEnabled&&summaries.schemaReady())||!Boolean.TRUE.equals(inspector.capabilities().get("configured")))return false;
        Path root=Path.of(folder);if(!root.isAbsolute()||Files.isSymbolicLink(root))return false;
        if(Files.exists(root,LinkOption.NOFOLLOW_LINKS))PrivateJobSpool.verify(root,true);
        else{Files.createDirectories(root.getParent());PrivateJobSpool.createDirectory(root);}spool=root.toRealPath();
        Path lockPath=spool.resolve(".queue.lock");if(Files.exists(lockPath,LinkOption.NOFOLLOW_LINKS))PrivateJobSpool.verify(lockPath,false);else PrivateJobSpool.createFile(lockPath);
        lockFile=FileChannel.open(lockPath,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);directoryLock=lockFile.tryLock();if(directoryLock==null){lockFile.close();lockFile=null;spool=null;return false;}
        queueLock=source.getConnection();try(var statement=queueLock.createStatement();var rs=statement.executeQuery("SELECT CONCAT('wpjobs:',LEFT(SHA2(DATABASE(),256),40)),CONNECTION_ID()")){rs.next();lockName=rs.getString(1);lockOwner=rs.getLong(2);}
        try(var statement=queueLock.prepareStatement("SELECT GET_LOCK(?,0)")){statement.setString(1,lockName);try(var rs=statement.executeQuery()){rs.next();if(rs.getInt(1)!=1){release();return false;}}}
        // This exclusive database+directory lock supports one active queue instance.
        db.update("UPDATE wp_certificate_job_item SET state='queued',claim_token=NULL WHERE state='running'");
        db.update("UPDATE wp_certificate_job SET state='queued' WHERE state='running'");event("队列锁定与恢复",null,true);return true;
    }
    private void tick(){if(stopping)return;try{
        if(!initialize())return;
        db.update("UPDATE wp_certificate_job SET cancel_requested=1 WHERE state='draft' AND create_time<DATE_SUB(NOW(),INTERVAL 1 HOUR)");
        cleanup();
        var candidates=db.queryForList("SELECT * FROM wp_certificate_job WHERE state IN ('queued','running') OR (state='draft' AND cancel_requested=1) ORDER BY create_time,id LIMIT 1");
        if(candidates.isEmpty())return;var job=candidates.get(0);String id=(String)job.get("id");
        if(number(job,"cancel_requested")!=0||!permitted(job)){db.update("UPDATE wp_certificate_job_item SET state='cancelled',result_code=?,cleanup_state='pending' WHERE job_id=? AND state='queued'",number(job,"cancel_requested")!=0?"CANCELLED":"PERMISSION_REVOKED",id);finish(id);return;}
        var rows=db.queryForList("SELECT * FROM wp_certificate_job_item WHERE job_id=? AND state='queued' ORDER BY item_index LIMIT 1",id);if(rows.isEmpty()){finish(id);return;}
        var item=rows.get(0);String claim=UUID.randomUUID().toString();int index=(int)number(item,"item_index");
        tx.executeWithoutResult(status->{db.update("UPDATE wp_certificate_job SET state='running' WHERE id=?",id);db.update("UPDATE wp_certificate_job_item SET state='running',claim_token=?,attempts=attempts+1 WHERE job_id=? AND item_index=? AND state='queued'",claim,id,index);});
        executingJob=id;executing=Thread.currentThread();
        try{
            Path input=path((String)item.get("spool_token"),".proof");if(Files.isSymbolicLink(input)||!Files.isRegularFile(input)||Files.size(input)!=number(item,"proof_bytes")||!hash(input).equals(item.get("proof_hash")))throw new IOException("SPOOL_CHANGED");
            PrivateJobSpool.verify(input,false);
            JsonNode report;try(var stream=Files.newInputStream(input,LinkOption.NOFOLLOW_LINKS)){report=inspector.inspect(stream);}
            complete(job,index,claim,item,report,null);
        }catch(Exception e){Thread.interrupted();if(!stopping)complete(job,index,claim,item,null,"CHECK_FAILED");}
        finally{executing=null;executingJob=null;Thread.interrupted();}
        cleanup();finish(id);
    }catch(Exception ignored){if(!held())release();else try{db.update("UPDATE wp_certificate_job_item SET state='queued',claim_token=NULL WHERE state='running'");db.update("UPDATE wp_certificate_job SET state='queued' WHERE state='running'");}catch(RuntimeException unavailable){}/* No input, path or credential text in logs. */}}
    private void complete(Map<String,Object> original,int index,String claim,Map<String,Object> item,JsonNode report,String error){
        tx.executeWithoutResult(status->{String id=(String)original.get("id");var job=db.queryForMap("SELECT * FROM wp_certificate_job WHERE id=? FOR UPDATE",id);
            var current=db.queryForMap("SELECT state,claim_token FROM wp_certificate_job_item WHERE job_id=? AND item_index=? FOR UPDATE",id,index);
            if(!"running".equals(current.get("state"))||!claim.equals(current.get("claim_token")))return;
            // Guard commits against an old instance after its dedicated DB lock is lost.
            Long holder=db.queryForObject("SELECT IS_USED_LOCK(?)",Long.class,lockName);if(holder==null||holder!=lockOwner)throw new IllegalStateException("QUEUE_LOCK_LOST");
            String state="failed",code=error;Long entry=null;
            if(number(job,"cancel_requested")!=0){state="cancelled";code="CANCELLED";}
            else if(!permitted(job)){state="cancelled";code="PERMISSION_REVOKED";}
            else if(report!=null&&report.path("certificate_valid").asBoolean()){
                Long dept=job.get("dept_id")==null?null:number(job,"dept_id");var summary=CertificateSummaryFactory.row(report,(String)item.get("proof_hash"),number(job,"owner_user_id"),dept,(String)job.get("owner_name"));summaries.insert(summary);entry=((Number)summary.get("id")).longValue();state="saved";code="SAVED";
            }else if(report!=null)code="INVALID_CERTIFICATE";
            db.update("UPDATE wp_certificate_job_item SET state=?,entry_id=?,result_code=?,cleanup_state='pending' WHERE job_id=? AND item_index=? AND claim_token=?",state,entry,code,id,index,claim);event("后台子项完成",(String)job.get("owner_name"),state.equals("saved"));
        });
    }
    private synchronized void cleanup()throws IOException{
        for(var item:db.queryForList("SELECT job_id,item_index,spool_token FROM wp_certificate_job_item WHERE cleanup_state IN ('pending','error') LIMIT 160")){
            String state="deleted";try{Files.deleteIfExists(path((String)item.get("spool_token"),".proof"));}catch(IOException e){state="error";}
            db.update("UPDATE wp_certificate_job_item SET cleanup_state=? WHERE job_id=? AND item_index=?",state,item.get("job_id"),item.get("item_index"));
            if(state.equals("error"))db.update("UPDATE wp_certificate_job SET state='cleanup_failed' WHERE id=?",item.get("job_id"));else finish((String)item.get("job_id"));
        }
        // Only UUID-named own spool files; no recursive delete or arbitrary database paths.
        try(var files=Files.list(spool)){for(Path file:files.toList()){String name=file.getFileName().toString();if(!name.matches("[0-9a-f-]{36}\\.(tmp|proof)")||Files.isSymbolicLink(file))continue;if(Files.getLastModifiedTime(file).toMillis()>System.currentTimeMillis()-3600000)continue;String token=name.substring(0,36);if(db.queryForObject("SELECT COUNT(*) FROM wp_certificate_job_item WHERE spool_token=? AND cleanup_state<>'deleted'",Integer.class,token)==0)Files.deleteIfExists(file);}}
    }
    private void finish(String id){
        var items=db.queryForList("SELECT state,cleanup_state FROM wp_certificate_job_item WHERE job_id=?",id);
        if(items.stream().anyMatch(row->Set.of("queued","running").contains(row.get("state")))){db.update("UPDATE wp_certificate_job SET state='queued' WHERE id=? AND state='cleanup_failed' AND NOT EXISTS(SELECT 1 FROM wp_certificate_job_item WHERE job_id=? AND cleanup_state='error')",id,id);return;}
        if(items.stream().anyMatch(row->!"deleted".equals(row.get("cleanup_state"))))return;
        var job=db.queryForMap("SELECT cancel_requested,state,owner_name FROM wp_certificate_job WHERE id=?",id);if(Set.of("completed","partial","cancelled").contains(job.get("state")))return;
        String state=number(job,"cancel_requested")!=0?"cancelled":items.stream().allMatch(row->"saved".equals(row.get("state")))?"completed":"partial";
        tx.executeWithoutResult(status->{db.update("UPDATE wp_certificate_job SET state=? WHERE id=?",state,id);event(state.equals("cancelled")?"后台任务已取消":"后台任务结束",(String)job.get("owner_name"),state.equals("completed"));});
    }
    private static String hash(Path path)throws Exception{MessageDigest hash=MessageDigest.getInstance("SHA-256");try(var input=Files.newInputStream(path)){byte[] bytes=new byte[65536];for(int count;(count=input.read(bytes))!=-1;)hash.update(bytes,0,count);}return HexFormat.of().formatHex(hash.digest());}
    private synchronized void release(){try{if(queueLock!=null){try{if(lockName!=null)try(var query=queueLock.prepareStatement("SELECT RELEASE_LOCK(?)")){query.setString(1,lockName);query.execute();}}finally{queueLock.close();}}}catch(Exception ignored){}queueLock=null;try{if(directoryLock!=null)directoryLock.release();if(lockFile!=null)lockFile.close();}catch(IOException ignored){}directoryLock=null;lockFile=null;spool=null;}
    @PreDestroy public void close(){stopping=true;if(worker!=null){worker.shutdownNow();try{worker.awaitTermination(20,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}}release();}
}
