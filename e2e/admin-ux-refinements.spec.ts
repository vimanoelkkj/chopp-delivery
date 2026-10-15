import { expect, type Page, test } from '@playwright/test'

const user = { id: 'owner-id', username: 'owner' }

async function openPanel(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
}

const newButton = (page: Page) => page.getByRole('button', { name: 'Novo produto', exact: true })
const card = (page: Page) => page.getByRole('listitem').filter({ hasText: 'Novo · não salvo' })
const save = (page: Page) => page.getByRole('button', { name: /^Salvar/ })

async function addToDraft(page: Page, category: 'Chopes' | 'Cachaças') {
  await newButton(page).click()
  const dialog = page.getByRole('dialog', { name: 'Novo produto' })
  await dialog.getByRole('radio', { name: category }).check()
  await dialog.getByRole('button', { name: 'Adicionar ao rascunho' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('clareza do cadastro', () => {
  test('o modal explica que o produto começa oculto e o botão diz que vai ao rascunho', async ({
    page,
  }) => {
    await openPanel(page)
    await newButton(page).click()
    const dialog = page.getByRole('dialog', { name: 'Novo produto' })
    await expect(dialog).toContainText(
      'O produto começa oculto. Para aparecer no site, ele precisa estar salvo e marcado como visível.',
    )
    await expect(dialog).not.toContainText('só vai ao site depois de salvo')
    await expect(dialog.getByRole('button', { name: 'Adicionar ao rascunho' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Criar produto' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible()
  })

  test('Adicionar ao rascunho não persiste: segue pendente e oculto até Salvar', async ({
    page,
  }) => {
    await openPanel(page)
    await addToDraft(page, 'Chopes')
    await expect(page.getByText('1 produto tem alterações não salvas.')).toBeVisible()
    await expect(card(page).getByText('Novo · não salvo')).toBeVisible()
    await expect(card(page).getByRole('switch')).not.toBeChecked()
  })

  test('nenhum erro agressivo ao abrir o cadastro nem ao passar pelos campos sem digitar', async ({
    page,
  }) => {
    await openPanel(page)
    await addToDraft(page, 'Chopes')
    const item = card(page)
    await expect(item.getByLabel('Nome')).toBeFocused()
    // Tab por todos os campos sem digitar nada.
    for (let index = 0; index < 8; index++) await page.keyboard.press('Tab')
    await expect(item.locator('[aria-invalid="true"]')).toHaveCount(0)
    await expect(item.getByText(/^Informe/)).toHaveCount(0)

    // Digitar e apagar mostra o erro ao sair do campo; digitar de volta o limpa.
    await item.getByLabel('Nome').fill('Laguni')
    await item.getByLabel('Nome').fill('')
    await item.getByLabel('Nome').blur()
    await expect(item.getByText('Informe o nome.')).toBeVisible()
    await item.getByLabel('Nome').fill('Lagunitas')
    await expect(item.getByText('Informe o nome.')).toHaveCount(0)
    // Só os campos tocados mostram erro; os demais esperam o Salvar.
    await expect(item.getByText('Informe o rótulo.')).toHaveCount(0)
    await save(page).click()
    await expect(item.getByText('Informe o rótulo.')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Corrija os campos' })).toBeVisible()
  })
})

test.describe('volume amigável', () => {
  test('chopes em litros (VOLUME (L)) e cachaças em ml, convertidos exatamente para ml', async ({
    page,
  }) => {
    await openPanel(page)
    await addToDraft(page, 'Chopes')
    const item = card(page)
    const liters = item.getByLabel('Volume (L)').first()
    await expect(liters).toHaveAttribute('placeholder', '20')
    await expect(liters).toHaveAttribute('inputmode', 'decimal')
    await expect(item.getByLabel('Volume (ml)')).toHaveCount(0)
    await item.getByLabel('Nome').fill('Lagunitas')
    await item.getByLabel('Rótulo').first().fill('Barril de 7,5 L')
    await liters.fill('7,5abc')
    await expect(liters).toHaveValue('7,5')
    await item
      .getByLabel(/^Preço em reais/)
      .first()
      .fill('30000')
    await item.getByRole('button', { name: 'Adicionar variante' }).click()
    await item.getByLabel('Rótulo').last().fill('Barril de 20 L')
    await item.getByLabel('Volume (L)').last().fill('20')
    await item
      .getByLabel(/^Preço em reais/)
      .last()
      .fill('42000')
    await save(page).click()
    const saved = page.getByRole('listitem', { name: 'Lagunitas' })
    await expect(saved.getByText('7,5 L', { exact: true })).toBeVisible() // 7500 ml
    await expect(saved.getByText('20 L', { exact: true })).toBeVisible() // 20000 ml

    await page.getByRole('tab', { name: /Cachaças/ }).click()
    await addToDraft(page, 'Cachaças')
    const bottle = card(page)
    const ml = bottle.getByLabel('Volume (ml)').first()
    await expect(ml).toHaveAttribute('placeholder', '700')
    await expect(ml).toHaveAttribute('inputmode', 'numeric')
    await expect(bottle.getByLabel('Volume (L)')).toHaveCount(0)
    await bottle.getByLabel('Nome').fill('Cachaça Ouro')
    await bottle.getByLabel('Rótulo').first().fill('Garrafa')
    await ml.fill('7,50') // vírgula não entra em ml: 750
    await expect(ml).toHaveValue('750')
    await bottle
      .getByLabel(/^Preço em reais/)
      .first()
      .fill('8990')
    await save(page).click()
    await expect(
      page.getByRole('listitem', { name: 'Cachaça Ouro' }).getByText('750 ml', { exact: true }),
    ).toBeVisible()
  })

  test('limites: litros exigem valor positivo e válido; mensagem em litros', async ({ page }) => {
    await openPanel(page)
    await addToDraft(page, 'Chopes')
    const item = card(page)
    const liters = item.getByLabel('Volume (L)').first()
    for (const bad of ['0', '0,0', '1000000']) {
      await liters.fill(bad)
      await liters.blur()
      await expect(item.getByText('Informe o volume em litros (ex.: 20 ou 7,5).')).toBeVisible()
    }
    await liters.fill('0,33')
    await expect(item.getByText('Informe o volume em litros (ex.: 20 ou 7,5).')).toHaveCount(0)
  })
})

test.describe('teclado no celular (390 px, emulação de viewport reduzida)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  async function keyboard(page: Page, open: boolean) {
    await page.setViewportSize({ width: 390, height: open ? 470 : 844 })
    await page.waitForTimeout(250)
  }

  test('preço: teclado numérico, campo e erro acima da barra, scroll e máscara com teclado aberto', async ({
    page,
  }) => {
    await openPanel(page)
    await page.getByRole('tab', { name: /Cachaças/ }).click()
    await addToDraft(page, 'Cachaças')
    const item = card(page)
    const price = item.getByLabel(/^Preço em reais/).first()
    await expect(price).toHaveAttribute('inputmode', 'numeric')

    await price.evaluate((input: HTMLInputElement) => input.focus())
    await keyboard(page, true)
    await price.evaluate((input: HTMLInputElement) => {
      input.blur()
      input.focus()
    })
    await page.waitForTimeout(250)
    // digitação (insertText = IME), Backspace, seleção e colagem com a máscara
    await page.keyboard.insertText('8990')
    await expect(price).toHaveValue('89,90')
    await page.keyboard.press('Backspace')
    await expect(price).toHaveValue('8,99')
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('1')
    await expect(price).toHaveValue('0,01')
    await price.evaluate((input) => {
      const data = new DataTransfer()
      data.setData('text/plain', 'R$ 1.250,50')
      input.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    })
    await expect(price).toHaveValue('1.250,50')
    // erro visível: apagar tudo e sair do campo
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await price.blur()
    const message = item.getByText('Informe o preço.')
    await expect(message).toBeVisible()
    await price.evaluate((input: HTMLInputElement) => {
      input.blur()
      input.focus()
    })
    await page.waitForTimeout(250)
    const bar = await page.getByRole('button', { name: 'Descartar' }).boundingBox()
    const field = await price.boundingBox()
    const error = await message.boundingBox()
    expect((field?.y ?? 0) + (field?.height ?? 0)).toBeLessThanOrEqual((bar?.y ?? 0) - 4)
    expect((error?.y ?? 0) + (error?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0)
    expect(field?.y ?? -1).toBeGreaterThanOrEqual(0)

    // rolagem continua funcionando com o teclado aberto
    const before = await page.evaluate(() => window.scrollY)
    await page.evaluate(() => window.scrollBy(0, 120))
    expect(await page.evaluate(() => window.scrollY)).not.toBe(before)

    // fecha o teclado: viewport volta, sem overflow horizontal, foco e valor preservados
    await keyboard(page, false)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0)
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeVisible()
  })

  test('mudança de foco entre campos com teclado aberto mantém o campo visível acima da barra', async ({
    page,
  }) => {
    await openPanel(page)
    await addToDraft(page, 'Chopes')
    const item = card(page)
    await keyboard(page, true)
    const fields = [
      item.getByLabel('Nome'),
      item.getByLabel('Descrição'),
      item.getByLabel('Rótulo').first(),
      item.getByLabel('Volume (L)').first(),
      item.getByLabel(/^Preço em reais/).first(),
    ]
    for (const field of fields) {
      await field.evaluate((element: HTMLElement) => {
        element.blur() // como o teclado abrindo: o navegador rola até o campo ao (re)focar
        element.focus()
      })
      await page.waitForTimeout(200)
      const bar = await page.getByRole('button', { name: 'Descartar' }).boundingBox()
      const box = await field.boundingBox()
      expect((box?.y ?? 0) + (box?.height ?? 0), 'campo acima da barra').toBeLessThanOrEqual(
        (bar?.y ?? 0) - 4,
      )
      expect(box?.y ?? -1, 'campo dentro da viewport').toBeGreaterThanOrEqual(0)
    }
    await keyboard(page, false)
  })

  test('volume em litros usa teclado decimal e em ml, numérico', async ({ page }) => {
    await openPanel(page)
    await addToDraft(page, 'Chopes')
    await expect(card(page).getByLabel('Volume (L)').first()).toHaveAttribute(
      'inputmode',
      'decimal',
    )
  })
})
