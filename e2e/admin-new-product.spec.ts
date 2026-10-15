import { expect, type Page, test } from '@playwright/test'

const user = { id: 'owner-id', username: 'owner' }

async function openPanel(page: Page, query = '') {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.goto(`/admin${query}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
}

const save = (page: Page) => page.getByRole('button', { name: /^Salvar/ })
const newButton = (page: Page) => page.getByRole('button', { name: 'Novo produto', exact: true })
const card = (page: Page) => page.getByRole('listitem').filter({ hasText: 'Novo · não salvo' })

async function createProduct(page: Page, category: 'Chopes' | 'Cachaças') {
  await newButton(page).click()
  const dialog = page.getByRole('dialog', { name: 'Novo produto' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: category }).check()
  await dialog.getByRole('button', { name: 'Adicionar ao rascunho' }).click()
  await expect(dialog).toBeHidden()
}

async function fillFirstVariant(page: Page, label: string, volume: string, cents: string) {
  const item = card(page).last()
  await item.getByLabel('Rótulo').first().fill(label)
  await item
    .getByLabel(/^Volume \(/)
    .first()
    .fill(volume)
  await item
    .getByLabel(/^Preço em reais/)
    .first()
    .fill(cents)
}

test.describe('cadastro de produto: fluxo', () => {
  test('Novo produto abre a escolha de categoria; criar entra no rascunho, oculto e com foco no nome', async ({
    page,
  }) => {
    await openPanel(page)
    await newButton(page).click()
    const dialog = page.getByRole('dialog', { name: 'Novo produto' })
    await expect(dialog.getByRole('radio', { name: 'Chopes' })).toBeChecked() // categoria da aba ativa
    await expect(dialog.getByRole('radio', { name: 'Chopes' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog).toBeHidden()
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByText('Tudo salvo.')).toBeVisible()

    await createProduct(page, 'Chopes')
    const item = card(page)
    await expect(item).toHaveCount(1)
    await expect(item.getByLabel('Nome')).toBeFocused()
    await expect(item.getByRole('switch')).not.toBeChecked() // visibilidade inicial desativada
    await expect(item.getByText('Chopes', { exact: true })).toBeVisible()
    await expect(page.getByText('1 produto tem alterações não salvas.')).toBeVisible()
    await expect(page.getByText('Novo produto adicionado em Chopes.')).toBeAttached()
    await expect(save(page)).toBeEnabled()
  })

  test('estados de validação por campo e foco no primeiro inválido ao salvar', async ({ page }) => {
    await openPanel(page)
    await createProduct(page, 'Chopes')
    const item = card(page)
    await item.getByLabel('Nome').fill('Lagunitas')
    await item.getByLabel('Nome').fill('')
    await item.getByLabel('Nome').blur()
    await expect(item.getByLabel('Nome')).toHaveAttribute('aria-invalid', 'true')
    await expect(item.getByText('Informe o nome.')).toBeVisible()
    await page.getByRole('tab', { name: /Cachaças/ }).click()
    await save(page).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Corrija os campos' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Chopes/ })).toHaveAttribute('aria-selected', 'true')
    await expect(item.getByLabel('Nome')).toBeFocused()
    await expect(item.getByText('Informe o rótulo.')).toBeVisible()
    await expect(item.getByText('Informe o volume em litros (ex.: 20 ou 7,5).')).toBeVisible()
    const volume = item.getByLabel('Volume (L)').first()
    await volume.fill('7,5abc') // só dígitos e um separador entram
    await expect(volume).toHaveValue('7,5')
    await volume.fill('0')
    await expect(item.getByText('Informe o volume em litros (ex.: 20 ou 7,5).')).toBeVisible()
  })

  test('variantes: máscara monetária no preço, adicionar e remover só as temporárias', async ({
    page,
  }) => {
    await openPanel(page)
    await createProduct(page, 'Chopes')
    const item = card(page)
    const price = item.getByLabel(/^Preço em reais/).first()
    await expect(price).toHaveAttribute('inputmode', 'numeric')
    await expect(price).toHaveAttribute('placeholder', 'não vende')
    await price.fill('49000')
    await expect(price).toHaveValue('490,00')
    await price.press('Control+A')
    await page.keyboard.type('125050')
    await expect(price).toHaveValue('1.250,50')
    await expect(item.getByRole('button', { name: /^Remover/ })).toHaveCount(0) // só 1 variante

    await item.getByRole('button', { name: 'Adicionar variante' }).click()
    await expect(item.getByLabel('Rótulo')).toHaveCount(2)
    await expect(item.getByLabel('Rótulo').last()).toBeFocused()
    await expect(item.getByRole('button', { name: /^Remover/ })).toHaveCount(2)
    await item
      .getByRole('button', { name: /^Remover/ })
      .last()
      .click()
    await expect(item.getByLabel('Rótulo')).toHaveCount(1)
  })

  test('cachaça nova: preço obrigatório e várias cachaças', async ({ page }) => {
    await openPanel(page)
    await createProduct(page, 'Cachaças')
    await expect(page.getByRole('tab', { name: /Cachaças/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const item = card(page).last()
    await expect(item.getByLabel(/^Preço em reais/)).toHaveAttribute('placeholder', '0,00')
    await item.getByLabel('Nome').fill('Cachaça Ouro')
    await fillFirstVariant(page, 'Garrafa 1 L', '1000', '')
    await item
      .getByLabel(/^Preço em reais/)
      .first()
      .fill('5')
    await item
      .getByLabel(/^Preço em reais/)
      .first()
      .fill('')
    await item
      .getByLabel(/^Preço em reais/)
      .first()
      .blur()
    await expect(item.getByText('Informe o preço.')).toBeVisible()
    await createProduct(page, 'Cachaças')
    await expect(card(page)).toHaveCount(2)
    await expect(page.getByRole('tab', { name: /Cachaças/ })).toContainText('3')
  })

  test('cancelar cadastro: vazio sai direto; preenchido pede confirmação; Descartar limpa tudo', async ({
    page,
  }) => {
    await openPanel(page)
    await createProduct(page, 'Chopes')
    await card(page).getByRole('button', { name: 'Cancelar cadastro' }).click()
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByText('Tudo salvo.')).toBeVisible()

    await createProduct(page, 'Chopes')
    await card(page).getByLabel('Nome').fill('Lagunitas')
    await card(page).getByRole('button', { name: 'Cancelar cadastro' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cancelar cadastro?' })
    await expect(dialog.getByRole('button', { name: 'Continuar editando' })).toBeFocused()
    await page.keyboard.press('Escape') // destrutivo: Esc não fecha
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(card(page)).toHaveCount(1)
    await card(page).getByRole('button', { name: 'Cancelar cadastro' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar cadastro' }).click()
    await expect(card(page)).toHaveCount(0)

    await createProduct(page, 'Chopes')
    await createProduct(page, 'Cachaças')
    await page.getByRole('button', { name: 'Descartar' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click()
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    await page.getByRole('tab', { name: /Chopes/ }).click()
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(8)
  })
})

test.describe('cadastro de produto: salvar, reordenar e conflito', () => {
  test('salvar atribui id definitivo, mantém a linha na tela e o item vira produto persistido', async ({
    page,
  }) => {
    await openPanel(page)
    await createProduct(page, 'Chopes')
    const item = card(page)
    await item.getByLabel('Nome').fill('Lagunitas')
    await item.getByLabel('Descrição').fill('IPA americana')
    await fillFirstVariant(page, 'Barril de 20 L', '20', '42000')
    await item.getByRole('switch').click()
    await save(page).click()
    await expect(page.getByRole('button', { name: 'Salvando…' })).toBeVisible()
    await expect(page.getByText('Salvo. As mudanças já estão no site.')).toBeVisible()
    await expect(card(page)).toHaveCount(0) // não é mais "novo"
    const saved = page.getByRole('listitem', { name: 'Lagunitas' })
    await expect(saved).toBeVisible()
    await expect(saved.getByLabel('Nome')).toHaveValue('Lagunitas')
    await expect(saved.getByLabel(/^Preço em reais/)).toHaveValue('420,00')
    await expect(saved.getByRole('switch')).toBeChecked()
    await expect(saved.getByText('Barril de 20 L')).toBeVisible()
    await expect(saved.getByText('20 L', { exact: true })).toBeVisible()
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    await expect(page.getByRole('tab', { name: /Chopes/ })).toContainText('9')
  })

  test('ordenar produto novo e existente; a ordem é salva', async ({ page }) => {
    await openPanel(page)
    await createProduct(page, 'Chopes')
    await card(page).getByLabel('Nome').fill('Lagunitas')
    await fillFirstVariant(page, 'Barril de 20 L', '20', '42000')
    const up = page.getByRole('button', { name: 'Subir Lagunitas' })
    await up.click()
    await up.click()
    await expect(page.getByText('Lagunitas movido para a posição 7 de 9.')).toBeAttached()
    await expect(page.getByRole('button', { name: 'Descer Chopp de vinho' })).toBeDisabled() // agora é o último
    await save(page).click()
    await expect(page.getByText('Salvo. As mudanças já estão no site.')).toBeVisible()
    const names = await page.getByRole('listitem').getByLabel('Nome').count()
    expect(names).toBe(1) // só o cartão do item novo mostra campo Nome
    await expect(page.getByRole('button', { name: 'Subir Lagunitas' })).toBeEnabled()
  })

  test('conflito com cadastro pendente: nada é salvo; recarregar descarta o cadastro', async ({
    page,
  }) => {
    await openPanel(page, '?mock=conflict')
    await createProduct(page, 'Chopes')
    await card(page).getByLabel('Nome').fill('Lagunitas')
    await fillFirstVariant(page, 'Barril de 20 L', '20', '42000')
    await save(page).click()
    const dialog = page.getByRole('dialog', { name: 'O catálogo mudou' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(card(page)).toHaveCount(1) // cadastro preservado
    await expect(
      page.getByText('O catálogo mudou em outra sessão. Recarregue para poder salvar.'),
    ).toBeVisible()
    await save(page).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Recarregar catálogo' }).click()
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByLabel('30 L, preço em reais, Dronken')).toHaveValue('530,00')
  })

  test('falha ao salvar mantém o cadastro no rascunho com os mesmos clientIds', async ({
    page,
  }) => {
    await openPanel(page, '?mock=save-error')
    await createProduct(page, 'Chopes')
    await card(page).getByLabel('Nome').fill('Lagunitas')
    await fillFirstVariant(page, 'Barril de 20 L', '20', '42000')
    await save(page).click()
    await expect(page.getByRole('alert')).toContainText('Não foi possível salvar')
    await expect(card(page)).toHaveCount(1)
    await expect(card(page).getByLabel('Nome')).toHaveValue('Lagunitas')
    await expect(save(page)).toBeEnabled()
  })

  test('sair com cadastro pendente pede confirmação', async ({ page }) => {
    await openPanel(page)
    await createProduct(page, 'Chopes')
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Sair sem salvar?' })).toBeVisible()
  })
})

test.describe('acessibilidade do cadastro', () => {
  test('campos com rótulo associado, erro descrito, diálogo com foco preso e Esc fecha o de escolha', async ({
    page,
  }) => {
    await openPanel(page)
    await newButton(page).click()
    const dialog = page.getByRole('dialog', { name: 'Novo produto' })
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(newButton(page)).toBeFocused()

    await createProduct(page, 'Chopes')
    const item = card(page)
    for (const name of ['Nome', 'Descrição', 'Rótulo', 'Volume (L)'])
      await expect(item.getByLabel(name).first()).toBeVisible()
    await item.getByLabel('Nome').fill('x')
    await item.getByLabel('Nome').fill('')
    await item.getByLabel('Nome').blur()
    const describedBy = await item.getByLabel('Nome').getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('Informe o nome.')
    await expect(item.getByRole('group', { name: 'Variantes' })).toBeVisible()
    await expect(item.getByRole('switch', { name: 'Novo produto visível no site' })).toBeVisible()
  })

  test.describe('movimento reduzido', () => {
    test.use({ reducedMotion: 'reduce' })

    test('o cartão novo não anima', async ({ page }) => {
      await openPanel(page)
      await createProduct(page, 'Chopes')
      await expect(card(page)).toHaveCSS('animation-name', 'none')
    })
  })
})

test.describe('cadastro no celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('botão, escolha em folha inferior, cartão sem overflow e barra fixa acima dos campos', async ({
    page,
  }) => {
    await openPanel(page)
    const button = await newButton(page).boundingBox()
    expect(button?.width).toBeGreaterThan(300)
    expect(button?.height).toBeGreaterThanOrEqual(48)
    await newButton(page).click()
    const dialog = page.getByRole('dialog', { name: 'Novo produto' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(350)
    const box = await dialog.boundingBox()
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844)
    await dialog.getByRole('radio', { name: 'Cachaças' }).check()
    await dialog.getByRole('button', { name: 'Adicionar ao rascunho' }).click()
    await expect(dialog).toBeHidden()
    const item = card(page)
    await expect(item.getByLabel('Nome')).toBeFocused()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
    const price = item.getByLabel(/^Preço em reais/).first()
    await price.evaluate((input: HTMLInputElement) => input.focus())
    await page.waitForTimeout(250)
    await page.keyboard.insertText('8990')
    await expect(price).toHaveValue('89,90')
    const bar = await page.getByRole('button', { name: 'Descartar' }).boundingBox()
    const field = await price.boundingBox()
    expect((field?.y ?? 0) + (field?.height ?? 0)).toBeLessThanOrEqual((bar?.y ?? 0) - 4)
    const cancel = await item.getByRole('button', { name: 'Cancelar cadastro' }).boundingBox()
    expect(cancel?.height).toBeGreaterThanOrEqual(48)
  })
})
