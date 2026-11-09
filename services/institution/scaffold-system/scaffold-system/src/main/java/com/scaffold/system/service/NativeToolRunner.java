package com.scaffold.system.service;

import com.scaffold.common.exception.BusinessException;
import com.scaffold.common.exception.ServiceException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;

/** Bounded, disk-free native calls. Callers supply only administrator-controlled arguments. */
final class NativeToolRunner implements AutoCloseable {
    private final Semaphore slots=new Semaphore(2);
    private final Set<Process> active=ConcurrentHashMap.newKeySet();
    private final ExecutorService workers=new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(2),r->{Thread t=new Thread(r,"workproof-native-tool");t.setDaemon(true);return t;});
    byte[] run(Path executable,List<String> arguments,InputStream input,int inputLimit,int outputLimit){
        if(!slots.tryAcquire())throw new ServiceException(429,"正在处理其他证据，请稍后重试。");
        Process child=null;Future<byte[]> task=null;
        try{
            byte[] proof=input.readNBytes(inputLimit+1);
            if(proof.length>inputLimit)throw new BusinessException("证书超过 32 MB，请先在本机导出部分记录后重试。");
            List<String> command=new ArrayList<>();command.add(executable.toString());command.addAll(arguments);
            ProcessBuilder builder=new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.environment().clear();builder.environment().put("PATH","/usr/bin:/bin");
            for(String name:List.of("SystemRoot","WINDIR")){String value=System.getenv(name);if(value!=null)builder.environment().put(name,value);}
            child=builder.start();active.add(child);Process process=child;
            task=workers.submit(()->{try(var stdin=process.getOutputStream()){stdin.write(proof);}byte[] output;try(var stdout=process.getInputStream()){output=stdout.readNBytes(outputLimit+1);}if(output.length>outputLimit||process.waitFor()!=0)throw new IllegalStateException("NATIVE_TOOL_FAILED");return output;});
            return task.get(15,TimeUnit.SECONDS);
        }catch(BusinessException error){throw error;}
        catch(TimeoutException error){throw new ServiceException(504,"处理用时过长，请稍后重试，或先导出部分记录。");}
        catch(InterruptedException error){Thread.currentThread().interrupt();throw new ServiceException(503,"处理已中断，请重试。");}
        catch(Exception error){throw new ServiceException(503,"原生工具未能完成处理，请联系管理员检查配置。");}
        finally{if(child!=null){if(child.isAlive())child.destroyForcibly();active.remove(child);}if(task!=null&&!task.isDone())task.cancel(true);slots.release();}
    }
    @Override public void close(){active.forEach(Process::destroyForcibly);workers.shutdownNow();}
}
