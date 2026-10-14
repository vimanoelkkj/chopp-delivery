import { expect, test } from '@playwright/test'
import type { Catalog } from '../src/features/catalog/types'

test('API pública atende o catálogo real em JSON', async ({ request }) => {
  const response = await request.get('/api/products')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const data = (await response.json()) as Catalog
  expect(data.products).toHaveLength(8)
  expect(data.products.every((item) => typeof item.id === 'string' && item.visible)).toBe(true)
  expect(data.products.find((item) => item.id === 'brahma')?.prices[30]).toBeNull()
  expect(data.cachaca).toMatchObject({ id: 'cachaca', bottleMl: 700, price: 30 })
  const post = await request.post('/api/products')
  expect(post.status()).toBe(405)
})

test('mostra carregamento sem preços estáticos e depois mostra o catálogo', async ({ page }) => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/products', async (route) => {
    await gate
    await route.continue()
  })
  await page.goto('/')
  try {
    await expect(
      page.getByRole('status', { name: '' }).filter({ hasText: 'Carregando catálogo' }),
    ).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await expect(page.locator('#barris')).not.toContainText('R$')
  } finally {
    release()
  }
  await expect(page.locator('tbody tr')).toHaveCount(8)
})

test('falha da API não mostra seed e tentar novamente recupera o catálogo', async ({ page }) => {
  let fail = true
  await page.route('**/api/products', async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: { code: 'CATALOG_UNAVAILABLE' } } })
    else await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Catálogo indisponível')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(page.locator('#barris')).not.toContainText('R$')
  await expect(page.getByText('Garrafa 700 ml')).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(8)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('catálogo vazio e cachaça oculta têm estado explícito', async ({ page }) => {
  await page.route('**/api/products', (route) =>
    route.fulfill({ json: { products: [], cachaca: null } }),
  )
  await page.goto('/')
  await expect(
    page.getByRole('status').filter({ hasText: 'Nenhum chope disponível' }),
  ).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Temos cachaça' })).toHaveCount(0)
  await expect(page.locator('#barris')).not.toContainText('R$')
})

test('preço decimal da API aparece sem arredondamento e muda após nova leitura', async ({
  page,
  request,
}) => {
  const data = (await (await request.get('/api/products')).json()) as Catalog
  data.products[0].prices[30] = 510.29
  await page.route('**/api/products', (route) => route.fulfill({ json: data }))
  await page.goto('/')
  await expect(page.getByRole('row', { name: /Dronken/ })).toContainText('R$ 510,29')
  data.products[0].prices[30] = 510.99
  await page.reload()
  await expect(page.getByRole('row', { name: /Dronken/ })).toContainText('R$ 510,99')
})
