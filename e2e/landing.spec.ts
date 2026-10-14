import { expect, type Page, test } from '@playwright/test'

// As verificações visuais precisam medir o catálogo real, depois da leitura D1.
async function openLanding(page: Page) {
  await page.goto('/')
  await expect(page.locator('tbody tr')).toHaveCount(8)
}

const viewports = [1440, 820, 412, 390, 360]

for (const width of viewports) {
  test(`sem rolagem horizontal em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openLanding(page)
    await page.evaluate(() => document.fonts.ready)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })

  // O body corta overflow-x; por isso também se confere elemento a elemento, ignorando só o
  // que está dentro de um contêiner que corta de propósito (a faixa em movimento).
  test(`nenhum elemento vaza da tela em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openLanding(page)
    await page.evaluate(() => document.fonts.ready)
    const leaks = await page.evaluate(() => {
      const clipped = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return true
        }
        return false
      }
      return [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5 && !clipped(el))
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
    })
    expect(leaks).toEqual([])
  })
}

test('mostra os oito chopes e a cachaça com os preços dos dados', async ({ page }) => {
  await openLanding(page)
  await expect(page.locator('tbody tr')).toHaveCount(8)
  await expect(page.getByRole('row', { name: /Brahma/ })).toContainText('não disponível')
  await expect(page.getByRole('row', { name: /Dronken/ })).toContainText('R$ 510')
  await expect(page.getByText('Garrafa 700 ml')).toBeVisible()
})

test('FAQ abre e fecha por teclado, um item por vez', async ({ page }) => {
  await openLanding(page)
  const first = page.getByRole('button', { name: /Qual a diferença/ })
  const second = page.getByRole('button', { name: /Vocês entregam/ })
  await expect(first).toHaveAttribute('aria-expanded', 'true')
  await second.focus()
  await page.keyboard.press('Enter')
  await expect(second).toHaveAttribute('aria-expanded', 'true')
  await expect(first).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(second).toHaveAttribute('aria-expanded', 'false')
})

test('links de navegação levam às seções', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openLanding(page)
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Barris' })
    .click()
  await expect(page).toHaveURL(/#barris$/)
  await expect(page.locator('#barris')).toBeInViewport()
})

test('menu mobile abre, lista os links e fecha com Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLanding(page)
  const toggle = page.getByRole('button', { name: 'Abrir menu' })
  await toggle.click()
  await expect(page.getByRole('link', { name: 'Como funciona' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(page.getByRole('link', { name: 'Como funciona' })).toBeHidden()
})

test('sem número configurado, o WhatsApp avisa em vez de fingir que abre', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openLanding(page)
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Pedir no WhatsApp' }).first().click()
  await expect(
    page.getByRole('status').filter({ hasText: 'ainda não foi configurado' }),
  ).toHaveCount(1)
})

test('título do Hero: quebra fixa em quatro linhas no desktop', async ({ page }) => {
  for (const width of [1440, 820]) {
    await page.setViewportSize({ width, height: 900 })
    await openLanding(page)
    await page.evaluate(() => document.fonts.ready)
    const title = page.locator('#hero-title')
    const lines = await title.evaluate((h1) => {
      // Cada trecho de texto do título é medido; as linhas são as posições verticais distintas.
      const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT)
      const words: string[] = []
      const tops: Record<string, number> = {}
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const word = (node.textContent ?? '').trim().toLowerCase()
        if (!word) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        words.push(word)
        tops[word] = Math.round(range.getClientRects()[0].top)
      }
      return { words, tops }
    })
    expect(lines.words).toEqual(['chope', 'gelado', 'na', 'porta.'])
    const t = lines.tops
    expect(t.chope).toBeLessThan(t.gelado)
    expect(t.gelado).toBeLessThan(t.na)
    expect(t.na).toBeLessThan(t['porta.'])
    // O título cabe na coluna: a palavra mais larga não sai do contêiner.
    const fits = await title.evaluate((h1) => h1.scrollWidth <= h1.clientWidth)
    expect(fits).toBe(true)
  }
})

