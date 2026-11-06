import { expect, type Page, test } from '@playwright/test'

const KEY = 'chopp.admin.theme'
const mode = (page: Page) => page.locator('[data-admin]').getAttribute('data-color-mode')
const htmlMode = (page: Page) => page.evaluate(() => document.documentElement.dataset.colorMode)
const choose = (page: Page, name: 'Claro' | 'Escuro' | 'Sistema') =>
  page.getByRole('group', { name: 'Tema do painel' }).getByRole('button', { name, exact: true })
const open = async (page: Page, path = '/admin') => {
  await page.goto(path)
  await expect(page.locator('[data-admin]')).toBeVisible()
  await expect(choose(page, 'Claro')).toBeVisible()
}

for (const width of [390, 1440]) {
  test.describe(`theme switcher at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test('defaults to light, switches, persists and fits the header', async ({ page }, info) => {
      await open(page)
      expect(await mode(page)).toBe('light')
      await expect(choose(page, 'Claro')).toHaveAttribute('aria-pressed', 'true')
      for (const name of ['Claro', 'Escuro', 'Sistema'] as const) {
        const box = await choose(page, name).boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(44)
        expect(box?.height).toBeGreaterThanOrEqual(44)
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
      }
      await choose(page, 'Escuro').click()
      expect(await mode(page)).toBe('dark')
      expect(await htmlMode(page)).toBe('dark')
      expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('dark')
      await page.screenshot({ path: info.outputPath(`dark-header-${width}.png`) })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await page.reload()
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', 'dark')
      await expect(choose(page, 'Escuro')).toHaveAttribute('aria-pressed', 'true')
      await choose(page, 'Claro').click()
      await page.reload()
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', 'light')
    })

    test('keyboard operation and visible focus', async ({ page }) => {
      await open(page)
      await choose(page, 'Escuro').focus()
      await page.keyboard.press('Enter')
      expect(await mode(page)).toBe('dark')
      await choose(page, 'Sistema').focus()
      await page.keyboard.press('Space')
      await expect(choose(page, 'Sistema')).toHaveAttribute('aria-pressed', 'true')
      const outline = await choose(page, 'Sistema').evaluate(
        (n) => getComputedStyle(n).outlineStyle,
      )
      expect(outline).not.toBe('none')
    })

    test('system follows prefers-color-scheme live, without reload', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' })
      await open(page)
      await choose(page, 'Sistema').click()
      expect(await mode(page)).toBe('light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', 'dark')
      expect(await htmlMode(page)).toBe('dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', 'light')
      // Explicit choices ignore the system.
      await choose(page, 'Claro').click()
      await page.emulateMedia({ colorScheme: 'dark' })
      expect(await mode(page)).toBe('light')
    })

    test('system is resolved on first paint after reload (no light flash)', async ({ browser }) => {
      const context = await browser.newContext({
        colorScheme: 'dark',
        viewport: { width, height: 900 },
      })
      const page = await context.newPage()
      await page.addInitScript((k) => localStorage.setItem(k, 'system'), KEY)
      await page.goto('/admin')
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', 'dark')
      await context.close()
    })

    test('invalid saved values fall back to light without breaking', async ({ page }) => {
      await page.addInitScript((k) => localStorage.setItem(k, '<script>'), KEY)
      await open(page)
      expect(await mode(page)).toBe('light')
      await choose(page, 'Escuro').click()
      expect(await mode(page)).toBe('dark')
    })

    test('unavailable storage keeps working for the session', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('blocked', 'SecurityError')
          },
        })
      })
      await open(page)
      expect(await mode(page)).toBe('light')
      await choose(page, 'Escuro').click()
      expect(await mode(page)).toBe('dark')
    })

    test('storefront and CMS preview stay independent', async ({ page }) => {
      await page.addInitScript((k) => localStorage.setItem(k, 'dark'), KEY)
      await open(page, '/admin/preview')
      expect(await mode(page)).toBe('dark')
      const frame = page.frameLocator('iframe[title="Rascunho CMS v2"]')
      await expect(frame.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
      await expect(frame.locator('#topo')).toHaveCSS('background-color', 'rgb(250, 245, 234)')
      await page.goto('/')
      await expect(page.locator('html')).not.toHaveAttribute('data-color-mode', 'dark')
      await expect(page.locator('[data-theme-surface="storefront"]').first()).toHaveAttribute(
        'data-color-mode',
        'light',
      )
      await expect(page.getByRole('group', { name: 'Tema do painel' })).toHaveCount(0)
    })

    test('login screen follows the saved preference', async ({ page }, info) => {
      await page.addInitScript((k) => localStorage.setItem(k, 'dark'), KEY)
      await page.route('**/api/auth/me', (route) =>
        route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
      )
      await page.goto('/admin')
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', 'dark')
      await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible()
      await page.screenshot({ path: info.outputPath(`login-dark-${width}.png`) })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
    })
  })
}
