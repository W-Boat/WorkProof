import type {TimestampResult} from './timestamps';

export type TimestampJob={action:'generate';signature:string}|{action:'verify';signature:string;files:[File,File,File]};
export type TimestampReply={ok:true;value:ArrayBuffer|TimestampResult}|{ok:false;message:string};

/** A fresh, disposable worker keeps ASN.1 parsing off the UI thread. */
function run(job:TimestampJob,signal:AbortSignal):Promise<ArrayBuffer|TimestampResult>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('已取消','AbortError'));return;}
    let worker:Worker;
    try{worker=new Worker(new URL('./timestamp-worker.ts',import.meta.url),{type:'module'});}
    catch{reject(new Error('时间检查工具无法启动，请重新加载完整站点。'));return;}
    let finished=false;
    const finish=(error:Error|null,value?:ArrayBuffer|TimestampResult)=>{
      if(finished)return;finished=true;clearTimeout(deadline);
      signal.removeEventListener('abort',abort);worker.terminate();
      if(error)reject(error);else resolve(value!);
    };
    const abort=()=>finish(new DOMException('已取消','AbortError'));
    const deadline=setTimeout(()=>finish(new Error('时间检查耗时过长，已停止。请核对文件，或换用更快的设备重试。')),15000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data}:MessageEvent<TimestampReply>)=>{
      if(data.ok)finish(null,data.value);else finish(new Error(data.message));
    };
    worker.onerror=event=>{event.preventDefault();finish(new Error('时间检查工具无法加载，请重新加载完整站点。'));};
    worker.onmessageerror=()=>finish(new Error('时间检查结果无法读取，请重试。'));
    try{worker.postMessage(job);}catch{finish(new Error('时间文件无法读取，请重新选择文件。'));}
  });
}
export async function createTimestampRequestInWorker(signature:string,signal:AbortSignal){
  return await run({action:'generate',signature},signal) as ArrayBuffer;
}
export async function verifyTimestampInWorker(signature:string,files:[File,File,File],signal:AbortSignal){
  return await run({action:'verify',signature,files},signal) as TimestampResult;
}
