import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpClient } from '../http.ts'
import { createReceiptApi } from '../receipts.ts'

test('receipt API sends explicit consent with exact proof bytes, authentication and abort signal', async () => {
  const proof = new Blob(['{ "large":18446744073709551615 }\n'])
  const signal = new AbortController().signal
  const calls: Array<{url: string; init?: RequestInit}> = []
  const client = createHttpClient({ tokenProvider: () => 'receipt-fixture', fetcher: async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ code: 200, data: { configured: true } }))
  } })
  const api = createReceiptApi(client)
  await api.capabilities()
  await api.issue(proof, signal)
  assert.equal(calls[0].url, '/api/workproof/receipts/capabilities')
  assert.equal(calls[0].init?.method, 'GET')
  const sent = calls[1]
  assert.equal(sent.url, '/api/workproof/receipts')
  assert.equal(sent.init?.body, proof)
  assert.equal(sent.init?.signal, signal)
  assert.equal(sent.init?.method, 'POST')
  assert.equal((sent.init?.headers as Record<string, string>)['X-WorkProof-Receipt-Consent'], 'true')
  assert.equal((sent.init?.headers as Record<string, string>).Authorization, 'Bearer receipt-fixture')
  assert.equal(await (sent.init?.body as Blob).text(), await proof.text())
})
