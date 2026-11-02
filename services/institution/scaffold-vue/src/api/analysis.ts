import type {HttpClient} from './http'
export interface AnalysisCapabilities{maxBytes:number;engines:{id:string;label:string;configured:boolean}[];message:string}
export interface AnalysisTask{id:string;state:string;report?:{protocol:string;status:string;artifact_hash:string;engine_id:string;model:string;model_revision:string;network_used:false;scope:string;message:string;score_kind?:'uncalibrated_class_softmax'|'uncalibrated_binary_sigmoid';calibration?:null;raw_scores?:Record<string,number>}}
export function createAnalysisApi(client:HttpClient){return {
  capabilities:()=>client.get<AnalysisCapabilities>('/workproof/analysis/capabilities'),
  submit:(file:File,engine:string,format:string,signal?:AbortSignal)=>client.postBinary<AnalysisTask>(`/workproof/analysis/tasks/${encodeURIComponent(engine)}/${encodeURIComponent(format)}?consent=true`,file,signal),
  status:(id:string)=>client.get<AnalysisTask>(`/workproof/analysis/tasks/${encodeURIComponent(id)}`),
  cancel:(id:string)=>client.delete<AnalysisTask>(`/workproof/analysis/tasks/${encodeURIComponent(id)}`),
}}
