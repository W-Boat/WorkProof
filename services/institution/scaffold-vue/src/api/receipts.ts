import type { HttpClient } from './http.ts'

export interface ReceiptCapabilities {
  configured: boolean
  maxProofBytes: number
  maxConcurrent: number
  clientOriginVerified: false
  message: string
}
export interface ServerReceipt {
  payload: {
    protocol: string
    purpose: string
    issuer_id: string
    receipt_id: string
    received_at_ms: number
    expires_at_ms: number
    scope: string
    received_events: number
  }
  signature: string
}
export function createReceiptApi(client: HttpClient) {
  return {
    capabilities: () => client.get<ReceiptCapabilities>('/workproof/receipts/capabilities'),
    issue: (proof: Blob, signal?: AbortSignal) => client.postRawJson<ServerReceipt>(
      '/workproof/receipts', proof, signal, { 'X-WorkProof-Receipt-Consent': 'true' }),
  }
}
