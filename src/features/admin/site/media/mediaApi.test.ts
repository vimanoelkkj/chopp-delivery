import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classify,
  fetchUploadReceipt,
  listMedia,
  mediaPath,
  readMediaPage,
  readUploadReceipt,
  uploadMedia,
} from './mediaApi'

const ID = 'media_12345678-1234-4123-8123-123456789012'
const OP = '12345678-1234-4123-8123-123456789abc'
const ready = (id = ID) => ({
  id,
  state: 'ready',
  revision: OP,
  profiles: ['hero', 'section'],
  integrity: 'not_checked',
})
const page = (overrides: Record<string, unknown> = {}) => ({
  media: [ready()],
  nextCursor: null,
  capacity: { limit: 100, consumed: 1, remaining: 99, includesTombstones: true },
  ...overrides,
})
const receipt = (status = 'done') => ({
  media: { id: ID, state: 'ready', revision: OP, profiles: ['hero', 'section'] },
  operation: { id: OP, status },
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const stub = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

describe('listagem', () => {
  it('aceita capacidade reutilizável e preserva a política recebida do servidor', async () => {
    stub(async () =>
      json(
        200,
        page({ capacity: { limit: 100, consumed: 1, remaining: 99, includesTombstones: false } }),
      ),
    )
    const outcome = await listMedia({ limit: 12 })
    expect(outcome.ok && outcome.value.capacity.includesTombstones).toBe(false)
  })

  it('GET com limite e cursor codificado; sem corpo, sem escrita', async () => {
    const fetchMock = stub(async () => json(200, page()))
    const outcome = await listMedia({ limit: 12, cursor: '1700000000000:' + ID })
    expect(outcome.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.credentials).toBe('same-origin')
    const query = new URL(url, 'http://x').searchParams
    expect(query.get('limit')).toBe('12')
    expect(query.get('cursor')).toBe(`1700000000000:${ID}`)
    expect(url).toContain('cursor=1700000000000%3Amedia_')
  })

  it('devolve itens, cursor e capacidade validados', async () => {
    stub(async () => json(200, page({ nextCursor: `1:${ID}` })))
    const outcome = await listMedia({ limit: 12 })
    if (!outcome.ok) throw new Error('esperava sucesso')
    expect(outcome.value.media[0]).toMatchObject({ id: ID, state: 'ready' })
    expect(outcome.value.nextCursor).toBe(`1:${ID}`)
    expect(outcome.value.capacity).toEqual({
      limit: 100,
      consumed: 1,
      remaining: 99,
      includesTombstones: true,
    })
  })

  it('formato inesperado vira falha, nunca um item "meio válido"', () => {
    const bad: [string, unknown][] = [
      [
        'campo extra com chave de armazenamento',
        page({ media: [{ ...ready(), objectKey: 'cms/x' }] }),
      ],
      ['pronta sem perfis', page({ media: [{ ...ready(), profiles: [] }] })],
      [
        'perfis em mídia que não está pronta',
        page({ media: [{ ...ready(), state: 'processing' }] }),
      ],
      ['estado desconhecido', page({ media: [{ ...ready(), state: 'mystery' }] })],
      ['id que não é de mídia', page({ media: [ready('media_x')] })],
      ['ids repetidos', page({ media: [ready(), ready()] })],
      [
        'restante incoerente',
        page({ capacity: { limit: 100, consumed: 1, remaining: 5, includesTombstones: true } }),
      ],
      [
        'política de capacidade inválida',
        page({ capacity: { limit: 100, consumed: 1, remaining: 99, includesTombstones: 'false' } }),
      ],
      ['cursor enorme', page({ nextCursor: 'x'.repeat(81) })],
      ['chave extra no envelope', { ...page(), debug: true }],
    ]
    for (const [label, body] of bad) expect(() => readMediaPage(body), label).toThrow()
  })

  it('resposta ilegível ou 5xx são falha "unknown"; 401, 403 e 404 têm categoria própria', async () => {
    stub(async () => json(200, { media: 'x' }))
    expect(await listMedia({ limit: 12 })).toEqual({ ok: false, failure: { kind: 'unknown' } })
    stub(async () => json(503, { error: { code: 'MEDIA_UNAVAILABLE' } }))
    expect(await listMedia({ limit: 12 })).toEqual({ ok: false, failure: { kind: 'unknown' } })
    stub(async () => json(401, { error: { code: 'UNAUTHENTICATED' } }))
    expect(await listMedia({ limit: 12 })).toEqual({ ok: false, failure: { kind: 'expired' } })
    stub(async () => json(404, { error: { code: 'NOT_FOUND' } }))
    expect(await listMedia({ limit: 12 })).toEqual({ ok: false, failure: { kind: 'unsupported' } })
    stub(async () => Promise.reject(new TypeError('network')))
    expect(await listMedia({ limit: 12 })).toEqual({ ok: false, failure: { kind: 'unknown' } })
  })
})

describe('classificação', () => {
  it('cada status vira a categoria que a tela precisa decidir', () => {
    expect(classify(401, undefined)).toEqual({ kind: 'expired' })
    expect(classify(403, undefined)).toEqual({ kind: 'forbidden' })
    expect(classify(404, undefined)).toEqual({ kind: 'unsupported' })
    expect(classify(413, undefined)).toEqual({ kind: 'too-large' })
    expect(classify(429, undefined)).toEqual({ kind: 'quota' })
    expect(classify(409, undefined)).toEqual({ kind: 'busy' })
    expect(classify(400, { error: { code: 'MEDIA_INVALID' } })).toEqual({
      kind: 'invalid',
      code: 'MEDIA_INVALID',
    })
    for (const status of [408, 500, 502, 503, 504])
      expect(classify(status, undefined), String(status)).toEqual({ kind: 'unknown' })
  })
})

describe('envio', () => {
  it('POST com tipo real, X-Operation-Id, If-None-Match: * e os bytes do arquivo — uma única requisição', async () => {
    const fetchMock = stub(async () => json(200, receipt()))
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const outcome = await uploadMedia({ file, mime: 'image/png', operationId: OP })
    expect(outcome.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/media')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'image/png',
      'X-Operation-Id': OP,
      'If-None-Match': '*',
    })
    expect(init.body).toBe(file)
  })

  it('erros definitivos não são reenviados nem confundidos com incerteza', async () => {
    for (const [status, kind] of [
      [400, 'invalid'],
      [413, 'too-large'],
      [429, 'quota'],
      [409, 'busy'],
      [401, 'expired'],
    ] as const) {
      const fetchMock = stub(async () =>
        json(status, { error: { code: status === 401 ? 'UNAUTHENTICATED' : 'X' } }),
      )
      const outcome = await uploadMedia({
        file: new Blob(['x']),
        mime: 'image/png',
        operationId: OP,
      })
      expect(outcome.ok === false && outcome.failure.kind, String(status)).toBe(kind)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('rede caída, 5xx e 408 são "unknown" (pode ter sido gravado) e continuam sendo uma só requisição', async () => {
    for (const impl of [
      () => Promise.reject(new TypeError('network')),
      async () => json(503, { error: { code: 'MEDIA_UNAVAILABLE' } }),
      async () => json(408, { error: { code: 'MEDIA_TIMEOUT' } }),
      async () => json(200, { media: {} }),
    ]) {
      const fetchMock = stub(impl)
      const outcome = await uploadMedia({
        file: new Blob(['x']),
        mime: 'image/png',
        operationId: OP,
      })
      expect(outcome).toEqual({ ok: false, failure: { kind: 'unknown' } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('200 com operação "failed" é falha registrada, não sucesso', async () => {
    stub(async () => json(200, receipt('failed')))
    const outcome = await uploadMedia({ file: new Blob(['x']), mime: 'image/png', operationId: OP })
    expect(outcome).toEqual({ ok: false, failure: { kind: 'failed-record' } })
  })
})

describe('recibo do envio', () => {
  it('consulta por GET em /commands/:id e entende recibo, andamento e ausência', async () => {
    const fetchMock = stub(async () => json(200, receipt()))
    const found = await fetchUploadReceipt(OP)
    expect(found.ok && found.value.kind).toBe('receipt')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/admin/media/commands/${OP}`)
    expect(init.method).toBe('GET')

    stub(async () =>
      json(202, {
        operation: { id: OP, status: 'running', reconciliationRequired: true },
        outcome: 'unknown',
      }),
    )
    expect(await fetchUploadReceipt(OP)).toEqual({
      ok: true,
      value: { kind: 'running', reconciliationRequired: true },
    })

    stub(async () =>
      json(404, { error: { code: 'MEDIA_OPERATION_NOT_FOUND' }, outcome: 'unknown' }),
    )
    expect(await fetchUploadReceipt(OP)).toEqual({ ok: true, value: { kind: 'absent' } })
  })

  it('404 de ambiente sem biblioteca não é "ausência": é indisponível', async () => {
    stub(async () => json(404, { error: { code: 'NOT_FOUND' } }))
    expect(await fetchUploadReceipt(OP)).toEqual({ ok: false, failure: { kind: 'unsupported' } })
  })

  it('recibo de outra operação, ou ilegível, nunca é aceito', async () => {
    stub(async () =>
      json(200, { ...receipt(), operation: { id: ID.replace('media_', ''), status: 'done' } }),
    )
    expect(await fetchUploadReceipt(OP)).toEqual({ ok: false, failure: { kind: 'unknown' } })
    stub(async () => json(200, { oops: true }))
    expect(await fetchUploadReceipt(OP)).toEqual({ ok: false, failure: { kind: 'unknown' } })
  })

  it('o formato do recibo recusa campos extras (chaves internas)', () => {
    expect(() =>
      readUploadReceipt({ ...receipt(), media: { ...receipt().media, objectKey: 'x' } }),
    ).toThrow()
    expect(readUploadReceipt(receipt()).operation.status).toBe('done')
  })
})

describe('entrega', () => {
  it('o caminho usa só ID e perfil; ID inválido não gera caminho', () => {
    expect(mediaPath(ID, 'hero')).toBe(`/api/admin/media/${ID}/hero`)
    expect(mediaPath(ID, 'section')).toBe(`/api/admin/media/${ID}/section`)
    expect(mediaPath('media_x', 'hero')).toBeNull()
    expect(mediaPath('../../etc/passwd', 'hero')).toBeNull()
  })
})
