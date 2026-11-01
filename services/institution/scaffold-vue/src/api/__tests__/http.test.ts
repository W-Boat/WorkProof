import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpClient, ApiError, setUnauthorizedHandler } from '../http.ts'

test('raw JSON upload preserves signed bytes and shares authentication and cancellation', async () => {
  const raw = new Blob(['{ "artifact_bytes":18446744073709551615, "signature":"fixture" }'])
  const controller = new AbortController()
  let sent: RequestInit | undefined
  const client = createHttpClient({ tokenProvider: () => 'fixture-token', fetcher: async (_url, init) => {
    sent = init
    return new Response(JSON.stringify({code:200, message:'ok', data:{artifact_checked:false}}), {status:200})
  } })
  await client.postRawJson('/workproof/certificates/inspect', raw, controller.signal)
  assert.equal(sent?.body, raw)
  assert.equal(sent?.signal, controller.signal)
  assert.equal((sent?.headers as Record<string, string>).Authorization, 'Bearer fixture-token')
  assert.equal(await (sent?.body as Blob).text(), await raw.text())
})

test('http client sends bearer token and unwraps unified response data', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ code: 200, message: 'success', data: { id: 1 }, traceId: 't1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const client = createHttpClient({ baseUrl: 'http://api.test/api', tokenProvider: () => 'token-1', fetcher })

  const data = await client.get<{ id: number }>('/system/users', { pageNum: 1, keyword: '周明远' })

  assert.deepEqual(data, { id: 1 })
  assert.equal(calls[0].url, 'http://api.test/api/system/users?pageNum=1&keyword=%E5%91%A8%E6%98%8E%E8%BF%9C')
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer token-1')
})

test('http client throws ApiError for business errors', async () => {
  const fetcher = async () => new Response(JSON.stringify({ code: 403, message: '没有访问权限', data: null, traceId: 't2' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
  const client = createHttpClient({ baseUrl: '/api', tokenProvider: () => null, fetcher })

  await assert.rejects(
    () => client.post('/system/users', { username: 'blocked' }),
    (error: unknown) => error instanceof ApiError && error.code === 403 && error.message === '没有访问权限',
  )
})

test('a late unauthorized response from an old account does not clear the new session', async () => {
  let token = 'old-session'
  let resolveResponse!: (response: Response) => void
  let redirects = 0
  setUnauthorizedHandler(() => { redirects += 1 })
  const client = createHttpClient({
    tokenProvider: () => token,
    fetcher: () => new Promise<Response>(resolve => { resolveResponse = resolve }),
  })
  try {
    const pending = client.get('/auth/me')
    token = 'new-session'
    resolveResponse(new Response(JSON.stringify({ code: 401, message: '登录已过期' }), { status: 401 }))
    await assert.rejects(pending, ApiError)
    assert.equal(redirects, 0)
  } finally {
    setUnauthorizedHandler(null)
  }
})

test('an unauthorized download for the current session uses the same login-expiry handler', async () => {
  let redirects = 0
  setUnauthorizedHandler(() => { redirects += 1 })
  const client = createHttpClient({
    tokenProvider: () => 'current-session',
    fetcher: async () => new Response(JSON.stringify({ code: 401, message: '登录已过期' }), { status: 401 }),
  })
  try {
    await assert.rejects(client.download('/system/users/export'), ApiError)
    assert.equal(redirects, 1)
  } finally {
    setUnauthorizedHandler(null)
  }
})
