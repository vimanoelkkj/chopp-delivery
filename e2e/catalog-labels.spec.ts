import { expect, test } from '@playwright/test'
import { standardCatalog } from './support/catalog'

test('rótulos que já informam o volume (7.5 L, 1000 ml) não o repetem na vitrine', async ({
  page,
}) => {
  const catalog = standardCatalog()
  catalog.categories[0].items.push({
    id: 'sete-e-meio',
    name: 'Chope Sete e Meio',
    description: 'Chopp',
    visible: true,
    variants: [{ code: 'v_a', label: 'Barril 7.5 L', volumeMl: 7500, priceCents: 30000 }],
  })
  catalog.categories[1].items[0].variants = [
    { code: 'v_b', label: 'Garrafa 1000 ml', volumeMl: 1000, priceCents: 6000 },
  ]
  await page.route('**/api/catalog', (route) => route.fulfill({ json: catalog }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('catalog-count-note')).toBeVisible()

  const beer = page.getByRole('row', { name: /Chope Sete e Meio/ })
  await expect(beer).toContainText('Barril 7.5 L')
  await expect(beer).not.toContainText('7,5 L')
  const bottle = page.getByTestId('cachaca-card-cachaca')
  await expect(bottle).toContainText('Garrafa 1000 ml')
  await expect(bottle).not.toContainText('1.000 ml')
})
