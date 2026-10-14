import { expect, test } from '@playwright/test'

test('snapshot e salvamento atômico reais falham fechados sem sessão', async ({ request }) => {
  const before = await (await request.get('/api/products')).json()
  for (const method of ['GET', 'PUT']) {
    const response = await request.fetch('/api/admin/catalog', {
      method,
      ...(method === 'PUT'
        ? { data: { revision: 'r0', chopes: [], cachacas: [] }, headers: { 'If-Match': '"r0"' } }
        : {}),
    })
    expect([401, 503]).toContain(response.status())
    expect(['UNAUTHENTICATED', 'AUTH_UNAVAILABLE']).toContain((await response.json()).error.code)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(response.headers()['access-control-allow-origin']).toBeUndefined()
    expect(response.headers().etag).toBeUndefined()
  }
  expect(await (await request.get('/api/products')).json()).toEqual(before)
})

test('rota atômica aceita somente os métodos GET e PUT', async ({ request }) => {
  for (const method of ['POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await request.fetch('/api/admin/catalog', { method })
    expect(response.status()).toBe(405)
    expect(response.headers().allow).toBe('GET, PUT')
    if (method === 'HEAD') expect(await response.body()).toHaveLength(0)
    else expect((await response.json()).error.code).toBe('METHOD_NOT_ALLOWED')
  }
})