test('título do Hero: "na porta." fica na mesma linha no celular', async ({ page }) => {
  for (const width of [412, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await openLanding(page)
    await page.evaluate(() => document.fonts.ready)
    const [na, porta] = await page.locator('#hero-title span').evaluateAll((spans) => {
      const span = spans[0]
      const range = document.createRange()
      range.selectNodeContents(span)
      return [...range.getClientRects()].map((r) => Math.round(r.top))
    })
    expect(na).toBe(porta ?? na)
  }
})

test('aviso de maiores de 18 anos aparece no Hero e no rodapé, sem modal', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await openLanding(page)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    for (const id of ['hero', 'footer']) {
      const notice = page.getByTestId(`age-notice-${id}`)
      await expect(notice).toContainText(
        'Venda proibida para menores de 18 anos. Beba com moderação.',
      )
      const size = await notice.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
      expect(size).toBeGreaterThanOrEqual(14)
    }
  }
})

test('FAQ de pagamento não afirma formas nem taxas sem confirmação', async ({ page }) => {
  await openLanding(page)
  await page.getByRole('button', { name: 'Quais as formas de pagamento?' }).click()
  const panel = page.getByRole('region', { name: 'Quais as formas de pagamento?' })
  await expect(panel).toContainText('confirmação comercial')
  await expect(panel).not.toContainText(/%|pix|crédito|débito/i)
})

test.describe('CTA fixo no celular', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('some enquanto o CTA do Hero está à vista, aparece depois e some no CTA final', async ({
    page,
  }) => {
    await openLanding(page)
    const bar = page.getByTestId('sticky-cta')
    await expect(bar).toHaveAttribute('data-visible', 'false')
    await expect(bar.getByRole('button')).toBeHidden()

    await page.locator('#barris').scrollIntoViewIfNeeded()
    await expect(bar).toHaveAttribute('data-visible', 'true')
    await expect(bar.getByRole('button', { name: 'Pedir no WhatsApp' })).toBeVisible()

    await page.locator('#contato').getByRole('button').scrollIntoViewIfNeeded()
    await expect(bar).toHaveAttribute('data-visible', 'false')
  })

  test('não cobre conteúdo: o fim da página deixa espaço para a barra', async ({ page }) => {
    await openLanding(page)
    const padding = await page
      .locator('#topo')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom))
    expect(padding).toBeGreaterThanOrEqual(72)
  })

  test('escondido, não entra na ordem de foco do teclado', async ({ page }) => {
    await openLanding(page)
    await expect(page.getByTestId('sticky-cta')).toHaveAttribute('inert', '')
    const reached: string[] = []
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      reached.push(
        await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.closest('[data-testid=sticky-cta]')
            ? 'sticky'
            : 'outro',
        ),
      )
    }
    expect(reached).not.toContain('sticky')
  })
})

test('no desktop o CTA fixo nunca aparece', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openLanding(page)
  await page.locator('#barris').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('sticky-cta')).toBeHidden()
})

test('teclado: o link de pular conteúdo recebe o foco com contorno visível', async ({ page }) => {
  await openLanding(page)
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Ir para o conteúdo' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).not.toBe('none')
})

test.describe('movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })

  test('a faixa em movimento para e a barra fixa não anima', async ({ page }) => {
    await openLanding(page)
    const animated = await page.evaluate(
      () =>
        [...document.querySelectorAll('body *')].filter(
          (el) => getComputedStyle(el).animationName !== 'none',
        ).length,
    )
    expect(animated).toBe(0)
    const transition = await page
      .getByTestId('sticky-cta')
      .evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(transition).toBe('0s')
    const behavior = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    )
    expect(behavior).toBe('auto')
  })
})

test('com movimento normal a faixa anima (controle do teste acima)', async ({ page }) => {
  await openLanding(page)
  const animated = await page.evaluate(
    () =>
      [...document.querySelectorAll('body *')].filter(
        (el) => getComputedStyle(el).animationName !== 'none',
      ).length,
  )
  expect(animated).toBeGreaterThan(0)
})
