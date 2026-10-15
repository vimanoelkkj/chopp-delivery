import { expect, type Page, test } from '@playwright/test'

/**
 * Fluxos de integração da F3B contra o MOCK (`?mock=`): resposta perdida, sessão expirada e
 * conflito com cadastros novos no rascunho. O contrato real da F3A.2 ainda é provisório.
 */
const user = { id: 'owner-id', username: 'owner' }

async function openPanel(page: Page, query = '') {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.goto(`/admin${query}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
}

const save = (page: Page) => page.getByRole('button', { name: /^Salvar/ })
const draftCards = (page: Page) =>
  page.getByRole('listitem').filter({ hasText: 'Novo · não salvo' })

async function addChope(page: Page, name: string, liters: string, cents: string) {
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Novo produto' })
  await dialog.getByRole('radio', { name: 'Chopes' }).check()
  await dialog.getByRole('button', { name: 'Adicionar ao rascunho' }).click()
  await expect(dialog).toBeHidden()
  const item = draftCards(page).last()
  await item.getByLabel('Nome').fill(name)
  await item.getByLabel('Rótulo').first().fill(`Barril de ${liters} L`)
  await item.getByLabel('Volume (L)').first().fill(liters)
  await item
    .getByLabel(/^Preço em reais/)
    .first()
    .fill(cents)
}

test.describe('resposta perdida depois de gravar', () => {
  test('o painel confirma pelo servidor, não duplica e mantém máscara e volume exatos', async ({
    page,
  }) => {
    await openPanel(page, '?mock=lost-response')
    await addChope(page, 'Lagunitas', '7,5', '125050')
    await save(page).click()

    await expect(page.getByText('Confirmado: o salvamento anterior foi gravado.')).toBeAttached()
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    await expect(page.getByLabel('Nome')).toHaveCount(1) // um único cartão: sem duplicata
    await expect(page.getByLabel('Nome')).toHaveValue('Lagunitas')
    await expect(draftCards(page)).toHaveCount(0)
    await expect(page.getByLabel('Resumo do catálogo').getByText('9 produtos')).toBeVisible()

    const saved = page.getByRole('listitem').filter({ has: page.getByLabel('Nome') })
    await expect(saved.getByLabel(/^Preço em reais/).first()).toHaveValue('1.250,50')
    await expect(saved.getByText('7,5 L', { exact: true })).toBeVisible() // 7500 ml exatos
  })
})

test.describe('sessão expirada com rascunho', () => {
  test('o rascunho volta depois de entrar de novo, na mesma aba', async ({ page }) => {
    await openPanel(page, '?mock=expired')
    await addChope(page, 'Lagunitas', '20', '42000')
    await save(page).click()

    await expect(page.getByText(/as alterações não salvas ficam guardadas nesta aba/)).toBeVisible()
    await page.getByLabel('Usuário').fill('owner')
    await page.getByLabel('Senha').fill('senha local')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByText('Suas alterações não salvas foram restauradas.')).toBeAttached()
    const item = draftCards(page)
    await expect(item).toHaveCount(1)
    await expect(item.getByLabel('Nome')).toHaveValue('Lagunitas')
    await expect(item.getByLabel(/^Preço em reais/).first()).toHaveValue('420,00')
    await expect(save(page)).toBeEnabled()
  })
})

test.describe('sessão expirada: identidade do rascunho', () => {
  test('outro usuário entrando na mesma aba não recebe o rascunho do anterior', async ({
    page,
  }) => {
    await openPanel(page, '?mock=expired')
    await addChope(page, 'Lagunitas', '20', '42000')
    await save(page).click()
    await expect(page.getByText(/as alterações não salvas ficam guardadas nesta aba/)).toBeVisible()

    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 200,
        json: { authenticated: true, user: { id: 'outro-id', username: 'outro' } },
      }),
    )
    await page.getByLabel('Usuário').fill('outro')
    await page.getByLabel('Senha').fill('senha local')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
    await expect(
      page.getByText('As alterações não salvas pertenciam a outro usuário e foram descartadas.'),
    ).toBeAttached()
    await expect(draftCards(page)).toHaveCount(0)
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
  })
})

test.describe('conflito com cadastro novo', () => {
  test('o 409 bloqueia o salvamento e o produto novo continua no rascunho', async ({ page }) => {
    await openPanel(page, '?mock=conflict')
    await addChope(page, 'Lagunitas', '20', '42000')
    await save(page).click()

    const dialog = page.getByRole('dialog', { name: 'O catálogo mudou' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(draftCards(page)).toHaveCount(1)
    await expect(draftCards(page).getByLabel('Nome')).toHaveValue('Lagunitas')

    await save(page).click()
    await expect(dialog).toBeVisible() // não chama o servidor: só reabre o aviso
    await dialog.getByRole('button', { name: 'Recarregar catálogo' }).click()
    await expect(draftCards(page)).toHaveCount(0) // recarregar descarta o rascunho, por escolha
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
  })
})
