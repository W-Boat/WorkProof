export function wordOperation(action,data){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('word-worker.js',document.baseURI),{type:'module'});
    const done=(error,result)=>{clearTimeout(timeout);worker.terminate();error?reject(new Error(error)):resolve(result);};
    const timeout=setTimeout(()=>done('Word 转换超时，已停止本次操作。原文档仍保留。'),20000);
    worker.onmessage=event=>{if(event.data.ready){worker.postMessage({action,...data});return;}done(event.data.error,event.data.result);};worker.onerror=()=>done('Word 插件未能加载，请更新完整安装包。');
  });
}
