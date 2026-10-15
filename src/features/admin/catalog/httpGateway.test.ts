import { describe, expect, it, vi } from 'vitest'
import { AdminApiError } from './gateway'
import { CATALOG_V2_PATH, createHttpGateway } from './httpGateway'
import { createMockGateway } from './mockGateway'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const snapshot = () => createMockGateway(undefined, 0).load()
const input = { revision: 'r7', categories: [] }

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof AdminApiError ? error.code : `outro:${String(error)}`
  }
  return 'ok'
}

const lastCall = (fetcher: ReturnType<typeof vi.fn>) =>
  fetcher.mock.calls[0] as unknown as [string, RequestInit]

describe('httpGateway (contrato provisório da API v2)', () => {
  it('não chama a rede ao ser construído', () => {
    const fetcher = vi.fn()
    createHttpGateway({ fetch: fetcher })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('load: GET na rota v2 com cookie de mesma origem e sinal de cancelamento', async () => {
    const fetcher = vi.fn(async () => json(await snapshot()))
    const controller = new AbortController()
    const catalog = await createHttpGateway({ fetch: fetcher }).load(controller.signal)
    expect(catalog.categories).toHaveLength(2)
    const [url, init] = lastCall(fetcher)
    expect(url).toBe(CATALOG_V2_PATH)
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      signal: controller.signal,
    })
  })

  it('save: PUT com If-Match da revisão (entre aspas) e o corpo exato do SaveInput', async () => {
    const base = await snapshot()
    const fetcher = vi.fn(async () => json({ catalog: base, created: { items: [], variants: [] } }))
    await createHttpGateway({ fetch: fetcher }).save(input)
    const [, init] = lastCall(fetcher)
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'If-Match': '"r7"' })
    expect(init.body).toBe(JSON.stringify(input))
    expect(init.credentials).toBe('same-origin')
  })

  it.each([
    [401, 'unauthenticated'],
    [409, 'conflict'],
    [400, 'rejected'],
    [403, 'forbidden'],
    [410, 'rejected'],
    [428, 'rejected'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('status %i vira %s (load e save)', async (status, code) => {
    const gateway = createHttpGateway({ fetch: async () => json({}, status) })
    expect(await codeOf(gateway.load())).toBe(code)
    expect(await codeOf(gateway.save(input))).toBe(code)
  })

  it('falha de rede e JSON inválido viram unavailable (incerto no save)', async () => {
    const down = createHttpGateway({
      fetch: async () => {
        throw new TypeError('network')
      },
    })
    expect(await codeOf(down.save(input))).toBe('unavailable')
    const html = createHttpGateway({ fetch: async () => new Response('<html>', { status: 200 }) })
    expect(await codeOf(html.load())).toBe('unavailable')
  })

  it('200 com forma inválida não é aceito como catálogo nem como resultado de save', async () => {
    const gateway = createHttpGateway({ fetch: async () => json({ revision: 1 }) })
    expect(await codeOf(gateway.load())).toBe('unavailable')
    expect(await codeOf(gateway.save(input))).toBe('unavailable')
  })

  it('cancelamento (AbortError) propaga como está, sem virar erro de API', async () => {
    const gateway = createHttpGateway({
      fetch: async () => {
        throw new DOMException('aborted', 'AbortError')
      },
    })
    expect(await codeOf(gateway.load())).toMatch(/^outro:/)
  })
})
