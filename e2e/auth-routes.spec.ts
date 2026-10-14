import { expect, test } from '@playwright/test'

test('Functions de auth existem, recusam métodos indevidos e não afetam o catálogo', async ({
  request,
}) => {
  for (const [path, method, allow] of [
    ['/api/auth/login', 'GET', 'POST'],
    ['/api/auth/logout', 'GET', 'POST'],
    ['/api/auth/me', 'POST', 'GET'],
  ]) {
    const response = await request.fetch(path, { method })
    expect(response.status()).toBe(405)
    expect(response.headers().allow).toBe(allow)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(response.headers()['access-control-allow-origin']).toBeUndefined()
    expect((await response.json()).error.code).toBe('METHOD_NOT_ALLOWED')
  }
  const head = await request.head('/api/auth/me')
  expect(head.status()).toBe(405)
  expect(await head.body()).toHaveLength(0)
  expect((await request.get('/api/auth/desconhecida')).status()).toBe(404)
  const catalog = await request.get('/api/products')
  expect(catalog.status()).toBe(200)
  expect((await catalog.json()).products).toHaveLength(8)
})
