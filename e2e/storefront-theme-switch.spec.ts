import { expect, type Page, test } from '@playwright/test'

/**
 * D4C: alternância Claro/Escuro/Sistema da vitrine. Servidor de fixtures somente leitura
 * (npm run preview:admin:theme). A primeira pintura real é verificada em storefront-first-paint.
 */

const STORE_KEY = 'chopp.storefront.theme'
const ADMIN_KEY = 'chopp.admin.theme'
const group = (page: Page) => page.getByRole('group', { name: 'Tema da página' })
const option = (page: Page, name: 'Claro' | 'Escuro' | 'Sistema') =>
  group(page).getByRole('button', { name, exact: true })
const modeOf = (page: Page) => page.locator('#topo').getAttribute('data-color-mode')
const htmlMode = (page: Page) => page.evaluate(() => document.documentElement.dataset.colorMode)
const seed = (page: Page, entries: Record<string, string>) =>
  page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value)
  }, entries)
async function open(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.locator('#topo')).toBeVisible()
  await expect(option(page, 'Claro')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/** Razão de contraste WCAG entre duas cores CSS `rgb()/rgba()`, compondo alfa sobre o fundo. */
const contrast = (page: Page, fg: string, bg: string, under = 'rgb(255, 255, 255)') =>
  page.evaluate(
    ([f, b, u]) => {
      const parse = (v: string) => {
        const m = v.match(/rgba?\(([^)]+)\)/)
        const [r, g, bl, a = 1] = (m?.[1] ?? '0,0,0')
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number)
        return { r, g, b: bl, a }
      }
      const over = (top: ReturnType<typeof parse>, base: ReturnType<typeof parse>) => ({
        r: top.r * top.a + base.r * (1 - top.a),
        g: top.g * top.a + base.g * (1 - top.a),
        b: top.b * top.a + base.b * (1 - top.a),
        a: 1,
      })
      const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const c = [r, g, b]
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
      }
      const base = parse(u)
      const back = over(parse(b), base)
      const [hi, lo] = [lum(over(parse(f), back)), lum(back)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    },
    [fg, bg, under],
  )

