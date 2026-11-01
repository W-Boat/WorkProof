import type { HttpClient } from './http'
import type { PageResult } from './system'

export interface CertificateEntry {
  id: number; fileName: string; scope: 'full' | 'selective'; certificateId: string; proofHash: string
  disclosedEvents: number; totalEvents: number; createBy: string; checkedAt: string; demo: number
  artifactChecked: false; identityVerified: false; timeVerified: false
}

/** 机构证书内容检查；不读取或核对作品文件。 */
export interface CertificateCapabilities {
  configured: boolean // 管理员是否已配置本机检查工具
  maxProofBytes: number // 单份证书大小上限（字节）
  maxConcurrent: number // 同时处理的数量上限
  artifactChecked: false // 此接口不核对作品
  identityVerified: false // 此接口不认证身份
  message: string // 可读的准备状态说明
}
export interface CertificateInspection {
  protocol: 'workproof-inspection/1' // 检查结果格式版本
  certificate_valid: boolean // 证书内部内容是否一致，不表示作品通过
  artifact_checked: false // 未读取作品文件
  identity_verified: false // 未认证签名者身份
  time_verified: false // 未确认实际创作时间
  signature_valid: boolean // 签名是否一致
  chain_valid: boolean // 是否检查并通过完整记录链
  merkle_valid: boolean | null // 所选记录归属或完整集合是否一致
  scope: 'full' | 'selective' | 'unknown' // 全部记录、部分记录或无法识别
  disclosed_events: number // 本次提交的记录数量
  total_events: number // 签名中声明的总记录数量
  errors: string[] // 内部错误码；默认界面使用可读说明
  certificateId: string | null // SHA-256 证书指纹
  manifest: {file_name: string; source: string; demo: boolean} | null // 有界的签名清单摘要
}
export function createCertificateApi(client: HttpClient) {
  return {
    status: () => client.get<{enabled:boolean; schemaPrepared:boolean; ready:boolean; message:string}>('/workproof/certificates/status'),
    list: (query: import('./http').QueryParams) => client.get<PageResult<CertificateEntry>>('/workproof/certificates', query),
    detail: (id: number) => client.get<CertificateEntry>(`/workproof/certificates/${id}`),
    export: (query: import('./http').QueryParams) => client.download('/workproof/certificates/export', query),
    save: (proof: Blob, signal?: AbortSignal) => client.postRawJson<{entry: CertificateEntry; inspection: CertificateInspection}>('/workproof/certificates', proof, signal),
    capabilities: () => client.get<CertificateCapabilities>('/workproof/certificates/capabilities'),
    inspect: (proof: Blob, signal?: AbortSignal) => client.postRawJson<CertificateInspection>('/workproof/certificates/inspect', proof, signal),
  }
}
