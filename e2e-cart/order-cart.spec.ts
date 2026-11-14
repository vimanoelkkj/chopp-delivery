import { expect, type Page, test } from '@playwright/test'

// Carrinho de pedidos (somente navegador + WhatsApp). O catálogo é interceptado para que preços e
// totais sejam determinísticos; nenhum pedido é criado no servidor.
// Rode com `npm run test:e2e:cart`: playwright.cart.config.ts injeta um número de WhatsApp fictício.

type Prices = { dronken30: number | null; dronken50: number | null; brahma30: number | null }
const item = (id: string, name: string, p30: number | null, p50: number | null) => ({
  id,
  name,
  description: `${name} sintético`,
  visible: true,
  variants: [
    { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: p30 },
    { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: p50 },
  ],
})
const catalog = (p: Prices) => ({
  revision: 'e2e',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: [
        ...(p.dronken30 || p.dronken50
          ? [item('dronken', 'Dronken', p.dronken30, p.dronken50)]
          : []),
        ...(p.brahma30 ? [item('brahma', 'Brahma', p.brahma30, null)] : []),
      ],
    },
  ],
})
const BASE: Prices = { dronken30: 51029, dronken50: 65099, brahma30: 45000 }

async function serve(page: Page, prices: () => Prices) {
  await page.route('**/api/catalog', (route) =>
    route.fulfill({ json: catalog(prices()), headers: { 'cache-control': 'no-store' } }),
  )
}
const add = (page: Page, product: string, liters: number) =>
  page
    .getByRole('button', {
      name: new RegExp(`Adicionar ao pedido ${product}, barril de ${liters} litros`),
    })
    .click()
const fab = (page: Page) => page.getByTestId('cart-fab')
const panel = (page: Page) => page.getByRole('dialog', { name: 'Meu pedido' })
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test.beforeEach(async ({ page }) => {
  await serve(page, () => BASE)
})

test('adiciona produtos, agrupa variantes iguais e mantém o pedido direto', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('cart-fab')).toHaveCount(0)

  const row = page.getByRole('row', { name: /Dronken/ })
  await row.getByRole('button', { name: /Aumentar quantidade de Dronken, barril de 30/ }).click()
  await add(page, 'Dronken', 30) // 2 unidades
  await add(page, 'Dronken', 30) // mesma linha: soma mais 2 (total 4)
  await add(page, 'Dronken', 50)
  await add(page, 'Brahma', 30)

  const button = fab(page)
  await expect(button).toHaveText('6') // 4 + 1 + 1
  const box = await button.boundingBox()
  expect(Math.round(box?.width ?? 0)).toBe(56)
  expect(Math.round(box?.height ?? 0)).toBe(56)

  // Pedido direto continua disponível como link do WhatsApp com a mensagem do produto.
  const direct = page.getByRole('link', {
    name: /Pedir somente este produto Brahma, barril de 30 litros/,
  })
  const href = (await direct.getAttribute('href')) ?? ''
  expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/)
  expect(new URL(href).searchParams.get('text')).toContain('Brahma')

  await button.click()
  const dialog = panel(page)
  await expect(dialog.getByText('Dronken')).toHaveCount(2)
  // 4 x 510,29 + 1 x 650,99 + 1 x 450,00
  await expect(dialog.getByTestId('cart-total')).toContainText('3.142,15')
  await expect(dialog.getByText('a confirmar')).toBeVisible()
})

