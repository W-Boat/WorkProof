// Called only after an explicit user action with a freshly generated request.
export function timestampServiceUrl(value:string):string{
  let url:URL;try{url=new URL(value);}catch{throw new Error('时间服务地址无效，请填写完整的 HTTPS 地址。');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('时间服务须使用 HTTPS，地址中不能包含账号、密码或片段。');
  return url.href;
}
export async function sendTimestampRequest(address:string,query:ArrayBuffer,signal:AbortSignal):Promise<ArrayBuffer>{
  const url=timestampServiceUrl(address);
  if(query.byteLength===0||query.byteLength>8192)throw new Error('时间请求大小异常，已停止发送。');
  const response=await fetch(url,{method:'POST',body:query,headers:{'Content-Type':'application/timestamp-query','Accept':'application/timestamp-reply'},credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',mode:'cors',signal});
  async function rejectResponse(message:string):Promise<never>{await response.body?.cancel().catch(()=>{});throw new Error(message);}
  if(!response.ok)return rejectResponse('时间服务没有成功响应，请核对服务地址或使用手工提交。');
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/timestamp-reply')return rejectResponse('时间服务返回的文件类型不正确。');
  const limit=128*1024;
  if(Number(response.headers.get('content-length'))>limit)return rejectResponse('时间响应超过 128 KB，已停止接收。');
  const reader=response.body?.getReader();if(!reader)throw new Error('时间服务未返回响应文件。');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('时间响应超过 128 KB，已停止接收。');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!size)throw new Error('时间服务返回了空文件。');
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result.buffer;
}
