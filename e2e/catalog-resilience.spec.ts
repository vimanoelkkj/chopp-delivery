import { expect, test } from '@playwright/test'
import { standardCatalog } from './support/catalog'

test('sem resposta em 10 s a vitrine mostra erro; tentar novamente recupera', async ({ page }) => {
  await page.clock.install()
  let requests = 0
  await page.route('**/api/catalog', async (route) => {
    requests++
    if (requests === 1) return // a primeira leitura nunca responde
    await route.fulfill({ json: standardCatalog() })
  })
  await page.goto('/')
  const loading = page.getByRole('status').filter({ hasText: 'Carregando catálogo' })
  await expect(loading).toBeVisible()

  await page.clock.fastForward(9_000)
  await expect(loading).toBeVisible() // ainda dentro do prazo
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.clock.fastForward(1_500)
  await expect(page.getByRole('alert')).toContainText('Catálogo indisponível')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(page.locator('#barris')).not.toContainText('R$')
  expect(requests).toBe(1)

  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(requests).toBe(2)
})

test('resposta tardia de uma tentativa descartada não sobrescreve a nova leitura', async ({
  page,
}) => {
  await page.clock.install()
  const late = standardCatalog()
  late.categories[0].items[0].name = 'Resposta Antiga'
  let requests = 0
  let releaseFirst = () => {}
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  await page.route('**/api/catalog', async (route) => {
    requests++
    if (requests === 1) {
      await firstGate
      await route.fulfill({ json: late }).catch(() => undefined) // a página já abortou
      return
    }
    await route.fulfill({ json: standardCatalog() })
  })
  await page.goto('/')
  await page.clock.fastForward(10_500)
  await expect(page.getByRole('alert')).toContainText('Catálogo indisponível')
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  releaseFirst()
  await page.waitForTimeout(300)
  await expect(page.getByText('Resposta Antiga')).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Dronken/ })).toBeVisible()
})
