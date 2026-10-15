import { expect, type Page, test } from '@playwright/test'

const user = { id: 'owner-id', username: 'owner' }

/** Sessão simulada no navegador: as Functions reais da F2 são cobertas por auth-routes.spec.ts. */
async function mockSession(page: Page, signedIn = true) {
  await page.route('**/api/auth/me', (route) =>
    signedIn
      ? route.fulfill({ status: 200, json: { authenticated: true, user } })
      : route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
  )
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ status: 200, json: { ok: true } }),
  )
}

async function openPanel(page: Page, query = '') {
  await mockSession(page)
  await page.goto(`/admin${query}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
}

const price = (page: Page, size: string, name: string) =>
  page.getByLabel(`${size}, preço em reais, ${name}`)
const save = (page: Page) => page.getByRole('button', { name: /^Salvar/ })
const names = (page: Page) => page.getByRole('heading', { level: 2 }).allTextContents()

test.describe('login', () => {
  test('mostra o formulário, trata erros e entra no painel pela rota real da F2', async ({
    page,
  }) => {
    await mockSession(page, false)
    let attempt = 0
    let body: unknown
    await page.route('**/api/auth/login', (route) => {
      attempt++
      body = route.request().postDataJSON()
      if (attempt === 1) return route.fulfill({ status: 401, json: {} })
      if (attempt === 2) {
        return route.fulfill({ status: 429, headers: { 'Retry-After': '899' }, json: {} })
      }
      return route.fulfill({ status: 200, json: { authenticated: true, user } })
    })
    await page.goto('/admin')
    await expect(page).toHaveTitle('Painel Delegas')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Painel\s*Delegas/i)

    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('Informe o usuário e a senha.')

    await page.getByLabel('Usuário').fill(' Owner ')
    await page.getByLabel('Senha').fill('senha errada')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('Usuário ou senha incorretos.')
    await expect(page.getByLabel('Senha')).toBeFocused()
    expect(body).toEqual({ username: 'Owner', password: 'senha errada' })

    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Muitas tentativas. Tente de novo em 15 minutos.',
    )

    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
    await expect(page.getByText('owner', { exact: true })).toBeVisible()
  })

  test('senha pode ser revelada e o campo usa os atributos corretos', async ({ page }) => {
    await mockSession(page, false)
    await page.goto('/admin')
    const password = page.getByLabel('Senha')
    await expect(password).toHaveAttribute('type', 'password')
    await expect(password).toHaveAttribute('autocomplete', 'current-password')
    await expect(page.getByLabel('Usuário')).toHaveAttribute('autocomplete', 'username')
    await page.getByRole('button', { name: 'Mostrar' }).click()
    await expect(password).toHaveAttribute('type', 'text')
  })

  test('sessão expirada ao salvar volta ao login com aviso', async ({ page }) => {
    await openPanel(page, '?mock=expired')
    await price(page, '30 L', 'Dronken').fill('515,00')
    await save(page).click()
    await expect(page.getByText('Sua sessão expirou. Entre novamente.')).toBeVisible()
    await expect(page.getByLabel('Usuário')).toBeVisible()
  })

  test('com as Functions reais sem configuração de auth, mostra indisponível', async ({ page }) => {
    await page.goto('/admin')
    await expect(
      page.getByRole('heading', { name: 'Não conseguimos verificar seu acesso' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  })

  test('/admin/ redireciona e o site público não baixa o código do painel', async ({ page }) => {
    const chunks: string[] = []
    page.on('request', (request) => {
      if (/AdminApp/.test(request.url())) chunks.push(request.url())
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    expect(chunks).toEqual([])
    await mockSession(page, false)
    await page.goto('/admin/')
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByLabel('Usuário')).toBeVisible()
    expect(chunks.length).toBeGreaterThan(0)
  })

  test('/admin/ preserva query string (cenários ?mock=) e hash no redirect', async ({ page }) => {
    await mockSession(page)
    await page.goto('/admin/?mock=error#topo')
    await expect(page).toHaveURL(/\/admin\?mock=error#topo$/)
    await expect(
      page.getByRole('heading', { name: 'Não conseguimos carregar o catálogo' }),
    ).toBeVisible()
    const response = await page.request.get('/admin/?mock=conflict&x=1', { maxRedirects: 0 })
    expect(response.status()).toBe(301)
    expect(response.headers().location).toMatch(/\/admin\?mock=conflict&x=1$/)
  })
})

test.describe('painel desktop', () => {
  test('lista os chopes do PDF, com 30 L e 50 L separados e visibilidade', async ({ page }) => {
    await openPanel(page)
    expect(await names(page)).toEqual([
      'Dronken',
      'Palato Beber',
      'Villa Alemã',
      'Krug Bier',
      'Brahma',
      'Kaiser',
      'Heineken',
      'Chopp de vinho',
    ])
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('510,00')
    await expect(price(page, '50 L', 'Dronken')).toHaveValue('650,00')
    await expect(price(page, '30 L', 'Brahma')).toHaveValue('')
    await expect(price(page, '30 L', 'Brahma')).toHaveAttribute('placeholder', 'não vende')
    await expect(page.getByRole('switch', { name: 'Heineken visível no site' })).not.toBeChecked()
    const summary = page.getByLabel('Resumo do catálogo')
    await expect(summary.getByText('8 produtos')).toBeVisible()
    await expect(summary.getByText('1 indisponível')).toBeVisible()
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    await expect(save(page)).toBeDisabled()
  })

  test('abas trocam o conteúdo e respondem ao teclado', async ({ page }) => {
    await openPanel(page)
    const chopes = page.getByRole('tab', { name: /Chopes/ })
    const cachacas = page.getByRole('tab', { name: /Cachaças/ })
    await expect(chopes).toHaveAttribute('aria-selected', 'true')
    await chopes.focus()
    await page.keyboard.press('ArrowRight')
    await expect(cachacas).toHaveAttribute('aria-selected', 'true')
    await expect(cachacas).toBeFocused()
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Cachaça'])
    await expect(page.getByLabel('Garrafa, preço em reais, Cachaça')).toHaveValue('30,00')
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', /cachacas/)
    await page.keyboard.press('Home')
    await expect(chopes).toBeFocused()
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(8)
  })

  test('editar preço e visibilidade marca alterações e salva com feedback', async ({ page }) => {
    await openPanel(page)
    await price(page, '30 L', 'Dronken').fill('515,00')
    await price(page, '30 L', 'Dronken').blur()
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('515,00')
    await page.getByRole('switch', { name: 'Kaiser visível no site' }).click()
    await expect(page.getByRole('switch', { name: 'Kaiser visível no site' })).not.toBeChecked()
    await expect(page.getByText('2 produtos têm alterações não salvas.')).toBeVisible()
    await expect(save(page)).toBeEnabled()
    await expect(save(page)).toHaveCSS('opacity', '1')

    await save(page).click()
    const saving = page.getByRole('button', { name: 'Salvando…' })
    await expect(saving).toBeVisible()
    await expect(saving).toHaveAttribute('aria-busy', 'true')
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'Salvo. As mudanças já estão no site.' })
    await expect(toast).toBeVisible()
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('515,00')
    await expect(page.getByLabel('Resumo do catálogo').getByText('2 indisponíveis')).toBeVisible()
    await expect(toast).toBeHidden({ timeout: 5000 })
  })

  test('cachaça exige preço: erro ao sair do campo e foco no campo ao tentar salvar', async ({
    page,
  }) => {
    await openPanel(page)
    await page.getByRole('tab', { name: /Cachaças/ }).click()
    const field = page.getByLabel('Garrafa, preço em reais, Cachaça')
    await expect(field).toHaveAttribute('placeholder', '0,00')
    await field.press('Control+A')
    await field.press('Backspace')
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await field.blur()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Informe o preço.')).toBeVisible()
    expect(await field.getAttribute('aria-describedby')).toBeTruthy()
    await page.getByRole('tab', { name: /Chopes/ }).click()
    await save(page).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Corrija os campos' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Cachaças/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(field).toBeFocused()
  })

  test('produto visível sem nenhum preço é recusado', async ({ page }) => {
    await openPanel(page)
    await price(page, '50 L', 'Brahma').fill('')
    await save(page).click()
    await expect(page.getByText('Informe ao menos um preço ou oculte o produto.')).toBeVisible()
    await page.getByRole('switch', { name: 'Brahma visível no site' }).click()
    await expect(page.getByText('Informe ao menos um preço ou oculte o produto.')).toBeHidden()
  })

  test('reordenar move a linha, anuncia a posição e mantém o foco no teclado', async ({ page }) => {
    await openPanel(page)
    const down = page.getByRole('button', { name: 'Descer Dronken' })
    await expect(page.getByRole('button', { name: 'Subir Dronken' })).toBeDisabled()
    await down.focus()
    await page.keyboard.press('Enter')
    expect((await names(page)).slice(0, 2)).toEqual(['Palato Beber', 'Dronken'])
    await expect(page.getByText('Dronken movido para a posição 2 de 8.')).toBeAttached()
    await expect(page.getByRole('button', { name: 'Descer Dronken' })).toBeFocused()
    await page.keyboard.press('Enter')
    expect((await names(page)).slice(0, 3)).toEqual(['Palato Beber', 'Villa Alemã', 'Dronken'])
    await expect(page.getByText('3 produtos têm alterações não salvas.')).toBeVisible()

    await save(page).click()
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    expect((await names(page)).slice(0, 3)).toEqual(['Palato Beber', 'Villa Alemã', 'Dronken'])
  })

  test('ordem na borda: o foco vai ao outro botão quando o atual desabilita', async ({ page }) => {
    await openPanel(page)
    const up = page.getByRole('button', { name: 'Subir Palato Beber' })
    await up.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Subir Palato Beber' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Descer Palato Beber' })).toBeFocused()
  })
})

test.describe('modais', () => {
  test('descartar: Esc não fecha, o foco começa no botão seguro e o foco fica preso', async ({
    page,
  }) => {
    await openPanel(page)
    await price(page, '30 L', 'Dronken').fill('999,00')
    await page.getByRole('button', { name: 'Descartar' }).click()
    const dialog = page.getByRole('dialog', { name: 'Descartar alterações?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Continuar editando' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(dialog).toBeVisible()

    for (let index = 0; index < 5; index++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
    }
    await expect(page.getByLabel('30 L, preço em reais, Dronken')).not.toBeFocused()

    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toBeHidden()
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('999,00')
    await expect(page.getByRole('button', { name: 'Descartar' })).toBeFocused()

    await page.getByRole('button', { name: 'Descartar' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('510,00')
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
  })

  test('sair com alterações pede confirmação; sem alterações sai direto', async ({ page }) => {
    await openPanel(page)
    await price(page, '30 L', 'Dronken').fill('999,00')
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Sair sem salvar?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toBeHidden()

    const logout = page.waitForRequest((request) => request.url().endsWith('/api/auth/logout'))
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Sair sem salvar' }).click()
    expect((await logout).method()).toBe('POST')
    await expect(page.getByLabel('Usuário')).toBeVisible()
  })

  test('logout sem alterações chama a rota real e volta ao login', async ({ page }) => {
    await openPanel(page)
    const logout = page.waitForRequest((request) => request.url().endsWith('/api/auth/logout'))
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    expect((await logout).method()).toBe('POST')
    await expect(page.getByLabel('Usuário')).toBeVisible()
  })

  test('falha no logout mantém a sessão e avisa', async ({ page }) => {
    await openPanel(page)
    await page.route('**/api/auth/logout', (route) => route.abort())
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Não foi possível sair agora. Tente de novo.')
    await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
  })
})

test.describe('estados', () => {
  test('carregamento lento mostra a estrutura dos cards', async ({ page }) => {
    await mockSession(page)
    await page.goto('/admin?mock=slow')
    await expect(page.getByRole('status', { name: 'Carregando catálogo' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible({
      timeout: 8000,
    })
  })

  test('erro de carregamento oferece tentar de novo e recupera', async ({ page }) => {
    await mockSession(page)
    await page.goto('/admin?mock=error')
    await expect(
      page.getByRole('heading', { name: 'Não conseguimos carregar o catálogo' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Dronken' })).toBeVisible()
  })

  test('catálogo vazio tem estado explícito em cada aba', async ({ page }) => {
    await mockSession(page)
    await page.goto('/admin?mock=empty')
    await expect(page.getByRole('heading', { name: 'Nenhum chope ainda' })).toBeVisible()
    await page.getByRole('tab', { name: /Cachaças/ }).click()
    await expect(page.getByRole('heading', { name: 'Nenhuma cachaça ainda' })).toBeVisible()
  })

  test('falha ao salvar mostra erro, mantém as alterações e permite tentar de novo', async ({
    page,
  }) => {
    await openPanel(page, '?mock=save-error')
    await price(page, '30 L', 'Dronken').fill('515,00')
    await save(page).click()
    await expect(page.getByRole('alert')).toContainText('Não foi possível salvar')
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('515,00')
    await expect(save(page)).toBeEnabled()
    await expect(page.getByText('1 produto tem alterações não salvas.')).toBeVisible()
  })

  test('aviso antes de fechar a aba com alterações não salvas', async ({ page }) => {
    await openPanel(page)
    const dialogs: string[] = []
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type())
      void dialog.dismiss()
    })
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))
    expect(dialogs).toEqual([])
    await price(page, '30 L', 'Dronken').fill('515,00')
    const prevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(prevented).toBe(true)
  })
})

test.describe('edição concorrente', () => {
  test('salvar sobre uma versão antiga é recusado: nada é sobrescrito e recarregar mostra o atual', async ({
    page,
  }) => {
    await openPanel(page, '?mock=conflict')
    await price(page, '50 L', 'Kaiser').fill('900,00')
    await save(page).click()
    const dialog = page.getByRole('dialog', { name: 'O catálogo mudou' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('nada foi salvo')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByText('O catálogo mudou em outra sessão. Recarregue para poder salvar.'),
    ).toBeVisible()
    await expect(price(page, '50 L', 'Kaiser')).toHaveValue('900,00')

    // Salvar de novo não chama o servidor: só reabre o aviso.
    await save(page).click()
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('button', { name: 'Salvando…' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Recarregar catálogo' }).click()
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('530,00')
    await expect(price(page, '50 L', 'Kaiser')).toHaveValue('890,00')
    await expect(page.getByText('Tudo salvo.')).toBeVisible()
    await price(page, '50 L', 'Kaiser').fill('900,00')
    await save(page).click()
    await expect(page.getByText('Salvo. As mudanças já estão no site.')).toBeVisible()
  })

  test('em conflito, Descartar recarrega do servidor', async ({ page }) => {
    await openPanel(page, '?mock=conflict')
    await price(page, '50 L', 'Kaiser').fill('900,00')
    await save(page).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Continuar editando' }).click()
    await page.getByRole('button', { name: 'Descartar' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click()
    await expect(price(page, '30 L', 'Dronken')).toHaveValue('530,00')
  })
})

test.describe('teclado e foco', () => {
  test('anel de foco dourado visível e ordem lógica do cabeçalho ao primeiro campo', async ({
    page,
  }) => {
    await openPanel(page)
    await page.keyboard.press('Tab')
    const site = page.getByRole('link', { name: 'Ver o site' })
    await expect(site).toBeFocused()
    await expect(site).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Novo produto' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('tab', { name: /Chopes/ })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Subir Dronken' })).toBeDisabled()
    await expect(price(page, '30 L', 'Dronken')).toBeFocused()
    await expect(price(page, '30 L', 'Dronken')).toHaveCSS('border-top-color', 'rgb(244, 177, 11)')
  })

  test('interruptor funciona com Espaço e anuncia o estado', async ({ page }) => {
    await openPanel(page)
    const toggle = page.getByRole('switch', { name: 'Dronken visível no site' })
    await toggle.focus()
    await expect(toggle).toBeChecked()
    await page.keyboard.press('Space')
    await expect(toggle).not.toBeChecked()
  })
})

test.describe('movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' })

  test('modal, toast e botões não animam', async ({ page }) => {
    await openPanel(page)
    await price(page, '30 L', 'Dronken').fill('515,00')
    await page.getByRole('button', { name: 'Descartar' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('animation-name', 'none')
    await expect(save(page)).toHaveCSS('transition-duration', '0s')
    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toBeHidden({ timeout: 100 })
    await save(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Salvo.' })).toHaveCSS(
      'animation-name',
      'none',
    )
  })
})

test.describe('movimento normal', () => {
  test('modal e toast usam animação curta de transform/opacity', async ({ page }) => {
    await openPanel(page)
    await price(page, '30 L', 'Dronken').fill('515,00')
    await page.getByRole('button', { name: 'Descartar' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveCSS('animation-name', /dialog-in|sheet-in/)
    await expect(dialog).toHaveCSS('animation-duration', '0.18s')
  })
})

test.describe('painel mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('cartões com rótulos visíveis, sem rolagem horizontal e barra fixa embaixo', async ({
    page,
  }) => {
    await openPanel(page)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
    await expect(page.getByText('8 produtos · 1 oculto')).toBeVisible()
    await expect(page.getByRole('listitem').first().getByText('30 L (R$)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeVisible()
    const bar = await page.getByRole('button', { name: 'Descartar' }).boundingBox()
    expect(bar && bar.y + bar.height).toBeGreaterThan(700)
    expect(bar?.height).toBeGreaterThanOrEqual(48)
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible()
    for (const name of ['Subir Palato Beber', 'Descer Palato Beber']) {
      const box = await page.getByRole('button', { name }).boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(48)
      expect(box?.height).toBeGreaterThanOrEqual(48)
    }
  })

  test('modal vira folha inferior e interruptor tem alvo de 48 px', async ({ page }) => {
    await openPanel(page)
    const toggle = await page.getByRole('switch', { name: 'Dronken visível no site' }).boundingBox()
    expect(toggle?.height).toBeGreaterThanOrEqual(48)
    await price(page, '30 L', 'Dronken').fill('515,00')
    await page.getByRole('button', { name: 'Descartar' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(300)
    const box = await dialog.boundingBox()
    expect(box?.x).toBe(0)
    expect(box?.width).toBe(390)
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844)
  })

  test('login cabe no celular sem rolagem horizontal', async ({ page }) => {
    await mockSession(page, false)
    await page.goto('/admin')
    await expect(page.getByLabel('Usuário')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
    const submit = await page.getByRole('button', { name: 'Entrar' }).boundingBox()
    expect(submit?.height).toBeGreaterThanOrEqual(48)
  })
})
