import { expect, type Locator, test } from '@playwright/test'

const luminance = (color: string) => {
  const values = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number)
  if (values?.length !== 3) throw Error('Expected computed RGB color')
  return values
    .map((value) => {
      const n = value / 255
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
}
async function contrast(element: Locator, foreground: 'color' | 'outlineColor' = 'color') {
  const colors = await element.evaluate((node, property) => {
    const style = getComputedStyle(node)
    let background = style.backgroundColor
    for (
      let parent = node.parentElement;
      background === 'rgba(0, 0, 0, 0)' && parent;
      parent = parent.parentElement
    )
      background = getComputedStyle(parent).backgroundColor
    return { foreground: style[property], background }
  }, foreground)
  const a = luminance(colors.foreground),
    b = luminance(colors.background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

for (const width of [390, 1440]) {
  test(`D2: dark admin and isolated light CMS preview at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const dir = info.outputPath('')
    const captures: string[] = []
    for (const mode of ['light', 'dark']) {
      await page.goto(`/admin?adminTheme=${mode}#pagina-inicial`)
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', mode)
      const title = page.getByRole('textbox', { name: 'Título', exact: true })
      await expect(title).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await title.fill('Rascunho privado P4 · revisão local')
      await title.focus()
      expect(await contrast(title)).toBeGreaterThanOrEqual(4.5)
      expect(await contrast(title, 'outlineColor')).toBeGreaterThanOrEqual(3)
      const save = page.getByRole('button', { name: 'Salvar rascunho', exact: true })
      await expect(save).toBeEnabled()
      expect(await contrast(save)).toBeGreaterThanOrEqual(4.5)
      const formName = `${mode}-form-${width}.png`
      await page.screenshot({
        path: info.outputPath(formName),
        fullPage: true,
        animations: 'disabled',
      })
      captures.push(formName)
      await title.fill('x'.repeat(121))
      await expect(title).toHaveAttribute('aria-invalid', 'true')
      expect(await contrast(title)).toBeGreaterThanOrEqual(4.5)
      await title.fill('Rascunho privado P4 · revisão local')
      await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Descartar as alterações?' })
      await expect(dialog).toBeVisible()
      const backdrop = await dialog.evaluate(
        (node) => getComputedStyle(node, '::backdrop').backgroundColor,
      )
      expect(backdrop).not.toBe('rgba(0, 0, 0, 0)')
      const modalName = `${mode}-modal-${width}.png`
      await page.screenshot({ path: info.outputPath(modalName), animations: 'disabled' })
      captures.push(modalName)
      await dialog.getByRole('button', { name: 'Continuar editando' }).click()
      await page.goto(`/admin?adminTheme=${mode}`)
      await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible()
      const catalogName = `${mode}-catalog-${width}.png`
      await page.screenshot({
        path: info.outputPath(catalogName),
        fullPage: true,
        animations: 'disabled',
      })
      captures.push(catalogName)
      await page.goto(`/admin/preview?adminTheme=${mode}`)
      await expect(page.locator('[data-admin]')).toHaveAttribute('data-color-mode', mode)
      const frame = page.frameLocator('iframe[title="Rascunho CMS v2"]')
      await expect(frame.locator('#topo')).toBeVisible()
      await expect(frame.locator('#topo')).toHaveAttribute('data-color-mode', 'light')
      await expect(frame.locator('#topo')).toHaveCSS('background-color', 'rgb(250, 245, 234)')
      await expect(frame.getByRole('heading', { name: 'Rascunho privado P4' })).toBeVisible()
      await frame.locator('body').evaluate(async () => {
        await document.fonts.ready
        await Promise.all(
          [...document.images].map((image) => {
            image.loading = 'eager'
            return image.decode()
          }),
        )
      })
      const previewName = `${mode}-preview-${width}.png`
      await page.screenshot({
        path: info.outputPath(previewName),
        fullPage: true,
        animations: 'disabled',
      })
      captures.push(previewName)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
    }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      `${dir}/gallery.html`,
      `<!doctype html><meta charset="utf-8"><title>D2 admin ${width}px</title><h1>Light / dark · ${width}px</h1>${captures.map((file) => `<p><a href="${file}">${file}</a></p><img src="${file}" style="max-width:100%;height:auto" alt="${file}">`).join('')}`,
    )
    const rejected = await page.request.put('/api/admin/site/draft', { data: {} })
    expect(rejected.status()).toBe(405)
  })
}
