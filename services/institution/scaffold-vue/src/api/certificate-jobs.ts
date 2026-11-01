import {httpClient} from './http'
export interface CertificateJob{id:string;state:string;expectedItems:number;totalItems:number;completedItems:number;totalBytes:number;createdAt:string;cancelRequested:boolean;items:{index:number;state:string;catalogId?:number;message:string;cleanupState:string}[]}
export interface JobCapabilities{ready:boolean;message:string;maxFiles:number;maxFileBytes:number;maxTotalBytes:number}
const base='/workproof/certificate-jobs'
export const certificateJobsApi={
  capabilities:()=>httpClient.get<JobCapabilities>(base+'/capabilities'),
  list:()=>httpClient.get<CertificateJob[]>(base),
  detail:(id:string)=>httpClient.get<CertificateJob>(base+'/'+encodeURIComponent(id)),
  create:(clientKey:string,expectedItems:number)=>httpClient.post<CertificateJob>(base,{clientKey,expectedItems,consent:true}),
  upload:(id:string,index:number,file:File,signal:AbortSignal)=>httpClient.putBinary<CertificateJob>(`${base}/${encodeURIComponent(id)}/items/${index}`,file,signal),
  submit:(id:string)=>httpClient.post<CertificateJob>(`${base}/${encodeURIComponent(id)}/submit`),
  cancel:(id:string)=>httpClient.delete<CertificateJob>(base+'/'+encodeURIComponent(id)),
}
