import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewFixture } from '../../../../tests/e2e-real/preview-fixture'
import { classify, fetchReceipt, previewConversion, runCommand } from './cmsCommands'
import { buildInitialDocument } from './initialDocument'

const REV1 = 'c1_12345678-1234-4123-8123-123456789012'
const REV2 = 'c2_12345678-1234-4123-8123-123456789012'
const OP = '12345678-1234-4123-8123-123456789abc'

const receipt = (action = 'startV2') => ({
  command: {
    operationId: OP,
    action,
    expectedRevision: REV1,
    revision: REV2,
    versionId: 'version_12345678-1234-4123-8123-123456789012',
  },
  site: { schema: 2, draft: { revision: REV2, document: previewFixture() }, published: null },
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const stub = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

describe('forma da requisição', () => {
  it('startV2: POST em /api/admin/site/convert com If-Match igual à revisão e o corpo exato do contrato', async () => {
    const fetchMock = stub(async () => json(200, receipt()))
    const document = buildInitialDocument()
    const outcome = await runCommand({
      action: 'startV2',
      expectedRevision: REV1,
      operationId: OP,
      document,
    })
    expect(outcome.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/site/convert')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['If-Match']).toBe(`"${REV1}"`)
    expect(init.credentials).toBe('same-origin')
    const body = JSON.parse(init.body as string)
    expect(Object.keys(body).sort()).toEqual([
      'action',
      'document',
      'expectedRevision',
      'operationId',
    ])
    expect(body).toMatchObject({ action: 'startV2', expectedRevision: REV1, operationId: OP })
  })

  it('saveDraft: PUT em /api/admin/site/draft com If-Match, operationId e o documento inteiro', async () => {
    const fetchMock = stub(async () => json(200, receipt('saveDraft')))
    const document = buildInitialDocument()
    const outcome = await runCommand({
      action: 'saveDraft',
      expectedRevision: REV1,
      operationId: OP,
      document,
    })
    expect(outcome.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/site/draft')
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['If-Match']).toBe(`"${REV1}"`)
    const body = JSON.parse(init.body as string)
    expect(Object.keys(body).sort()).toEqual([
      'action',
      'document',
      'expectedRevision',
      'operationId',
    ])
    expect(body).toMatchObject({ action: 'saveDraft', expectedRevision: REV1, operationId: OP })
    expect(body.document).toEqual(JSON.parse(JSON.stringify(document)))
  })

  it('convertToV2: o cliente nunca envia o documento; envia só os reconhecimentos', async () => {
    const fetchMock = stub(async () => json(200, receipt('convertToV2')))
    await runCommand({
      action: 'convertToV2',
      expectedRevision: REV1,
      operationId: OP,
      acknowledge: ['a', 'b'],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(Object.keys(body).sort()).toEqual([
      'acknowledge',
      'action',
      'expectedRevision',
      'operationId',
    ])
    expect(body.document).toBeUndefined()
  })

  it('previewConversion: só ação, revisão e operationId (nada de documento)', async () => {
    const fetchMock = stub(async () => json(500, {}))
    await previewConversion(REV1, OP)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(Object.keys(body).sort()).toEqual(['action', 'expectedRevision', 'operationId'])
    expect(body.action).toBe('previewConversion')
  })
})

describe('classificação das falhas', () => {
  it.each([
    [401, undefined, 'expired'],
    [403, 'INVALID_ORIGIN', 'forbidden'],
    [409, 'CMS_REVISION_CONFLICT', 'conflict'],
    [409, 'CMS_ALREADY_V2', 'conflict'],
    [409, 'CMS_SCHEMA_MISMATCH', 'conflict'],
    [409, 'CMS_OPERATION_CONFLICT', 'operation-conflict'],
    [409, 'CMS_ACKNOWLEDGEMENT_REQUIRED', 'acknowledgement'],
    [400, 'VALIDATION_ERROR', 'invalid'],
    [428, 'PRECONDITION_REQUIRED', 'invalid'],
    [503, 'CMS_SCHEMA_UNAVAILABLE', 'unavailable'],
    [503, 'CMS_WRITE_INCOMPLETE', 'unknown'],
    [503, 'CMS_UNAVAILABLE', 'unknown'],
    [500, undefined, 'unknown'],
    [502, undefined, 'unknown'],
  ])('%i %s vira %s', (status, code, kind) => {
    const body = code ? { error: { code } } : undefined
    expect(classify(status, body).kind).toBe(kind)
  })

  it('o conflito de revisão e o "já é v2" mantêm o código para a tela explicar', () => {
    expect(classify(409, { error: { code: 'CMS_ALREADY_V2' } })).toEqual({
      kind: 'conflict',
      code: 'CMS_ALREADY_V2',
    })
  })
})

describe('uma tentativa, sem reenvio automático', () => {
  it('falha de rede: devolve "unknown" e chamou o servidor exatamente uma vez', async () => {
    const fetchMock = stub(async () => {
      throw new TypeError('Failed to fetch')
    })
    const outcome = await runCommand({
      action: 'startV2',
      expectedRevision: REV1,
      operationId: OP,
      document: buildInitialDocument(),
    })
    expect(outcome).toEqual({ ok: false, failure: { kind: 'unknown' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('500 e 409 também são uma só chamada', async () => {
    for (const status of [500, 409]) {
      const fetchMock = stub(async () => json(status, { error: { code: 'CMS_REVISION_CONFLICT' } }))
      await runCommand({ action: 'convertToV2', expectedRevision: REV1, operationId: OP })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('200 com recibo inválido não é sucesso: vira "unknown" (a operação pode ter sido gravada)', async () => {
    stub(async () => json(200, { command: {}, site: {} }))
    const outcome = await runCommand({
      action: 'convertToV2',
      expectedRevision: REV1,
      operationId: OP,
    })
    expect(outcome).toEqual({ ok: false, failure: { kind: 'unknown' } })
  })

  it('200 com recibo cuja revisão não bate com o documento também é recusado', async () => {
    const bad = receipt()
    bad.command.revision = 'c2_99999999-9999-4999-8999-999999999999'
    stub(async () => json(200, bad))
    const outcome = await runCommand({
      action: 'convertToV2',
      expectedRevision: REV1,
      operationId: OP,
    })
    expect(outcome.ok).toBe(false)
  })
})

describe('consulta do recibo (somente leitura)', () => {
  it('200: a operação foi gravada e o documento vem junto', async () => {
    const fetchMock = stub(async () => json(200, receipt()))
    const outcome = await fetchReceipt(OP)
    expect(outcome.ok && outcome.value?.read.revision).toBe(REV2)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/admin/site/commands/${OP}`)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('404: ainda não há recibo; não confirma ausência de gravação', async () => {
    stub(async () => json(404, { error: { code: 'CMS_COMMAND_NOT_FOUND' } }))
    expect(await fetchReceipt(OP)).toEqual({ ok: true, value: null })
  })

  it('401 vira sessão expirada; rede fora do ar vira "unknown"', async () => {
    stub(async () => json(401, { error: { code: 'UNAUTHENTICATED' } }))
    expect(await fetchReceipt(OP)).toEqual({ ok: false, failure: { kind: 'expired' } })
    stub(async () => {
      throw new TypeError('offline')
    })
    expect(await fetchReceipt(OP)).toEqual({ ok: false, failure: { kind: 'unknown' } })
  })
})

describe('M3D.1: Access responses during a write', () => {
  it.each([200, 401, 403, 302])(
    'HTML/redirect %i preserves the payload and leaves the outcome unknown',
    async (status) => {
      const input = {
        action: 'saveDraft' as const,
        expectedRevision: REV2,
        operationId: OP,
        document: buildInitialDocument(),
      }
      const hero = input.document.modules.find((module) => module.template === 'hero')
      if (!hero) throw new Error('Missing fixture hero')
      hero.content.heading = 'Local unsaved text preserved'
      const before = JSON.stringify(input)
      const fetchMock = stub(
        async () =>
          new Response('<html>Access login</html>', {
            status,
            headers: {
              'Content-Type': 'text/html',
              ...(status === 302 ? { Location: 'https://identity.example/login' } : {}),
            },
          }),
      )
      expect(await runCommand(input)).toEqual({ ok: false, failure: { kind: 'unknown' } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][1].redirect).toBe('error')
      expect(JSON.stringify(input)).toBe(before)
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).operationId).toBe(OP)
    },
  )
  it('does not call an external JSON error a confirmed F2 expiry or an absent receipt', async () => {
    const fetchMock = stub(async () => json(401, { error: { code: 'ACCESS_DENIED' } }))
    expect(await fetchReceipt(OP)).toEqual({ ok: false, failure: { kind: 'unknown' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    stub(
      async () =>
        new Response('not JSON', { status: 404, headers: { 'Content-Type': 'application/json' } }),
    )
    expect(await fetchReceipt(OP)).toEqual({ ok: false, failure: { kind: 'unknown' } })
  })
})