test('edita quantidades, remove, fecha com Escape e devolve o foco', async ({ page }) => {
  await page.goto('/')
  await add(page, 'Brahma', 30)
  await fab(page).focus()
  await page.keyboard.press('Enter')
  const dialog = panel(page)
  await expect(dialog).toBeVisible()
  // O foco fica dentro do diálogo.
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)

  await dialog
    .getByRole('button', { name: /Aumentar quantidade de Brahma, Barril de 30 L/ })
    .click()
  await expect(dialog.getByTestId('cart-total')).toContainText('900,00')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(fab(page)).toBeFocused()
  await expect(fab(page)).toHaveText('2')

  await fab(page).click()
  await dialog.getByRole('button', { name: /Remover Brahma, Barril de 30 L/ }).click()
  await expect(dialog.getByText('Seu pedido está vazio.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await expect(fab(page)).toHaveCount(0)
  // O FAB sumiu: o foco vai para um elemento válido da página, não para o body.
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('chopes')
})

test('persiste no localStorage ao recarregar', async ({ page }) => {
  await page.goto('/')
  await add(page, 'Dronken', 50)
  await page.reload()
  await expect(fab(page)).toHaveText('1')
  const stored = await page.evaluate(() => localStorage.getItem('chopp-delivery:cart:v1'))
  expect(JSON.parse(stored ?? '{}').lines[0]).toMatchObject({
    itemId: 'dronken',
    variantCode: '50',
    unitPriceCents: 65099,
  })
})

test('revalida preços e produtos removidos antes de enviar', async ({ page }) => {
  let prices = { ...BASE }
  await page.unroute('**/api/catalog')
  await serve(page, () => prices)
  await page.goto('/')
  await add(page, 'Dronken', 30)
  await add(page, 'Brahma', 30)

  // Catálogo muda: Dronken 30 L sobe de preço e Brahma sai de linha.
  prices = { dronken30: 52000, dronken50: 65099, brahma30: null }
  await fab(page).click()
  const dialog = panel(page)
  await expect(dialog.getByRole('alert')).toContainText(
    'Brahma (Barril de 30 L) não está mais disponível',
  )
  await expect(dialog.getByRole('alert')).toContainText('R$ 510,29 para R$ 520,00')
  await expect(dialog.getByRole('button', { name: 'Enviar pedido pelo WhatsApp' })).toBeDisabled()

  await dialog.getByRole('button', { name: 'Atualizar pedido' }).click()
  await expect(dialog.getByTestId('cart-total')).toContainText('520,00')
  const send = dialog.getByRole('link', { name: 'Enviar pedido pelo WhatsApp' })
  await expect(send).toBeVisible()

  const href = (await send.getAttribute('href')) ?? ''
  const text = new URL(href).searchParams.get('text') ?? ''
  expect(text.replaceAll(' ', ' ')).toContain(
    '1. Dronken (Barril de 30 L)\n   1 x R$ 520,00 = R$ 520,00',
  )
  expect(text).toContain('Frete: a confirmar.')
  expect(text).not.toContain('Brahma')
})

test('Atualizar pedido preserva as quantidades atuais e aplica o preço novo', async ({ page }) => {
  let prices = { ...BASE }
  await page.unroute('**/api/catalog')
  await serve(page, () => prices)
  await page.goto('/')
  await add(page, 'Dronken', 30)
  prices = { ...BASE, dronken30: 52000 }
  await fab(page).click()
  const dialog = panel(page)
  await expect(dialog.getByRole('alert')).toContainText('R$ 510,29 para R$ 520,00')
  // Edita a quantidade DEPOIS da conferência: o snapshot antigo (1 unidade) não pode voltar.
  const plus = dialog.getByRole('button', {
    name: /Aumentar quantidade de Dronken, Barril de 30 L/,
  })
  await plus.click()
  await plus.click()
  await dialog.getByRole('button', { name: 'Atualizar pedido' }).click()
  await expect(dialog.getByTestId('cart-total')).toContainText('1.560,00')
  await expect(fab(page)).toHaveText('3')
  const send = dialog.getByRole('link', { name: 'Enviar pedido pelo WhatsApp' })
  await expect(send).toBeVisible()
  const text = new URL((await send.getAttribute('href')) ?? '').searchParams.get('text') ?? ''
  expect(text.replaceAll(' ', ' ')).toContain('3 x R$ 520,00 = R$ 1.560,00')
})

test('o envio é um link nativo e só existe com a conferência válida', async ({ page, context }) => {
  await context.route('https://wa.me/**', (route) => route.fulfill({ body: 'ok' }))
  let hold: Promise<void> | null = null
  await page.unroute('**/api/catalog')
  await page.route('**/api/catalog', async (route) => {
    if (hold) await hold
    await route.fulfill({ json: catalog(BASE) })
  })
  await page.clock.install()
  await page.goto('/')
  await add(page, 'Dronken', 30)
  await fab(page).click()
  const dialog = panel(page)
  const send = dialog.getByRole('link', { name: 'Enviar pedido pelo WhatsApp' })
  await expect(send).toBeVisible()
  await expect(send).toHaveAttribute('target', '_blank')
  await expect(send).toHaveAttribute('rel', /noopener/)

  // Mudar o pedido invalida a conferência: sem link até a nova conferência terminar.
  let release = () => {}
  hold = new Promise<void>((resolve) => {
    release = resolve
  })
  await dialog.getByRole('button', { name: /Aumentar quantidade de Dronken/ }).click()
  await expect(send).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Enviar pedido pelo WhatsApp' })).toBeDisabled()
  release()
  await expect(send).toBeVisible()
  expect(new URL((await send.getAttribute('href')) ?? '').searchParams.get('text')).toContain('2 x')

  // Conferência expirada (> 60 s) também bloqueia até revalidar.
  hold = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.clock.fastForward(61_000)
  await expect(send).toHaveCount(0)
  release()
  await expect(send).toBeVisible()

  // O clique abre o WhatsApp pelo próprio link (popup nativo), sem chamada assíncrona antes.
  const [popup] = await Promise.all([page.waitForEvent('popup'), send.click()])
  expect(popup.url()).toMatch(/^https:\/\/wa\.me\/5531900000000\?text=/)
})

test('falha de conferência bloqueia o envio e permite tentar de novo', async ({ page }) => {
  await page.goto('/')
  await add(page, 'Brahma', 30)
  await page.unroute('**/api/catalog')
  await page.route('**/api/catalog', (route) => route.abort())
  await fab(page).click()
  const dialog = panel(page)
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível conferir')
  await expect(dialog.getByRole('button', { name: 'Enviar pedido pelo WhatsApp' })).toBeDisabled()
  await page.unroute('**/api/catalog')
  await serve(page, () => BASE)
  await dialog.getByRole('button', { name: 'Conferir novamente' }).click()
  await expect(dialog.getByRole('link', { name: 'Enviar pedido pelo WhatsApp' })).toBeVisible()
})

for (const width of [320, 390, 768, 1440]) {
  test(`sem overflow e com layout correto em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await add(page, 'Dronken', 30)
    await add(page, 'Brahma', 30)
    expect(await noOverflow(page)).toBe(true)
    await expect(page.getByTestId('sticky-cta')).toHaveAttribute('data-visible', 'false')

    await fab(page).click()
    const dialog = panel(page)
    await expect(dialog).toBeVisible()
    expect(await noOverflow(page)).toBe(true)
    const box = (await dialog.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
    if (width >= 768) {
      // Cartão flutuante à direita, acima do FAB e sem cobri-lo.
      const fabBox = (await fab(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
      expect(box.width).toBeLessThanOrEqual(24 * 16 + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(fabBox.y)
      expect(box.x + box.width).toBeGreaterThanOrEqual(width - 40)
    } else expect(Math.round(box.y + box.height)).toBe(900) // painel inferior
    await page.screenshot({ path: `test-results/cart-${width}.png` })
  })
}
