import { expect, test } from '@playwright/test'
import type { PublicCatalog } from '../shared/catalog'

test('rota administrativa v2 real falha fechada e preserva revisão pública', async ({
  request,
}) => {
  const before = await (await request.get('/api/catalog')).json()
  for (const method of ['GET', 'PUT']) {
    const response = await request.fetch('/api/admin/catalog/v2', {
      method,
      ...(method === 'PUT'
        ? {
            data: { revision: before.revision, categories: [] },
            headers: { 'If-Match': `"${before.revision}"` },
          }
        : {}),
    })
    expect([401, 503]).toContain(response.status())
    expect(['UNAUTHENTICATED', 'AUTH_UNAVAILABLE']).toContain((await response.json()).error.code)
  }
  const invalidMethod = await request.post('/api/admin/catalog/v2')
  expect(invalidMethod.status()).toBe(405)
  expect(invalidMethod.headers().allow).toBe('GET, PUT')
  expect(await (await request.get('/api/catalog')).json()).toEqual(before)
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
    const offers = (name: string) =>
      width >= 768
        ? page.getByRole('row', { name: new RegExp(name) })
        : page.getByRole('article', { name, exact: true })
    await expect(offers('Dronken')).toContainText('Barril especial · 20 L')
    await expect(offers('Dronken')).toContainText('321,29')
    await expect(offers('Brahma')).toContainText('não disponível')
    await expect(page.getByTestId('cachaca-card-cachaca')).toBeVisible()
    await expect(page.getByTestId('cachaca-card-new-bottle')).toContainText(
      'Garrafa grande 1.000 ml',
    )
    await expect(page.getByTestId('cachaca-card-new-bottle')).toContainText('59,01')
    await expect(page.getByRole('heading', { name: 'Categoria futura' })).toBeVisible()
    await expect(offers('Produto futuro')).toContainText('Unidade')
    await expect(offers('Produto futuro')).toContainText('1,99')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
