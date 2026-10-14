import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCatalog, parseCatalog } from './api'
import { cachaca, products } from './products'

const catalog = () => structuredClone({ products, cachaca: { id: 'cachaca', ...cachaca } })

afterEach(() => vi.unstubAllGlobals())

describe('fronteira da API pública', () => {
  it('valida o contrato atual e o catálogo vazio', () => {
    expect(parseCatalog(catalog())).toEqual(catalog())
    expect(parseCatalog({ products: [], cachaca: null })).toEqual({ products: [], cachaca: null })
  })

  it('preserva centavos e tamanhos null', () => {
    const data = catalog()
    data.products[0].prices[30] = 490.99
    expect(parseCatalog(data).products[0].prices[30]).toBe(490.99)
    expect(parseCatalog(data).products[4].prices[30]).toBeNull()
  })

  it.each([
    { id: 1 },
    { visible: false },
    { name: '' },
    { description: null },
    { prices: { 30: 1.005, 50: null } },
    { prices: { 30: -1, 50: null } },
    { prices: { 30: '510', 50: null } },
  ])('recusa produto inválido: %j', (invalid) => {
    const data = catalog()
    expect(() =>
      parseCatalog({ ...data, products: [{ ...data.products[0], ...invalid }] }),
    ).toThrow()
  })

  it.each([{ id: 1 }, { bottleMl: 0 }, { price: 30.001 }])(
    'recusa cachaça inválida: %j',
    (invalid) => {
      const data = catalog()
      expect(() => parseCatalog({ ...data, cachaca: { ...data.cachaca, ...invalid } })).toThrow()
    },
  )

  it('recusa IDs duplicados e resposta sem contrato', () => {
    expect(() => parseCatalog({ products: [products[0], products[0]], cachaca: null })).toThrow()
    expect(() => parseCatalog('<html>')).toThrow()
  })

  it('faz apenas GET público e não usa cache de preços', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(catalog()))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    expect(await fetchCatalog(signal)).toEqual(catalog())
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/api/products', {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  })

  it('propaga falha da API, sem fallback para produtos estáticos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: {} }, { status: 503 })))
    await expect(fetchCatalog(new AbortController().signal)).rejects.toThrow()
  })
})
