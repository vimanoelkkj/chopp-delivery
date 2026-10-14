import { expect, test } from '@playwright/test'

test('rotas administrativas reais exigem autenticação e preservam a API pública', async ({
  request,
}) => {
  for (const resource of ['products', 'cachacas']) {
    const response = await request.get(`/api/admin/${resource}`)
    // Ambiente E2E sem bootstrap: falta de sessão ou configuração falha fechada.
    expect([401, 503]).toContain(response.status())
    expect(['UNAUTHENTICATED', 'AUTH_UNAVAILABLE']).toContain((await response.json()).error.code)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(response.headers()['access-control-allow-origin']).toBeUndefined()
    const patch = await request.patch(
      `/api/admin/${resource}/${resource === 'products' ? 'dronken' : 'cachaca'}`,
      { data: { visible: false }, headers: { Origin: new URL(response.url()).origin } },
    )
    expect([401, 503]).toContain(patch.status())
    expect(['UNAUTHENTICATED', 'AUTH_UNAVAILABLE']).toContain((await patch.json()).error.code)
  }
  const catalog = await request.get('/api/products')
  expect(catalog.status()).toBe(200)
  const data = await catalog.json()
  expect(data.products).toHaveLength(8)
  expect(data.cachaca).toMatchObject({ id: 'cachaca', price: 30 })
})

test('métodos e parâmetros de rota administrativos chegam às Functions corretas', async ({
  request,
}) => {
  for (const resource of ['products', 'cachacas']) {
    const collection = await request.post(`/api/admin/${resource}`)
    expect(collection.status()).toBe(405)
    expect(collection.headers().allow).toBe('GET')
    const item = await request.get(`/api/admin/${resource}/missing`)
    expect(item.status()).toBe(405)
    expect(item.headers().allow).toBe('PATCH')
    const head = await request.head(`/api/admin/${resource}/missing`)
    expect(head.status()).toBe(405)
    expect(await head.body()).toHaveLength(0)
    const options = await request.fetch(`/api/admin/${resource}/missing`, { method: 'OPTIONS' })
    expect(options.status()).toBe(405)
    expect(options.headers().allow).toBe('PATCH')
  }
  const unknown = await request.get('/api/admin/missing/path')
  expect(unknown.status()).toBe(404)
  expect((await unknown.json()).error.code).toBe('NOT_FOUND')
})
