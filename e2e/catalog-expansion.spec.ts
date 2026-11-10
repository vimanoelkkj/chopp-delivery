import { expect, test } from '@playwright/test'
import type { PublicCatalog } from '../shared/catalog'

test('rota administrativa v2 real falha fechada e preserva revisão pública', async ({
  request,
  playwright,
}) => {
  const catalogResponse = await request.get('/api/catalog')
  const origin = new URL(catalogResponse.url()).origin
  const before = await catalogResponse.json()
  for (const method of ['GET', 'PUT']) {
    const response = await request.fetch('/api/admin/catalog/v2', {
      method,
      ...(method === 'PUT'
        ? {
            data: { revision: before.revision, categories: [] },
            headers: { Origin: origin, 'If-Match': `"${before.revision}"` },
          }
        : {}),
    })
    expect([401, 503]).toContain(response.status())
    expect(['UNAUTHENTICATED', 'AUTH_UNAVAILABLE']).toContain((await response.json()).error.code)
  }
  // An early 401 with an unread body may close the emulated Pages connection.
  // Method dispatch is independent of that connection; do not retry a reset.
  const methodContext = await playwright.request.newContext({ baseURL: origin })
  try {
    const invalidMethod = await methodContext.post('/api/admin/catalog/v2', { maxRetries: 0 })
    expect(invalidMethod.status()).toBe(405)
    expect(invalidMethod.headers().allow).toBe('GET, PUT')
    expect(await (await methodContext.get('/api/catalog')).json()).toEqual(before)
  } finally {
    await methodContext.dispose()
  }
})

for (const width of [1280, 390])
  test(`catálogo expansível completo em ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 })
    const data = (await (await request.get('/api/catalog')).json()) as PublicCatalog
    data.categories[0].items[0].variants.push({
      code: '20',
      label: 'Barril especial',
      volumeMl: 20000,
      priceCents: 32129,
    })
    const bottle = structuredClone(data.categories[1].items[0])
    bottle.id = 'new-bottle'
    bottle.name = 'Cachaça segunda'
    bottle.variants.push({
      code: 'large',
      label: 'Garrafa grande',
      volumeMl: 1000,
      priceCents: 5901,
    })
    data.categories[1].items.push(bottle)
    data.categories.push({
      id: 'future',
      name: 'Categoria futura',
      items: [
        {
          id: 'future-item',
          name: 'Produto futuro',
          description: 'Descrição futura',
          visible: true,
          variants: [{ code: 'unit', label: 'Unidade', volumeMl: null, priceCents: 199 }],
        },
      ],
    })
    await page.route('**/api/catalog', (route) => route.fulfill({ json: data }))
    await page.goto('/')
    // 30/50 L ficam na tabela; a variante extra entra na lista complementar, em litros e com pedido.
    const extra = page.getByRole('article', { name: 'Dronken' })
    await expect(extra).toContainText('Barril especial · 20 L')
    await expect(extra).toContainText('R$ 321,29')
    await expect(
      extra.getByRole('button', { name: /^Pedir Dronken, Barril especial/ }),
    ).toHaveCount(1)
    await expect(page.getByRole('row', { name: /Brahma/ })).toContainText('Indisponível')
    await expect(page.getByRole('complementary', { name: 'Temos cachaça' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Cachaça segunda' })).toContainText(
      'Garrafa grande 1000 ml · R$ 59,01',
    )
    await expect(page.getByRole('heading', { name: 'Categoria futura' })).toBeVisible()
    const future = page.getByRole('article', { name: 'Produto futuro' })
    await expect(future).toContainText('Unidade')
    await expect(future).toContainText('R$ 1,99')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
