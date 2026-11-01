import {createTimestampRequest,verifyTimestamp} from './timestamps';
import type {TimestampJob,TimestampReply} from './timestamp-client';

const scope=globalThis as unknown as {onmessage:((event:MessageEvent<TimestampJob>)=>void)|null;postMessage:(reply:TimestampReply,transfer?:Transferable[])=>void};
scope.onmessage=async({data})=>{
  try{
    if(data.action==='generate'){
      const buffer=await createTimestampRequest(data.signature);
      scope.postMessage({ok:true,value:buffer},[buffer]);
    }else{
      const [query,response,ca]=data.files;
      if(query.size>8192||response.size>128*1024||ca.size>256*1024)throw new Error('时间文件过大：请求最多8 KB，响应最多128 KB，信任证书最多256 KB。');
      const value=await verifyTimestamp(data.signature,await query.arrayBuffer(),await response.arrayBuffer(),await ca.text());
      scope.postMessage({ok:true,value});
    }
  }catch(error){
    scope.postMessage({ok:false,message:error instanceof Error&&error.message.startsWith('时间')?error.message:'时间凭据未能通过检查，请核对文件与信任来源。'});
  }
};
