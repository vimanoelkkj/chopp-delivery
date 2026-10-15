import { expect, type Page, test } from '@playwright/test'
import { heterogeneousCatalog, standardCatalog } from './support/catalog'

/**
 * O CSS troca tabela por cards em max-width 47.9375rem (767 px). A borda 767/768 nunca era medida:
 * a suíte antiga ia de 820 para 412.
 */
const widths = [767, 768, 1024]
const showsCards = (width: number) => width <= 767

async function open(page: Page, width: number, catalog: object) {
  await page.setViewportSize({ width, height: 900 })
  await page.route('**/api/catalog', (route) => route.fulfill({ json: catalog }))
  await page.goto('/')
  await expect(page.getByTestId('catalog-count-note')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const leaks = (page: Page) =>
  page.evaluate(() => {
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
        if (getComputedStyle(p).overflowX !== 'visible') return true
      return false
    }
    return [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5 && !clipped(el))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
  })

for (const width of widths) {
  test.describe(`catálogo em ${width}px`, () => {
    test('mostra só a tabela ou só os cards, com as mesmas ofertas', async ({ page }) => {
      await open(page, width, standardCatalog())
      const table = page.getByRole('table')
      const card = page.getByRole('article', { name: 'Dronken', exact: true })
      if (showsCards(width)) {
        await expect(table).toHaveCount(0)
        await expect(card).toBeVisible()
      } else {
        await expect(table).toBeVisible()
        await expect(card).toHaveCount(0)
      }
      // Dronken oferece 30 L e 50 L em qualquer layout; Kaiser só 50 L.
      await expect(
        page.getByRole('button', { name: /Pedir Dronken, Barril de 30 L/ }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: /Pedir Dronken, Barril de 50 L/ }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: /Pedir Kaiser, Barril de 30 L/ })).toHaveCount(
        0,
      )
      await expect(page.getByRole('button', { name: /Pedir Kaiser, Barril de 50 L/ })).toBeVisible()
    })

    test('sem rolagem horizontal, nada vaza e alvos de toque têm ao menos 44 px', async ({
      page,
    }) => {
      await open(page, width, standardCatalog())
      expect(await overflow(page)).toBe(0)
      expect(await leaks(page)).toEqual([])
      for (const name of [/Pedir Dronken, Barril de 30 L/, /Pedir Dronken, Barril de 50 L/]) {
        const box = await page.getByRole('button', { name }).boundingBox()
        if (!box) throw new Error('alvo de toque sem caixa')
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
    })

    test('layout heterogêneo com nome longo e 8 apresentações não estoura', async ({ page }) => {
      await open(page, width, heterogeneousCatalog())
      expect(await overflow(page)).toBe(0)
      expect(await leaks(page)).toEqual([])
      const offers = page.getByRole('button', { name: /Pedir A{70}, Barril especial número/ })
      await expect(offers).toHaveCount(8)
    })
  })
}
