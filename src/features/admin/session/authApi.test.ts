import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSession, login, logout } from './authApi'

const reply = (status: number, body: unknown = {}, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers })

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('login', () => {
  it('envia JSON para a rota real e devolve só o usuário público', async () => {
    const fetchMock = stubFetch(
      reply(200, { authenticated: true, user: { id: 'u1', username: 'owner' } }),
    )
    expect(await login('owner', 'senha secreta')).toEqual({
      ok: true,
      user: { id: 'u1', username: 'owner' },
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ username: 'owner', password: 'senha secreta' }))
  })

  it.each([
    [401, { ok: false, reason: 'invalid-credentials' }],
    [403, { ok: false, reason: 'bad-origin' }],
    [400, { ok: false, reason: 'bad-request' }],
    [503, { ok: false, reason: 'unavailable' }],
    [500, { ok: false, reason: 'unavailable' }],
  ])('traduz HTTP %i', async (status, expected) => {
    stubFetch(reply(status))
    expect(await login('owner', 'x')).toEqual(expected)
  })

  it('lê Retry-After no 429', async () => {
    stubFetch(reply(429, {}, { 'Retry-After': '899' }))
    expect(await login('owner', 'x')).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterSeconds: 899,
    })
    stubFetch(reply(429))
    expect(await login('owner', 'x')).toMatchObject({ retryAfterSeconds: null })
  })

  it('falha de rede ou resposta sem usuário vira "indisponível"', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    expect(await login('owner', 'x')).toEqual({ ok: false, reason: 'unavailable' })
    stubFetch(reply(200, { authenticated: true }))
    expect(await login('owner', 'x')).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('fetchSession e logout', () => {
  it('401 = sem sessão; 200 = usuário; outros status lançam', async () => {
    stubFetch(reply(401))
    expect(await fetchSession()).toBeNull()
    stubFetch(reply(200, { authenticated: true, user: { id: 'u1', username: 'owner' } }))
    expect(await fetchSession()).toEqual({ id: 'u1', username: 'owner' })
    stubFetch(reply(503))
    await expect(fetchSession()).rejects.toThrow()
    stubFetch(new TypeError('Failed to fetch'))
    await expect(fetchSession()).rejects.toThrow()
  })

  it('logout informa se a chamada chegou ao servidor', async () => {
    const fetchMock = stubFetch(reply(200, { ok: true }))
    expect(await logout()).toBe(true)
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('POST')
    stubFetch(new TypeError('Failed to fetch'))
    expect(await logout()).toBe(false)
    stubFetch(reply(403))
    expect(await logout()).toBe(false)
  })
})
