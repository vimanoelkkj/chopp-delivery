import { expect, type Page, test } from '@playwright/test'

/**
 * Travar a rolagem ao abrir um modal remove a barra de rolagem clássica (Windows). Sem
 * compensação o conteúdo centrado anda metade da largura dela, e a barra fixa de salvar
 * saía da viewport. Aqui as barras ficam visíveis (o headless as esconde por padrão).
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const user = { id: 'owner-id', username: 'owner' }

async function openPanel(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string, text?: string) => {
      const element = [...document.querySelectorAll(selector)].find(
        (node) => !text || node.textContent?.trim().startsWith(text),
      )
      const box = element?.getBoundingClientRect()
      if (!box) throw new Error(`sem ${selector} ${text ?? ''}`)
      return { left: box.left, right: box.right, top: box.top }
    }
    return {
      selo: rect('header img'),
      sair: rect('header button', 'Sair'),
      titulo: rect('h1'),
      linha: rect('main ul li'),
      descartar: rect('button', 'Descartar'),
      salvar: rect('button', 'Salvar'),
      scrollY: Math.round(window.scrollY),
      scrollbar: window.innerWidth - document.documentElement.clientWidth,
    }
  })

type Snapshot = Awaited<ReturnType<typeof snapshot>>
const BOXES = ['selo', 'sair', 'titulo', 'linha', 'descartar', 'salvar'] as const

function expectSamePlace(actual: Snapshot, expected: Snapshot) {
  for (const key of BOXES) {
    expect(Math.abs(actual[key].left - expected[key].left), `${key} left`).toBeLessThanOrEqual(0.5)
    expect(Math.abs(actual[key].right - expected[key].right), `${key} right`).toBeLessThanOrEqual(
      0.5,
    )
    expect(Math.abs(actual[key].top - expected[key].top), `${key} top`).toBeLessThanOrEqual(0.5)
  }
  expect(actual.scrollY).toBe(expected.scrollY)
}

async function cycle(page: Page, settle: number) {
  await page.getByLabel('30 L, preço em reais, Dronken').fill('515')
  await page.evaluate(() => window.scrollTo(0, 320))
  await page.waitForTimeout(250)
  const before = await snapshot(page)
  expect(before.scrollbar, 'a barra de rolagem precisa estar visível neste teste').toBeGreaterThan(
    0,
  )
  expect(before.scrollY).toBe(320)

  for (let round = 0; round < 3; round++) {
    await page.getByRole('button', { name: 'Descartar' }).click()
    const dialog = page.getByRole('dialog', { name: 'Descartar alterações?' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(settle)
    expectSamePlace(await snapshot(page), before)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    await expect(dialog.getByRole('button', { name: 'Continuar editando' })).toBeFocused()

    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toBeHidden()
    await page.waitForTimeout(settle)
    expectSamePlace(await snapshot(page), before)
    // Travas desfeitas por completo e foco devolvido a quem abriu o modal.
    expect(
      await page.evaluate(() => [
        document.body.style.overflow,
        document.documentElement.style.paddingRight,
        document.documentElement.style.overflow,
      ]),
    ).toEqual(['', '', ''])
    await expect(page.getByRole('button', { name: 'Descartar' })).toBeFocused()
  }
}

for (const width of [1440, 390, 360]) {
  test.describe(`${width}px com barra de rolagem visível`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('abrir e fechar o modal 3x não desloca header, conteúdo nem a barra fixa', async ({
      page,
    }) => {
      await openPanel(page)
      await cycle(page, 450)
    })
  })
}

test.describe('movimento reduzido', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })

  test('sem animação o resultado é o mesmo: 0 px de deslocamento', async ({ page }) => {
    await openPanel(page)
    await cycle(page, 150)
  })
})

test.describe('celular (barra sobreposta)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('sem barra clássica não há padding de compensação e a folha inferior segue colada embaixo', async ({
    page,
  }) => {
    await openPanel(page)
    await page.getByLabel('30 L, preço em reais, Dronken').fill('515')
    await page.getByRole('button', { name: 'Descartar' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(450)
    expect(await page.evaluate(() => document.documentElement.style.paddingRight)).toBe('')
    const box = await dialog.boundingBox()
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844)
    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('barra fixa e foco', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('campo focado na parte de baixo não fica sob a barra; clicar na barra não rola a página', async ({
    page,
  }) => {
    await openPanel(page)
    const last = page.getByLabel('50 L, preço em reais, Chopp de vinho')
    // focus() nativo (o do Playwright não rola a página): é o que o Tab e o foco por script fazem.
    await last.evaluate((element) => (element as HTMLElement).focus())
    await page.waitForTimeout(300)
    const bar = await page.getByRole('button', { name: 'Descartar' }).boundingBox()
    const field = await last.boundingBox()
    expect((field?.y ?? 0) + (field?.height ?? 0)).toBeLessThanOrEqual((bar?.y ?? 0) - 8)

    await page.getByLabel('30 L, preço em reais, Dronken').fill('515')
    await page.evaluate(() => window.scrollTo(0, 320))
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: 'Descartar' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(320)
  })
})