for (const width of [390, 1440]) {
  test.describe(`alternância da vitrine a ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test('claro por padrão, controle cabe no cabeçalho e tem alvos de 44 px', async ({ page }) => {
      await open(page)
      expect(await modeOf(page)).toBe('light')
      await expect(option(page, 'Claro')).toHaveAttribute('aria-pressed', 'true')
      for (const name of ['Claro', 'Escuro', 'Sistema'] as const) {
        const box = await option(page, name).boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(44)
        expect(box?.height).toBeGreaterThanOrEqual(44)
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      // O menu e a marca continuam alcançáveis ao lado do controle.
      if (width === 390)
        await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible()
      await expect(page.getByRole('link', { name: /Chopp Delivery Delegas, início/ })).toBeVisible()
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
    })

    test('escolher persiste só na chave da vitrine e sobrevive ao reload', async ({ page }) => {
      await open(page)
      await option(page, 'Escuro').click()
      expect(await modeOf(page)).toBe('dark')
      expect(await htmlMode(page)).toBe('dark')
      await expect(option(page, 'Escuro')).toHaveAttribute('aria-pressed', 'true')
      expect(await page.evaluate((k) => localStorage.getItem(k), STORE_KEY)).toBe('dark')
      expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_KEY)).toBeNull()
      await page.reload()
      await expect(page.locator('#topo')).toHaveAttribute('data-color-mode', 'dark')
      await expect(option(page, 'Escuro')).toHaveAttribute('aria-pressed', 'true')
      await option(page, 'Claro').click()
      await page.reload()
      await expect(page.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
    })

    test('Sistema acompanha prefers-color-scheme sem recarregar; escolhas explícitas ignoram', async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: 'light' })
      await open(page)
      await option(page, 'Sistema').click()
      expect(await modeOf(page)).toBe('light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('#topo')).toHaveAttribute('data-color-mode', 'dark')
      expect(await htmlMode(page)).toBe('dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await expect(page.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
      await page.reload()
      await expect(option(page, 'Sistema')).toHaveAttribute('aria-pressed', 'true')
      await option(page, 'Claro').click()
      await page.emulateMedia({ colorScheme: 'dark' })
      expect(await modeOf(page)).toBe('light')
    })

    test('outra aba atualiza ao escolher (evento storage) e valor inválido volta ao claro', async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const first = await context.newPage()
      const second = await context.newPage()
      await open(first)
      await open(second)
      await option(first, 'Escuro').click()
      await expect(second.locator('#topo')).toHaveAttribute('data-color-mode', 'dark')
      await expect(option(second, 'Escuro')).toHaveAttribute('aria-pressed', 'true')
      await second.evaluate((k) => {
        localStorage.setItem(k, '<script>')
        window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: '<script>' }))
      }, STORE_KEY)
      await expect(second.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
      await context.close()
    })

    test('armazenamento indisponível: continua funcionando na sessão', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('blocked', 'SecurityError')
          },
        })
      })
      await open(page)
      expect(await modeOf(page)).toBe('light')
      await option(page, 'Escuro').click()
      expect(await modeOf(page)).toBe('dark')
    })

    test('teclado, foco visível, hover e contraste do controle nos dois temas', async ({
      page,
    }) => {
      await open(page)
      for (const mode of ['Claro', 'Escuro'] as const) {
        await option(page, mode).click()
        await option(page, 'Sistema').focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(option(page, 'Sistema')).toBeFocused()
        const outline = await option(page, 'Sistema').evaluate((n) => {
          const s = getComputedStyle(n)
          return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) }
        })
        expect(outline.style).not.toBe('none')
        expect(outline.width).toBeGreaterThanOrEqual(2)
        const header = await page
          .locator('header')
          .first()
          .evaluate((n) => getComputedStyle(n).backgroundColor)
        const pageBg = await page
          .locator('#topo')
          .evaluate((n) => getComputedStyle(n).backgroundColor)
        // Estado atual: texto/ícone e fundo do botão pressionado.
        const pressed = await option(page, mode).evaluate((n) => {
          const s = getComputedStyle(n)
          return { color: s.color, bg: s.backgroundColor }
        })
        expect(await contrast(page, pressed.color, pressed.bg, pageBg)).toBeGreaterThanOrEqual(4.5)
        // Inativo e com hover.
        const idle = option(page, 'Sistema')
        const idleStyle = await idle.evaluate((n) => getComputedStyle(n).color)
        expect(await contrast(page, idleStyle, header, pageBg)).toBeGreaterThanOrEqual(4.5)
        await idle.hover()
        await page.waitForTimeout(250)
        const hover = await idle.evaluate((n) => {
          const s = getComputedStyle(n)
          return { color: s.color, bg: s.backgroundColor }
        })
        expect(hover.bg).not.toBe('rgba(0, 0, 0, 0)')
        expect(await contrast(page, hover.color, hover.bg, pageBg)).toBeGreaterThanOrEqual(4.5)
      }
    })

    test('aviso do WhatsApp legível no claro e no escuro', async ({ page }) => {
      await open(page)
      for (const mode of ['Claro', 'Escuro'] as const) {
        await option(page, mode).click()
        const cta = page.getByRole('button', { name: 'Pedir no WhatsApp' }).first()
        await cta.click()
        const notice = page.getByRole('status').filter({ hasText: 'número do WhatsApp' }).first()
        await expect(notice).toBeVisible()
        const style = await notice.evaluate((n) => {
          const s = getComputedStyle(n)
          return { color: s.color, bg: s.backgroundColor }
        })
        expect(style.color).not.toBe(style.bg)
        expect(await contrast(page, style.color, style.bg)).toBeGreaterThanOrEqual(4.5)
        await page.screenshot({ path: test.info().outputPath(`notice-${mode}-${width}.png`) })
      }
    })

    test('prévia CMS e painel ficam independentes da preferência da vitrine', async ({ page }) => {
      await seed(page, { [STORE_KEY]: 'dark', [ADMIN_KEY]: 'light' })
      await page.goto('/admin/preview')
      await expect(page.locator('[data-admin]')).toBeVisible()
      expect(await page.locator('[data-admin]').getAttribute('data-color-mode')).toBe('light')
      const frame = page.frameLocator('iframe[title="Rascunho CMS v2"]')
      await expect(frame.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
      await expect(frame.locator('#topo')).toHaveCSS('background-color', 'rgb(250, 245, 234)')
      await expect(frame.getByRole('group', { name: 'Tema da página' })).toHaveCount(0)
      await page.goto('/')
      await expect(page.locator('#topo')).toHaveAttribute('data-color-mode', 'dark')
      // O contrário: painel escuro não escurece a vitrine.
      const other = await page.context().newPage()
      await other.addInitScript(
        ([a, s]) => {
          localStorage.setItem(a, 'dark')
          localStorage.setItem(s, 'light')
        },
        [ADMIN_KEY, STORE_KEY],
      )
      await other.setViewportSize({ width, height: 900 })
      await other.goto('/')
      await expect(other.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
      await expect(other.locator('html')).toHaveAttribute('data-color-mode', 'light')
    })
  })
}
