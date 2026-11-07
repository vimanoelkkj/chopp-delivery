import { expect, type Page, test } from '@playwright/test'
import { projectPublicCmsV2 } from '../shared/cms/validation-v2'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

/**
 * D4B: dark mode da vitrine (Grafite Sálvia Pastel). O modo escuro é ativado só por atributo, sem
 * persistência nem alternância; a vitrine continua clara por padrão. Servidor de fixtures
 * somente leitura (npm run preview:admin:theme).
 */

const SCOPES = ['html', '#topo']
const setMode = (page: Page, mode: 'light' | 'dark') =>
  page.evaluate(
    ([scopes, value]) => {
      for (const selector of scopes)
        document.querySelector(selector)?.setAttribute('data-color-mode', value)
    },
    [SCOPES, mode] as [string[], string],
  )

type Finding = { text: string; ratio: number; min: number; fg: string; bg: string }

/** Contraste WCAG de cada texto visível da vitrine contra o primeiro fundo opaco dos ancestrais. */
const measure = (page: Page): Promise<{ checked: number; failures: Finding[] }> =>
  page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number }
    const parse = (value: string): Rgba | null => {
      const m = value.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const [r, g, b, a = 1] = m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number)
      return { r, g, b, a }
    }
    const lum = ({ r, g, b }: Rgba) => {
      const c = [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (x: Rgba, y: Rgba) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p)
      return (hi + 0.05) / (lo + 0.05)
    }
    const failures: Finding[] = []
    let checked = 0
    const root = document.querySelector('#topo')
    if (!root) return { checked, failures }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const seen = new Set<Element>()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement
      if (!el || seen.has(el) || !node.textContent?.trim()) continue
      seen.add(el)
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      if (
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        box.width === 0 ||
        box.height === 0
      )
        continue
      let faded = false
      let skip = false
      let background: Rgba | null = null
      for (let up: Element | null = el; up; up = up.parentElement) {
        const s = getComputedStyle(up)
        if (up.closest('[aria-hidden="true"], [inert]') || Number(s.opacity) < 1) faded = true
        if (s.backgroundImage !== 'none') skip = true
        const bg = parse(s.backgroundColor)
        if (bg && bg.a > 0.9) {
          background = bg
          break
        }
      }
      if (faded || skip || !background) continue
      const fg = parse(style.color)
      if (!fg) continue
      checked += 1
      const size = Number.parseFloat(style.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      const min = large ? 3 : 4.5
      const r = ratio(fg, background)
      if (r < min)
        failures.push({
          text: (node.textContent ?? '').trim().slice(0, 40),
          ratio: Number(r.toFixed(2)),
          min,
          fg: style.color,
          bg: `rgb(${background.r}, ${background.g}, ${background.b})`,
        })
    }
    return { checked, failures }
  })

