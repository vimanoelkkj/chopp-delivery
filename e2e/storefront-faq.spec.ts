import { expect, type Page, test } from '@playwright/test'

/**
 * O FAQ nasce com tudo fechado e não rola a página por conta própria. Abrir uma pergunta nunca a
 * desloca; ao trocar de item, a resposta que fecha acima faz a página abaixo subir (física nativa do
 * layout). O que não pode existir é rolagem artificial nem deslocamento que se acumule entre ciclos.
 */
const viewports = [
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'mobile 390', width: 390, height: 844 },
] as const

async function openFaq(page: Page, height: number) {
  await page.goto('/')
  await expect(page.locator('#faq')).toBeAttached()
  // Posiciona a lista a cerca de um quinto da janela (longe da barra fixa do rodapé no celular).
  await page.evaluate((height) => {
    const list = document.querySelector('#faq button[aria-expanded]')?.closest('div')?.parentElement
    if (!list) throw new Error('lista do FAQ ausente')
    const top = list.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top - height * 0.2, behavior: 'instant' })
  }, height)
  await page.waitForTimeout(400)
}

const triggers = (page: Page) => page.locator('#faq button[aria-expanded]')
const trigger = (page: Page, index: number) => triggers(page).nth(index)
const topOf = (page: Page, index: number) =>
  trigger(page, index).evaluate((node) => node.getBoundingClientRect().top)
const click = (page: Page, index: number) =>
  trigger(page, index).evaluate((node) => (node as HTMLButtonElement).click())
const scrollY = (page: Page) => page.evaluate(() => window.scrollY)
const pageHeight = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight)
const expandedCount = (page: Page) => page.locator('#faq button[aria-expanded="true"]').count()

for (const viewport of viewports) {
  test.describe(`FAQ (conteúdo padrão) em ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: 'no-preference',
    })

    test('nasce fechado e abrir uma pergunta não a desloca nem rola a página', async ({ page }) => {
      await openFaq(page, viewport.height)
      expect(await expandedCount(page)).toBe(0)
      const y = await scrollY(page)
      for (const index of [0, 0, 1, 1]) {
        const before = await topOf(page, index)
        const box = await trigger(page, index).boundingBox()
        if (!box) throw new Error('botão fora da tela')
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        // Abrir (ou fechar o próprio item) não move a pergunta clicada: nada abaixo dela muda de lugar.
        expect(Math.abs((await topOf(page, index)) - before), `Q${index + 1}`).toBeLessThan(1.5)
        expect(Math.abs((await scrollY(page)) - y)).toBeLessThan(1.5)
      }
    })

    test('10 ciclos entre a 1ª e a 2ª pergunta não rolam nem acumulam deslocamento', async ({
      page,
    }) => {
      await openFaq(page, viewport.height)
      await click(page, 0)
      await expect(trigger(page, 0)).toHaveAttribute('aria-expanded', 'true')
      const y0 = await scrollY(page)
      const first0 = await topOf(page, 0)
      const height0 = await pageHeight(page)
      for (let cycle = 1; cycle <= 10; cycle++) {
        await click(page, 1)
        await expect(trigger(page, 1)).toHaveAttribute('aria-expanded', 'true')
        await expect(trigger(page, 0)).toHaveAttribute('aria-expanded', 'false')
        expect(Math.abs((await scrollY(page)) - y0), `ciclo ${cycle}: ida`).toBeLessThan(1.5)
        await click(page, 0)
        await expect(trigger(page, 0)).toHaveAttribute('aria-expanded', 'true')
        expect(Math.abs((await scrollY(page)) - y0), `ciclo ${cycle}: volta`).toBeLessThan(1.5)
        expect(Math.abs((await topOf(page, 0)) - first0), `ciclo ${cycle}: 1ª`).toBeLessThan(1.5)
        expect(Math.abs((await pageHeight(page)) - height0), `ciclo ${cycle}: altura`).toBeLessThan(
          1.5,
        )
      }
    })

    test('sequência mista nunca rola e, com tudo fechado, a página volta ao estado inicial', async ({
      page,
    }) => {
      await openFaq(page, viewport.height)
      const y0 = await scrollY(page)
      const first0 = await topOf(page, 0)
      const height0 = await pageHeight(page)
      const count = await triggers(page).count()
      // Pulos não adjacentes, voltas, fechar e reabrir: sequência fixa (sem aleatoriedade).
      const order = [2, 1, 3, 3, 2, 0, 1, 3, 2, 2, 1, 0, 3, 1, 2, 0, 0, 2, 3, 1].map(
        (n) => n % count,
      )
      for (const index of order) {
        await click(page, index)
        expect(await expandedCount(page)).toBeLessThanOrEqual(1)
        expect(Math.abs((await scrollY(page)) - y0)).toBeLessThan(1.5)
      }
      const open = await page.locator('#faq button[aria-expanded="true"]').count()
      if (open)
        await page
          .locator('#faq button[aria-expanded="true"]')
          .evaluate((n) => (n as HTMLButtonElement).click())
      expect(await expandedCount(page)).toBe(0)
      expect(Math.abs((await topOf(page, 0)) - first0)).toBeLessThan(1.5)
      expect(Math.abs((await pageHeight(page)) - height0)).toBeLessThan(1.5)
    })

    test('teclado: Enter e Espaço alternam a pergunta, mantendo foco e aria-expanded', async ({
      page,
    }) => {
      await openFaq(page, viewport.height)
      const first = trigger(page, 0)
      const second = trigger(page, 1)
      await first.focus()
      await page.keyboard.press('Enter')
      await expect(first).toHaveAttribute('aria-expanded', 'true')
      await expect(first).toBeFocused()
      await second.focus()
      const y = await scrollY(page)
      await page.keyboard.press('Space')
      await expect(second).toHaveAttribute('aria-expanded', 'true')
      await expect(first).toHaveAttribute('aria-expanded', 'false')
      await expect(second).toBeFocused()
      expect(Math.abs((await scrollY(page)) - y)).toBeLessThan(1.5)
      await page.keyboard.press('Enter')
      await expect(second).toHaveAttribute('aria-expanded', 'false')
      await expect(second).toBeFocused()
    })
  })
}
