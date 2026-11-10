import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ImageApiError, productImages } from './imageApi'

// F4A.6.4E: cliente de `/api/admin/catalog/media` (revisão própria mN e erros em português).
const MEDIA = 'media_12345678-1234-4123-8123-123456789012'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const stub = (response: Response | Error) => {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const failure = async (action: () => Promise<unknown>) => {
  try {
    await action()
  } catch (error) {
    return error as ImageApiError
  }
  throw new Error('esperava falha')
}

afterEach(() => vi.unstubAllGlobals())

describe('productImages', () => {
  it('lê o estado e converte o token mN em número', async () => {
    stub(json(200, { itemId: 'dronken', mediaId: MEDIA, alt: 'Foto', revision: 'm7' }))
    expect(await productImages.get('dronken')).toEqual({
      itemId: 'dronken',
      mediaId: MEDIA,
      alt: 'Foto',
      revision: 7,
    })
  })

  it('PUT e DELETE levam a revisão em If-Match e o corpo mínimo', async () => {
    const fetchMock = stub(
      json(200, { itemId: 'dronken', mediaId: MEDIA, alt: 'Foto', revision: 'm8' }),
    )
    await productImages.put('dronken', 7, { mediaId: MEDIA, alt: 'Foto' })
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/admin/catalog/media/dronken')
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"m7"')
    expect(JSON.parse(init.body as string)).toEqual({ mediaId: MEDIA, alt: 'Foto' })
    stub(json(200, { itemId: 'dronken', mediaId: null, alt: null, revision: 'm9' }))
    const removed = await productImages.remove('dronken', 8)
    expect(removed).toMatchObject({ mediaId: null, alt: null, revision: 9 })
  })

  it.each([
    [401, { error: { code: 'UNAUTHENTICATED' } }, 'unauthenticated'],
    [403, { error: { code: 'INVALID_ORIGIN' } }, 'forbidden'],
    [409, { error: { code: 'CATALOG_MEDIA_CONFLICT' } }, 'conflict'],
    [404, { error: { code: 'ITEM_NOT_FOUND' } }, 'not-found'],
    [404, { error: { code: 'IMAGE_NOT_FOUND' } }, 'no-image'],
    [404, { error: { code: 'NOT_FOUND' } }, 'disabled'],
    [428, { error: { code: 'PRECONDITION_REQUIRED' } }, 'invalid'],
    [503, { error: { code: 'CATALOG_MEDIA_UNAVAILABLE' } }, 'unavailable'],
    [500, { error: { code: 'X' } }, 'unavailable'],
  ])('HTTP %s vira %s', async (status, body, code) => {
    stub(json(status, body))
    expect((await failure(() => productImages.get('dronken'))).code).toBe(code)
  })

  it('400 devolve o motivo legível do servidor, nunca texto técnico longo', async () => {
    stub(
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          fields: { mediaId: 'A imagem escolhida não existe ou ainda não está pronta.' },
        },
      }),
    )
    const error = await failure(() => productImages.put('dronken', 0, { mediaId: MEDIA, alt: 'x' }))
    expect(error.code).toBe('invalid')
    expect(error.detail).toBe('A imagem escolhida não existe ou ainda não está pronta.')
    stub(json(400, { error: { fields: { alt: 'x'.repeat(500) } } }))
    expect((await failure(() => productImages.get('dronken'))).detail).toBeUndefined()
  })

  it('rede, resposta que não é JSON e estado malformado viram "unavailable"', async () => {
    stub(new TypeError('Failed to fetch'))
    expect((await failure(() => productImages.get('dronken'))).code).toBe('unavailable')
    stub(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect((await failure(() => productImages.get('dronken'))).code).toBe('unavailable')
    for (const body of [
      { itemId: 'a', mediaId: MEDIA, alt: null, revision: 'm1' },
      { itemId: 'a', mediaId: null, alt: 'x', revision: 'm1' },
      { itemId: 'a', mediaId: null, alt: null, revision: 'r1' },
      { itemId: 'a', mediaId: null, alt: null, revision: 'm01' },
      null,
    ]) {
      stub(json(200, body))
      expect((await failure(() => productImages.get('a'))).code).toBe('unavailable')
    }
  })

  it('o id do produto é codificado na rota', async () => {
    const fetchMock = stub(json(200, { itemId: 'a/b', mediaId: null, alt: null, revision: 'm0' }))
    await productImages.get('a/b')
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/admin/catalog/media/a%2Fb',
    )
  })
})
