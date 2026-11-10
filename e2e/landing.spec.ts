import { expect, type Locator, type Page, test } from '@playwright/test'
import type { PublicCatalog } from '../shared/catalog'

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
  await expect(first).toHaveAttribute('aria-expanded', 'false')
  await first.focus()
  await page.keyboard.press('Enter')
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

// Original: quatro linhas e nós de texto "Chope / gelado / na / porta".
// C usa headline fluida: verificar semântica e geometria, sem contar linhas.
async function assertHeroGeometry(hero: Locator) {
  const issues = await hero.evaluate((section) => {
    const heading = section.querySelector('h1')
    const controls = [...section.querySelectorAll('a, button')]
    const image = section.querySelector('img')
    if (!heading || !image) throw new Error('Hero sem heading ou imagem')
    const clipped: string[] = []
    const check = (rect: DOMRect, element: Element, label: string) => {
      let left = 0,
        right = innerWidth,
        top = -Infinity,
        bottom = Infinity
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent),
          bounds = parent.getBoundingClientRect()
        if (style.overflowX !== 'visible') {
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, bounds.top)
          bottom = Math.min(bottom, bounds.bottom)
        }
      }
      if (
        rect.left < left - 1 ||
        rect.right > right + 1 ||
        rect.top < top - 1 ||
        rect.bottom > bottom + 1
      )
        clipped.push(label)
    }
    for (const element of [heading, image, ...controls]) {
      check(element.getBoundingClientRect(), element.parentElement ?? section, element.tagName)
      if (element === image) continue
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(walker.currentNode)
        for (const rect of range.getClientRects())
          check(rect, walker.currentNode.parentElement ?? element, walker.currentNode.textContent)
      }
    }
    const overlaps: string[] = []
    const targets = [heading, ...controls, image]
    for (let i = 0; i < targets.length; i++)
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i].getBoundingClientRect(),
          b = targets[j].getBoundingClientRect()
        if (
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        )
          overlaps.push(`${targets[i].tagName}/${targets[j].tagName}`)
      }
    return { clipped, overlaps }
  })
  expect(issues.clipped, 'texto, controles e imagem inteiros nos ancestrais que recortam').toEqual(
    [],
  )
  expect(issues.overlaps, 'headline, CTAs e imagem não se sobrepõem').toEqual([])
}

async function assertCommercialHero(page: Page, hero: Locator) {
  await expect(
    hero.getByRole('heading', { level: 1, name: /O melhor do chopp.*Direto para o seu evento/i }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  const image = hero.getByRole('img', { name: /Barril de Chopp/i })
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('complete', true)
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBeGreaterThan(0)
  await expect(hero.getByRole('link', { name: 'Explorar Barris 3D' })).toHaveAttribute(
    'href',
    '#barris',
  )
  await expect(hero.getByRole('link', { name: 'Ver Tabela & Preços' })).toHaveAttribute(
    'href',
    '#chopes',
  )
  await expect(hero.getByRole('button', { name: 'Pedir no WhatsApp', exact: true })).toBeVisible()
  await expect(hero.getByText('30L & 50L', { exact: true })).toBeVisible()
  await expect(hero.getByText('100% Instalação', { exact: true })).toBeVisible()
  const catalog = (await (await page.request.get('/api/catalog')).json()) as PublicCatalog
  const category = catalog.categories.find((c) => c.id === 'chopes')
  if (!category) throw new Error('Categoria comercial ausente')
  const variants = category.items.flatMap((item) => item.variants)
  const priced = (volume: number) =>
    variants.flatMap((v) => (v.volumeMl === volume && v.priceCents !== null ? [v.priceCents] : []))
  const prices = priced(50000).length ? priced(50000) : priced(30000)
  const expected = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Math.min(...prices) / 100,
  )
  await expect(hero.getByText(`A partir de ${expected}`, { exact: true })).toBeVisible()
}

test('Hero C: hierarquia, conteúdo comercial e geometria responsiva', async ({ page }) => {
  for (const width of [768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await openLanding(page)
    await page.evaluate(() => document.fonts.ready)
    const hero = page.getByRole('region', { name: /O melhor do chopp/i })
    await assertCommercialHero(page, hero)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Escolha seu Barril em 3D' }),
    ).toHaveCount(1)
    await assertHeroGeometry(hero)
  }
})

// Original: "na porta." na mesma linha. C permite wrap; a proteção é conteúdo legível e acionável.
test('Hero C: mobile mantém imagem, CTAs e headline sem cortes', async ({ page }) => {
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 })
    await openLanding(page)
    await page.evaluate(() => document.fonts.ready)
    const hero = page.getByRole('region', { name: /O melhor do chopp/i })
    await assertCommercialHero(page, hero)
    await assertHeroGeometry(hero)
    await hero.getByRole('link', { name: 'Explorar Barris 3D' }).click()
    await expect(page).toHaveURL(/#barris$/)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Escolha seu Barril em 3D' }),
    ).toBeInViewport()
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
