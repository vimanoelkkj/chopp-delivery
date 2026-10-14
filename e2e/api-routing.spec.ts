import { expect, test } from '@playwright/test'

test('rotas desconhecidas de API retornam JSON e preservam o catálogo', async ({ request }) => {
  for (const path of ['/api', '/api/', '/api/desconhecida', '/api/products/desconhecida']) {
    const response = await request.get(path)
    expect(response.status()).toBe(404)
    expect(response.headers()['content-type']).toContain('application/json')
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado.' },
    })
  }
  for (const path of ['/api/products', '/api/products/']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    expect((await response.json()).products).toHaveLength(8)
  }
})

test('fallback de API não captura rotas React ou assets', async ({ request }) => {
  for (const path of ['/', '/rota-react', '/api-outside']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(await response.text()).toContain('<div id="root">')
  }
  const favicon = await request.get('/favicon.png')
  expect(favicon.status()).toBe(200)
  expect(favicon.headers()['content-type']).toContain('image/png')
})

test('HEAD e OPTIONS respeitam o contrato restrito do catálogo', async ({ request }) => {
  const head = await request.head('/api/products')
  expect(head.status()).toBe(405)
  expect(head.headers().allow).toBe('GET')
  expect(await head.body()).toHaveLength(0)
  const options = await request.fetch('/api/products', { method: 'OPTIONS' })
  expect(options.status()).toBe(405)
  expect(options.headers().allow).toBe('GET')
  expect(options.headers()['access-control-allow-origin']).toBeUndefined()
  const unknownHead = await request.head('/api/desconhecida')
  expect(unknownHead.status()).toBe(404)
  expect(unknownHead.headers()['content-type']).toContain('application/json')
  expect(await unknownHead.body()).toHaveLength(0)
})
