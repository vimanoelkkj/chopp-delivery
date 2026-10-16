import { expect, it, vi } from 'vitest'
import { handleCmsDraft } from '../../server/cms/handlers'
import { CMS_READ_MS, readCmsBody } from '../../server/cms/http'
import { CMS_REQUEST_BYTES } from '../../server/cms/validation'
import { TEST_ORIGIN } from './auth-fixture'
import { cmsFixture } from './cms-fixture'

const req = (body: BodyInit, headers: Record<string, string> = {}) => {
  const init = {
    method: 'PUT',
    body,
    duplex: 'half',
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  return new Request(`${TEST_ORIGIN}/api/admin/site/draft`, init)
}
it('limita bytes reais do fluxo apesar de Content-Length falso e cancela a leitura', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(CMS_REQUEST_BYTES))
      c.enqueue(new Uint8Array(1))
    },
    cancel() {
      cancelled = true
    },
  })
  expect(await readCmsBody(req(body, { 'Content-Length': '1' }))).toEqual({
    error: 'BODY_TOO_LARGE',
  })
  expect(cancelled).toBe(true)
})
it('limite exato é aceito antes do parse; byte extra é recusado', async () => {
  expect(await readCmsBody(req(`${' '.repeat(CMS_REQUEST_BYTES - 2)}{}`))).toEqual({ value: {} })
  expect(await readCmsBody(req(`${' '.repeat(CMS_REQUEST_BYTES - 1)}{}`))).toEqual({
    error: 'BODY_TOO_LARGE',
  })
})
it.each(['{', 'nullx', '"\ud800', '\u0000'])('recusa JSON malformado %j', async (body) => {
  expect(await readCmsBody(req(body))).toEqual({ error: 'INVALID_BODY' })
})
it('recusa UTF-8 inválido, Content-Type incorreto, falta de corpo e stream com erro', async () => {
  expect(await readCmsBody(req(new Uint8Array([0xc0, 0xaf])))).toEqual({ error: 'INVALID_BODY' })
  expect(await readCmsBody(req('{}', { 'Content-Type': 'text/plain' }))).toEqual({
    error: 'INVALID_BODY',
  })
  expect(await readCmsBody(new Request(TEST_ORIGIN, { method: 'PUT' }))).toEqual({
    error: 'INVALID_BODY',
  })
  expect(
    await readCmsBody(
      req(
        new ReadableStream({
          start(c) {
            c.error(new Error('private stream failure'))
          },
        }),
      ),
    ),
  ).toEqual({ error: 'INVALID_BODY' })
})
it('deadline de leitura cancela fonte que não entrega bytes', async () => {
  vi.useFakeTimers()
  try {
    let cancelled = false
    const result = readCmsBody(
      req(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
      ),
    )
    await vi.advanceTimersByTimeAsync(CMS_READ_MS)
    expect(await result).toEqual({ error: 'READ_TIMEOUT' })
    expect(cancelled).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
it('API devolve 400/413 sem gravar para corpos malformados ou excessivos', async () => {
  const f = await cmsFixture()
  try {
    const headers = {
      Origin: TEST_ORIGIN,
      Cookie: f.cookie,
      'If-Match': `"${f.initial.draft.revision}"`,
    }
    expect((await handleCmsDraft(req('{', headers), f.env)).status).toBe(400)
    expect(
      (
        await handleCmsDraft(
          req('x'.repeat(CMS_REQUEST_BYTES + 1), { ...headers, 'Content-Length': '1' }),
          f.env,
        )
      ).status,
    ).toBe(413)
    expect(await f.count('cms_versions')).toBe(0)
    expect(await f.count('cms_media_refs')).toBe(0)
    expect(
      (
        await f.db
          .prepare('SELECT draft_revision FROM cms_state')
          .first<{ draft_revision: string }>()
      )?.draft_revision,
    ).toBe(f.initial.draft.revision)
  } finally {
    await f.runtime.dispose()
  }
})
