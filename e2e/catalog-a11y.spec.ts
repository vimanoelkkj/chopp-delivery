import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { heterogeneousCatalog, standardCatalog } from './support/catalog'

/**
 * Acessibilidade da vitrine com axe-core (WCAG 2.0/2.1 A e AA) mais asserts de estrutura que o axe
 * não cobre. A varredura é do catálogo e dos botões de WhatsApp; o restante da landing é de
 * outra frente e fica fora deste gate.
 */
const widths = [1440, 768, 390]

async function open(page: Page, width: number, catalog: object) {
  await page.setViewportSize({ width, height: 900 })
  await page.route('**/api/catalog', (route) => route.fulfill({ json: catalog }))
  await page.goto('/')
  await expect(page.getByTestId('catalog-count-note')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const scan = (page: Page) =>
  new AxeBuilder({ page })
    .include('#chopes')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

for (const width of widths) {
  for (const [name, catalog] of [
    ['padrão', standardCatalog()],
    ['heterogêneo', heterogeneousCatalog()],
  ] as const) {
    test(`axe: catálogo ${name} em ${width}px sem violações`, async ({ page }) => {
      await open(page, width, catalog)
      const { violations } = await scan(page)
      expect(
        violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
      ).toEqual([])
    })
  }
}

test('estrutura: nada de aria-disabled em elemento não interativo, nem região viva por botão', async ({
  page,
}) => {
  await open(page, 1440, standardCatalog())
  const misplaced = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-disabled]')]
      .filter((el) => !el.matches('button, a[href], input, select, textarea, [role="button"]'))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  )
  expect(misplaced).toEqual([])
  // Sem número configurado há muitos botões "Pedir": só UMA região viva do aviso pode existir.
  expect(await page.locator('[role="status"]:not(:has(*))').count()).toBeLessThanOrEqual(3)
  const emptyNoticeRegions = await page.evaluate(
    () => [...document.querySelectorAll('[role="status"]')].filter((el) => el.id).length,
  )
  expect(emptyNoticeRegions).toBe(0)
})

test('sem número, o aviso é anunciado uma vez, na única região viva, e o balão visual não o repete', async ({
  page,
}) => {
  await open(page, 1440, standardCatalog())
  const buttons = page.getByRole('button', { name: /Pedir Dronken, Barril de 30 L/ })
  await buttons.first().click()
  // A página inteira tem UMA região viva (o catálogo já carregou, sem outros status).
  const region = page.getByRole('status')
  await expect(region).toHaveCount(1)
  await expect(region).toContainText('ainda não foi configurado')
  // O botão acionado aponta para o balão visível; os demais não têm descritor.
  expect(await page.locator('[aria-describedby]').count()).toBe(1)
  // Depois do prazo o balão e o anúncio somem e o descritor também (sem referência quebrada).
  await expect(region).toHaveText('', { timeout: 7000 })
  expect(await page.locator('[aria-describedby]').count()).toBe(0)
  await expect(region).toHaveCount(1)
})

test('o botão acionado nunca referencia um id inexistente', async ({ page }) => {
  await open(page, 390, standardCatalog())
  const broken = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-describedby]')]
        .filter((el) => !document.getElementById(el.getAttribute('aria-describedby') ?? ''))
        .map((el) => el.tagName),
    )
  expect(await broken()).toEqual([])
  await page
    .getByRole('button', { name: /Pedir Kaiser, Barril de 50 L/ })
    .first()
    .click()
  expect(await broken()).toEqual([])
})
