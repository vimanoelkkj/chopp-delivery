import { expect, type Locator, type Page, test } from '@playwright/test'

const user = { id: 'owner-id', username: 'owner' }

async function openPanel(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
}

const price = (page: Page, size: string, name: string) =>
  page.getByLabel(`${size}, preço em reais, ${name}`)
const save = (page: Page) => page.getByRole('button', { name: /^Salvar/ })

/** Dispara um evento de colar real (clipboardData), como o navegador faz em Ctrl+V. */
const paste = (field: Locator, text: string) =>
  field.evaluate((input, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, text)

const caretAtEnd = (field: Locator) =>
  field.evaluate((input: HTMLInputElement) => input.selectionStart === input.value.length)

test.describe('máscara monetária: digitação', () => {
  test('digita centavos da direita para a esquerda, com milhar e limite', async ({ page }) => {
    await openPanel(page)
    const field = price(page, '30 L', 'Dronken')
    await field.press('Control+A')
    await field.press('Backspace')
    await expect(field).toHaveValue('')
    await expect(field).toHaveAttribute('placeholder', 'não vende')
    for (const [key, expected] of [
      ['4', '0,04'],
      ['9', '0,49'],
      ['0', '4,90'],
      ['0', '49,00'],
      ['0', '490,00'],
      ['5', '4.900,05'],
    ] as const) {
      await page.keyboard.press(key)
      await expect(field).toHaveValue(expected)
      expect(await caretAtEnd(field)).toBe(true)
    }
    await page.keyboard.press('Control+A')
    await page.keyboard.type('125050')
    await expect(field).toHaveValue('1.250,50')
    await page.keyboard.press('Control+A')
    await page.keyboard.type('9999999')
    await expect(field).toHaveValue('99.999,99')
    await page.keyboard.type('1') // 8º dígito: recusado
    await expect(field).toHaveValue('99.999,99')
    await page.keyboard.type('abc,.-R$ ') // não numéricos: ignorados
    await expect(field).toHaveValue('99.999,99')
  })

  test('preencher por script (foca, seleciona tudo e insere) substitui o valor; Tab seleciona o conteúdo', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '30 L', 'Dronken') // 510,00
    await field.fill('515,00')
    await expect(field).toHaveValue('515,00')
    await field.fill('4900')
    await expect(field).toHaveValue('49,00')
    await field.fill('')
    await expect(field).toHaveValue('')
    await field.fill('1.250,50')
    await expect(field).toHaveValue('1.250,50')
    // Tab para dentro do campo seleciona o texto: o primeiro dígito recomeça o valor.
    await page.getByRole('tab', { name: /Chopes/ }).focus()
    await page.keyboard.press('Tab')
    await expect(field).toBeFocused()
    await page.keyboard.type('7')
    await expect(field).toHaveValue('0,07')
  })

  test('zero não aparece: continua vazio ("não vende")', async ({ page }) => {
    await openPanel(page)
    const field = price(page, '50 L', 'Brahma')
    await field.press('Control+A')
    await page.keyboard.type('000')
    await expect(field).toHaveValue('')
    await page.keyboard.type('4')
    await expect(field).toHaveValue('0,04')
  })

  test('Backspace apaga o último dígito; Delete no fim e na vírgula não muda nada', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '30 L', 'Dronken') // 510,00
    await field.focus()
    for (const expected of ['51,00', '5,10', '0,51', '0,05', '']) {
      await page.keyboard.press('Backspace')
      await expect(field).toHaveValue(expected)
    }
    await page.keyboard.type('49000')
    await page.keyboard.press('Delete') // cursor no fim: nada à direita
    await expect(field).toHaveValue('490,00')
    await field.evaluate((input: HTMLInputElement) => input.setSelectionRange(3, 3)) // antes da vírgula
    await page.keyboard.press('Delete')
    await expect(field).toHaveValue('490,00')
  })

  test('Ctrl+A + Delete limpa; Ctrl+A + dígito recomeça; seleção parcial recalcula', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '50 L', 'Dronken') // 650,00
    await field.press('Control+A')
    await page.keyboard.press('Delete')
    await expect(field).toHaveValue('')
    await page.keyboard.type('4900')
    await field.press('Control+A')
    await page.keyboard.type('5')
    await expect(field).toHaveValue('0,05')
    await page.keyboard.type('4900')
    await expect(field).toHaveValue('549,00')
    await field.evaluate((input: HTMLInputElement) => input.setSelectionRange(0, 2)) // "54"
    await page.keyboard.press('Backspace')
    await expect(field).toHaveValue('9,00')
  })

  test('IME e teclado virtual (insertText, sem eventos de tecla) usam o mesmo caminho', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '30 L', 'Dronken')
    await field.press('Control+A')
    await page.keyboard.press('Backspace')
    for (const [text, expected] of [
      ['4', '0,04'],
      ['9', '0,49'],
      ['0', '4,90'],
      ['0', '49,00'],
    ] as const) {
      await page.keyboard.insertText(text)
      await expect(field).toHaveValue(expected)
    }
    await page.keyboard.insertText('abc')
    await expect(field).toHaveValue('49,00')
    await page.keyboard.insertText('12') // dois dígitos de uma vez
    await expect(field).toHaveValue('4.900,12')
  })
})

