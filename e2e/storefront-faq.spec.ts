import { expect, type Page, test } from '@playwright/test'

/**
 * O primeiro item do FAQ nasce aberto. Ao abrir outra pergunta, a resposta aberta fecha ACIMA do botão
 * clicado e a página abaixo dela sobe de uma vez. A pergunta clicada tem de ficar parada na tela.
 */
const viewports = [
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'mobile 390', width: 390, height: 844 },
] as const

async function openFaq(page: Page, height: number) {
  await page.goto('/')
  await expect(page.locator('#faq')).toBeAttached()
  // Posiciona a lista a cerca de um terço da janela (longe da barra fixa do rodapé no celular).
  await page.evaluate((height) => {
    const list = document.querySelector('#faq button[aria-expanded]')?.closest('div')?.parentElement
    if (!list) throw new Error('lista do FAQ ausente')
    const top = list.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top - height * 0.2, behavior: 'instant' })
  }, height)
  await page.waitForTimeout(400)
}

const trigger = (page: Page, index: number) => page.locator('#faq button[aria-expanded]').nth(index)
const topOf = (page: Page, index: number) =>
  trigger(page, index).evaluate((node) => node.getBoundingClientRect().top)

async function expectQuestionStaysPut(page: Page, height: number) {
  await openFaq(page, height)
  await expect(trigger(page, 0)).toHaveAttribute('aria-expanded', 'true')
  const scrollBefore = await page.evaluate(() => window.scrollY)

  // Primeiro clique: fecha o item 1 (acima) e abre o 2. O botão clicado não pode se mover.
  const before = await topOf(page, 1)
  const box = await trigger(page, 1).boundingBox()
  if (!box) throw new Error('botão fora da tela')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(trigger(page, 1)).toHaveAttribute('aria-expanded', 'true')
  await expect(trigger(page, 0)).toHaveAttribute('aria-expanded', 'false')
  expect(Math.abs((await topOf(page, 1)) - before)).toBeLessThan(1.5)
  // A correção vem da rolagem (a resposta fechada tinha altura), não de um salto do conteúdo.
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(scrollBefore)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(
    await trigger(page, 1).getAttribute('id'),
  )

  // Segundo clique: item 3 abre e o 2 (acima) fecha; de novo, o botão clicado fica parado.
  const before3 = await topOf(page, 2)
  const box3 = await trigger(page, 2).boundingBox()
  if (!box3 || box3.y + box3.height > height - 90) return // barra fixa do celular cobriria o clique
  await page.mouse.click(box3.x + box3.width / 2, box3.y + box3.height / 2)
  await expect(trigger(page, 2)).toHaveAttribute('aria-expanded', 'true')
  expect(Math.abs((await topOf(page, 2)) - before3)).toBeLessThan(1.5)

  // Fechar o item aberto não mexe em nada acima dele: a janela não rola.
  const scrollClose = await page.evaluate(() => window.scrollY)
  const box3b = await trigger(page, 2).boundingBox()
  if (!box3b) throw new Error('botão fora da tela')
  await page.mouse.click(box3b.x + box3b.width / 2, box3b.y + box3b.height / 2)
  await expect(trigger(page, 2)).toHaveAttribute('aria-expanded', 'false')
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollClose)).toBeLessThan(1.5)
}

for (const viewport of viewports) {
  test.describe(`FAQ (conteúdo padrão) em ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: 'no-preference',
    })

    test('o primeiro clique não desloca a pergunta clicada', async ({ page }) => {
      await expectQuestionStaysPut(page, viewport.height)
    })

    test('teclado: Enter abre a pergunta sem deslocá-la e mantém foco e aria-expanded', async ({
      page,
    }) => {
      await openFaq(page, viewport.height)
      const second = trigger(page, 1)
      await second.focus()
      const before = await topOf(page, 1)
      await page.keyboard.press('Enter')
      await expect(second).toHaveAttribute('aria-expanded', 'true')
      await expect(trigger(page, 0)).toHaveAttribute('aria-expanded', 'false')
      expect(Math.abs((await topOf(page, 1)) - before)).toBeLessThan(1.5)
      await expect(second).toBeFocused()
      await page.keyboard.press('Space')
      await expect(second).toHaveAttribute('aria-expanded', 'false')
      await expect(second).toBeFocused()
    })
  })
}
