import type {HttpClient} from './http'
export interface AnalysisCapabilities{maxBytes:number;engines:{id:string;label:string;configured:boolean}[];message:string}
export interface AnalysisTask{id:string;state:string;report?:{status:string;artifact_hash:string;scope:string;message:string;raw_scores?:Record<string,number>}}
export function createAnalysisApi(client:HttpClient){return {
  capabilities:()=>client.get<AnalysisCapabilities>('/workproof/analysis/capabilities'),
  submit:(file:File,engine:string,format:string,signal?:AbortSignal)=>client.postBinary<AnalysisTask>(`/workproof/analysis/tasks/${encodeURIComponent(engine)}/${encodeURIComponent(format)}?consent=true`,file,signal),
  status:(id:string)=>client.get<AnalysisTask>(`/workproof/analysis/tasks/${encodeURIComponent(id)}`),
  cancel:(id:string)=>client.delete<AnalysisTask>(`/workproof/analysis/tasks/${encodeURIComponent(id)}`),
}}