async function open(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Nossos chopes').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

for (const width of [390, 1440]) {
  test.describe(`vitrine escura Grafite Sálvia Pastel a ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    })

    test('a vitrine abre clara por padrão e o escuro só entra por atributo', async ({ page }) => {
      await open(page)
      await expect(page.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
      await expect(page.locator('#topo')).toHaveCSS('background-color', 'rgb(250, 245, 234)')
      await setMode(page, 'dark')
      await expect(page.locator('#topo')).toHaveCSS('background-color', 'rgb(27, 33, 31)')
      await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(27, 33, 31)')
      await setMode(page, 'light')
      await expect(page.locator('#topo')).toHaveCSS('background-color', 'rgb(250, 245, 234)')
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
    })

    test('o rótulo do CTA principal usa a tinta de ação, no claro e no escuro', async ({
      page,
    }) => {
      await open(page)
      for (const [mode, ink, action] of [
        ['light', 'rgb(34, 40, 42)', 'rgb(246, 180, 142)'],
        ['dark', 'rgb(34, 40, 42)', 'rgb(246, 180, 142)'],
      ] as const) {
        await setMode(page, mode)
        const primary = page.getByText('Pedir no WhatsApp', { exact: true }).first()
        await expect(primary).toHaveCSS('color', ink)
        await expect(primary).toHaveCSS('background-color', action)
      }
    })

    test('contraste de textos, preços e CTAs no escuro', async ({ page }, info) => {
      await open(page)
      await setMode(page, 'dark')
      await page.waitForTimeout(300)
      const result = await measure(page)
      info.annotations.push({ type: 'checked', description: String(result.checked) })
      expect(result.checked).toBeGreaterThan(40)
      expect(result.failures).toEqual([])
    })

    test('tema claro permanece com os tokens e o contraste de antes', async ({ page }) => {
      await open(page)
      const tokens = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('#topo') as Element)
        return ['--theme-background', '--theme-text', '--theme-action', '--theme-on-action'].map(
          (name) => style.getPropertyValue(name).trim(),
        )
      })
      expect(tokens).toEqual(['#faf5ea', '#22282a', '#f6b48e', '#22282a'])
      expect((await measure(page)).failures).toEqual([])
    })

    test('laterais ficam a 30% e respeitam movimento reduzido nos dois temas', async ({ page }) => {
      await open(page)
      for (const mode of ['light', 'dark'] as const) {
        await setMode(page, mode)
        const sides = page.locator(
          '[class*="posLeft"] [class*="imageWrap"] > :not([class*="badge"]), ' +
            '[class*="posRight"] [class*="imageWrap"] > :not([class*="badge"])',
        )
        await expect(sides).toHaveCount(2)
        for (const image of await sides.all()) await expect(image).toHaveCSS('opacity', '0.3')
        await expect(
          page.locator('[class*="posCenter"] [class*="imageWrap"] > :not([class*="badge"])'),
        ).toHaveCSS('opacity', '1')
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await expect(sides.first()).toHaveCSS('transition-duration', '0.65s')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        for (const element of await page
          .locator('#carousel-track, #carousel-track article, #carousel-track [class*="content"]')
          .all())
          await expect(element).toHaveCSS('transition-duration', '0s')
        for (const image of await sides.all())
          await expect(image).toHaveCSS('transition-duration', '0s')
      }
      await page.getByRole('button', { name: 'Próximo Barril', exact: true }).click()
      await expect(
        page.locator('[aria-live="polite"]').filter({ hasText: 'Barril 2 de' }),
      ).toBeVisible()
    })

    test('seções editoriais publicadas (fixture local) legíveis nos dois temas', async ({
      page,
    }) => {
      const site = previewFixture()
      site.commercial.whatsappNumber = '5531999999999'
      const hero = site.modules.find((module) => module.template === 'hero')
      if (hero?.template !== 'hero') throw new Error('hero ausente na fixture')
      hero.content = {
        heading: 'Hero público',
        summary: 'Resumo público',
        deliveryRegion: 'Região publicada',
        media: { id: 'media_12345678-1234-4123-8123-123456789012', alt: 'Imagem editorial' },
      }
      await page.route('**/api/site', (route) =>
        route.fulfill({ status: 200, json: projectPublicCmsV2(site) }),
      )
      await page.goto('/')
      await expect(page.locator('#topo')).toHaveAttribute('data-editorial-state', 'ready')
      await expect(page.getByRole('heading', { name: 'Hero público' })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      for (const mode of ['Claro', 'Escuro']) {
        await page
          .getByRole('group', { name: 'Tema da página' })
          .getByRole('button', { name: mode, exact: true })
          .click()
        await page.waitForTimeout(300)
        const result = await measure(page)
        expect(result.checked, mode).toBeGreaterThan(30)
        expect(result.failures, mode).toEqual([])
        const dir = process.env.D4B_SHOTS
        if (dir)
          await page.screenshot({ path: `${dir}/editorial-${mode}-${width}.png`, fullPage: true })
      }
    })

    test('capturas finais da vitrine escura', async ({ page }) => {
      await open(page)
      await setMode(page, 'dark')
      await page.evaluate(async () => {
        const images = [...document.images]
        const loading = images.map((image) => image.getAttribute('loading'))
        images.forEach((image) => {
          image.loading = 'eager'
        })
        await Promise.all(images.map((image) => image.decode()))
        images.forEach((image, index) => {
          const value = loading[index]
          if (value === null) image.removeAttribute('loading')
          else image.setAttribute('loading', value)
        })
      })
      await expect(page).toHaveScreenshot(`storefront-dark-${width}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixels: 0,
      })
      const dir = process.env.D4B_SHOTS
      if (!dir) return
      await page.screenshot({ path: `${dir}/dark-${width}-fold.png` })
      const sections: [string, string][] = [
        ['carrossel', 'Escolha seu barril em 3D'],
        ['catalogo', 'Nossos chopes e litragens'],
        ['como', 'Como funciona a entrega'],
        ['sobre', 'O chopp como centro'],
        ['promo', 'Condições especiais'],
        ['cta', 'Bora'],
      ]
      for (const [name, text] of sections) {
        const section = page.getByText(text).first().locator('xpath=ancestor::section[1]')
        if (await section.count())
          await section.first().screenshot({ path: `${dir}/dark-${width}-${name}.png` })
      }
    })
  })
}
