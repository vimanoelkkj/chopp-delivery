import { expect, type Page, test } from '@playwright/test'

const CREAM = 'rgb(250, 245, 234)'

// Emulação de celular (viewport, toque, userAgent móvel). Não reproduz o overscroll nativo do iOS:
// o teste cobre o fundo do documento, que é o que aparece quando o rebote revela a área atrás da página.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const documentBackground = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }))

test('vitrine pública: o documento (html e body) é creme', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await documentBackground(page)).toEqual({ theme: 'pastel', html: CREAM, body: CREAM })
})

// /admin/preview e o frame só existem com sessão: a cobertura deles está em tests/e2e-real (P4).
for (const path of ['/admin/']) {
  test(`painel ${path}: tema próprio do painel, com o fundo claro no documento`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page.locator('#root > *').first()).toBeAttached()
    expect(await documentBackground(page)).toEqual({ theme: 'admin', html: CREAM, body: CREAM })
  })
}

test('histórico: vitrine → painel → vitrine troca de tema a cada tela, sem vazar um para o outro', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect((await documentBackground(page)).theme).toBe('pastel')

  await page.goto('/admin/')
  await expect(page.locator('#root > *').first()).toBeAttached()
  expect(await documentBackground(page)).toMatchObject({ theme: 'admin', html: CREAM })

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await documentBackground(page)).toEqual({ theme: 'pastel', html: CREAM, body: CREAM })

  await page.goForward()
  await expect(page.locator('#root > *').first()).toBeAttached()
  expect(await documentBackground(page)).toMatchObject({ theme: 'admin', html: CREAM })
})