test.describe('máscara monetária: colar', () => {
  test('R$ 490,00, 1.250,50 e 99.999,99 entram sem perder centavos e trocam o campo todo', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '30 L', 'Dronken')
    for (const [text, expected] of [
      ['R$ 490,00', '490,00'],
      ['R$ 1.250,50', '1.250,50'],
      ['  99.999,99 ', '99.999,99'],
      ['490,5', '490,50'],
      ['490.50', '490,50'],
      ['0,01', '0,01'],
    ] as const) {
      await paste(field, text)
      await expect(field).toHaveValue(expected)
      await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    }
    // Com tudo selecionado ou não, o valor colado substitui o campo inteiro.
    await field.press('Control+A')
    await paste(field, 'R$ 12,34')
    await expect(field).toHaveValue('12,34')
    expect(await caretAtEnd(field)).toBe(true)
  })

  test('colagem ambígua é recusada com mensagem e o valor anterior permanece', async ({ page }) => {
    await openPanel(page)
    const field = price(page, '30 L', 'Dronken') // 510,00
    for (const text of ['490', '1.250', '1,250', '1,234.56', 'abc', '0,00', '100.000,00']) {
      await paste(field, text)
      await expect(field).toHaveValue('510,00')
      await expect(field).toHaveAttribute('aria-invalid', 'true')
      await expect(
        page.getByRole('alert').filter({ hasText: /ambíguo|maior que zero|limite/ }),
      ).toBeVisible()
    }
    await field.focus()
    await page.keyboard.type('1') // digitar de novo limpa o aviso
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveValue('5.100,01')
  })

  test.describe('área de transferência real (Ctrl+V)', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

    test('Ctrl+V com R$ 1.250,50 preenche o campo', async ({ page }) => {
      await openPanel(page)
      await page.evaluate(() => navigator.clipboard.writeText('R$ 1.250,50'))
      const field = price(page, '50 L', 'Dronken')
      await field.press('Control+A')
      await field.press('Control+V')
      await expect(field).toHaveValue('1.250,50')
    })
  })
})

test.describe('máscara monetária: regras do painel', () => {
  test('numérico no mobile, placeholders e estado canônico em centavos', async ({ page }) => {
    await openPanel(page)
    for (const [size, name] of [
      ['30 L', 'Dronken'],
      ['50 L', 'Brahma'],
    ] as const)
      await expect(price(page, size, name)).toHaveAttribute('inputmode', 'numeric')
    await expect(price(page, '30 L', 'Brahma')).toHaveAttribute('placeholder', 'não vende')
    await page.getByRole('tab', { name: /Cachaças/ }).click()
    const bottle = page.getByLabel('Garrafa, preço em reais, Cachaça')
    await expect(bottle).toHaveAttribute('inputmode', 'numeric')
    await expect(bottle).toHaveAttribute('placeholder', '0,00')
  })

  test('detecção de alterações: digitar de volta o valor salvo zera o pendente', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '30 L', 'Dronken') // 510,00
    await field.press('Control+A')
    await page.keyboard.type('51500')
    await expect(page.getByText('1 produto tem alterações não salvas.')).toBeVisible()
    await expect(save(page)).toBeEnabled()
    await field.press('Control+A')
    await page.keyboard.type('51000')
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    await expect(save(page)).toBeDisabled()
    await field.press('Control+A')
    await page.keyboard.press('Backspace') // 30 L vira null: é uma alteração
    await expect(page.getByText('1 produto tem alterações não salvas.')).toBeVisible()
  })

  test('limpar o único preço de um produto visível é recusado; ocultar resolve', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '50 L', 'Brahma')
    await field.press('Control+A')
    await field.press('Backspace')
    await save(page).click()
    await expect(page.getByText('Informe ao menos um preço ou oculte o produto.')).toBeVisible()
    await field.press('Control+A')
    await page.keyboard.type('1')
    await expect(field).toHaveValue('0,01')
    await save(page).click()
    await expect(page.getByText('Salvo. As mudanças já estão no site.')).toBeVisible()
    await expect(field).toHaveValue('0,01')
  })

  test('valores nos limites (1 centavo e 9.999.999) são salvos e mantidos', async ({ page }) => {
    await openPanel(page)
    const low = price(page, '30 L', 'Dronken')
    const high = price(page, '50 L', 'Dronken')
    await low.press('Control+A')
    await page.keyboard.type('1')
    await high.press('Control+A')
    await page.keyboard.type('9999999')
    await save(page).click()
    await expect(page.getByText('Salvo. As mudanças já estão no site.')).toBeVisible()
    await expect(low).toHaveValue('0,01')
    await expect(high).toHaveValue('99.999,99')
  })
})

test.describe('máscara monetária no celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('digitação virtual com a barra fixa visível; campo nunca fica sob a barra', async ({
    page,
  }) => {
    await openPanel(page)
    const field = price(page, '50 L', 'Chopp de vinho')
    await field.evaluate((input: HTMLInputElement) => input.focus())
    await page.waitForTimeout(250)
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.insertText('125050')
    await expect(field).toHaveValue('1.250,50')
    await expect(field).toHaveAttribute('inputmode', 'numeric')
    // Teclado virtual aberto: a área visível encolhe. O campo continua acima da barra fixa.
    await field.evaluate((input: HTMLInputElement) => input.blur())
    await page.setViewportSize({ width: 390, height: 480 })
    await field.evaluate((input: HTMLInputElement) => input.focus())
    await page.waitForTimeout(250)
    const bar = await page.getByRole('button', { name: 'Descartar' }).boundingBox()
    const box = await field.boundingBox()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((bar?.y ?? 0) - 4)
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
})
