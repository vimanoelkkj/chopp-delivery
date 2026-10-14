import { describe, expect, it, vi } from 'vitest'
import {
  PATCH_BODY_TIMEOUT_MS,
  readPatchBody,
  validateCachacaPatch,
  validateProductPatch,
} from '../../server/admin-catalog/validation'

describe('fronteiras JSON e monetárias do catálogo administrativo', () => {
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    0.1,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejeita valor monetário %s nas duas entidades', (value) => {
    expect(
      validateProductPatch({ pricesCents: { 30: value } }).fields?.['pricesCents.30'],
    ).toBeDefined()
    expect(validateCachacaPatch({ priceCents: value }).fields?.priceCents).toBeDefined()
  })

  it('aceita centavos positivos e barril null sem adicionar campos omitidos', () => {
    expect(validateProductPatch({ pricesCents: { 30: null } })).toEqual({
      value: { pricesCents: { 30: null } },
    })
    expect(validateProductPatch({ pricesCents: { 50: 29 }, description: '' })).toEqual({
      value: { pricesCents: { 50: 29 }, description: '' },
    })
    expect(
      validateCachacaPatch({ priceCents: 1, description: 'Texto\ncom tabulação\t' }).value,
    ).toEqual({ priceCents: 1, description: 'Texto\ncom tabulação\t' })
  })

  it('cancelamento pendente não impede prazo de cinco segundos para corpo incompleto', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const cancel = vi.fn(() => new Promise<void>(() => {}))
      const request = new Request('https://admin.delegas.example/api/admin/products/dronken', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: new ReadableStream({ cancel }),
        duplex: 'half',
      } as RequestInit)
      const read = readPatchBody(request)
      await vi.advanceTimersByTimeAsync(PATCH_BODY_TIMEOUT_MS)
      expect(await read).toBeNull()
      expect(cancel).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('UTF-8 inválido é recusado antes de construir JSON', async () => {
    const request = new Request('https://admin.delegas.example/api/admin/products/dronken', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: new Uint8Array([0xff]),
    })
    expect(await readPatchBody(request)).toBeNull()
  })

  it('chunks periódicos não reiniciam o prazo total do corpo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    let interval: ReturnType<typeof setInterval> | undefined
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          interval = setInterval(() => controller.enqueue(new Uint8Array([32])), 1000)
        },
        cancel() {
          clearInterval(interval)
        },
      })
      const request = new Request('https://admin.delegas.example/api/admin/products/dronken', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit)
      const read = readPatchBody(request)
      await vi.advanceTimersByTimeAsync(PATCH_BODY_TIMEOUT_MS)
      expect(await read).toBeNull()
    } finally {
      clearInterval(interval)
      vi.useRealTimers()
    }
  })
})
