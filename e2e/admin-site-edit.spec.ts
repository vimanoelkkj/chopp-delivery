import { expect, type Page, type Route, test } from '@playwright/test'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

const user = { id: 'owner-id', username: 'owner' }
const rev = (n: number) => `c2_${String(n).padStart(8, '0')}-1234-4123-8123-123456789012`

type Doc = ReturnType<typeof previewFixture>
type Put = {
  operationId: string
  expectedRevision: string
  headers: Record<string, string>
  body: { document: Doc; operationId: string; expectedRevision: string; action: string }
}

/**
 * Servidor simulado do rascunho: guarda o documento e a revisão, e avança a revisão a cada PUT aceito.
 * Cada teste decide como o PUT responde; nada vai a um servidor real.
 */
async function openEditor(
  page: Page,
  options: {
    onPut?: (route: Route, put: Put, server: Server) => Promise<void> | void
    onReceipt?: (route: Route, server: Server) => Promise<void> | void
    hash?: string
  } = {},
) {
  const server: Server = {
    revision: rev(1),
    document: previewFixture(),
    puts: [],
    gets: 0,
    receipts: [],
  }
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.route('**/api/admin/site/commands/**', (route) => {
    server.receipts.push(route.request().url())
    return options.onReceipt
      ? options.onReceipt(route, server)
      : route.fulfill({ status: 404, json: { error: { code: 'CMS_COMMAND_NOT_FOUND' } } })
  })
  await page.route('**/api/admin/site/draft', async (route) => {
    const body = route.request().postDataJSON()
    const put: Put = {
      operationId: body.operationId,
      expectedRevision: body.expectedRevision,
      headers: route.request().headers(),
      body,
    }
    server.puts.push(put)
    await (options.onPut ?? accept)(route, put, server)
  })
  await page.route('**/api/admin/site', (route) => {
    server.gets++
    return route.fulfill({ status: 200, json: snapshot(server) })
  })
  await page.goto(`/admin${options.hash ?? '#pagina-inicial'}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Seções da página inicial' })).toBeVisible()
  return server
}

type Server = { revision: string; document: Doc; puts: Put[]; gets: number; receipts: string[] }
const snapshot = (server: Server) => ({
  schema: 2,
  draft: { revision: server.revision, document: server.document },
  published: null,
})
const receipt = (server: Server, put: Put, revision: string) => ({
  command: {
    operationId: put.operationId,
    action: 'saveDraft',
    expectedRevision: put.expectedRevision,
    revision,
    versionId: 'version_22222222-1234-4123-8123-123456789012',
  },
  site: { schema: 2, draft: { revision, document: server.document }, published: null },
})

/** O servidor aceita: grava o documento recebido e avança a revisão. */
const accept = (route: Route, put: Put, server: Server) => {
  if (put.expectedRevision !== server.revision)
    return route.fulfill({ status: 409, json: { error: { code: 'CMS_REVISION_CONFLICT' } } })
  server.document = put.body.document
  server.revision = rev(Number(server.revision.slice(3, 11)) + 1)
  return route.fulfill({ status: 200, json: receipt(server, put, server.revision) })
}

const section = (page: Page, name: RegExp | string) =>
  page.getByRole('navigation', { name: 'Seções da página inicial' }).getByRole('button', { name })
const saveButton = (page: Page) =>
  page.getByRole('button', { name: /^(Salvar rascunho|Salvando…)$/ })
const saved = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Rascunho salvo. Nada foi publicado.' })
const field = (page: Page, name: string | RegExp) => page.getByRole('textbox', { name })
const status = (page: Page) =>
  page.getByRole('status').filter({
    hasText: /Tudo salvo|não salvas|ajuste|Salvando|Confirmando|não foi salvo|Não sabemos/,
  })

test.describe('E6.1: edição e salvamento', () => {
  test('editar não envia nada; salvar envia um PUT com If-Match, operationId e só o campo alterado', async ({
    page,
  }) => {
    const server = await openEditor(page)
    const original = JSON.stringify(server.document)
    await expect(status(page)).toContainText('Tudo salvo')
    await expect(saveButton(page)).toBeDisabled()

    await field(page, 'Título').fill('Abertura reescrita')
    await expect(status(page)).toContainText('Alterações não salvas em 1 seção')
    await expect(page.getByText('A prévia ainda não mostra estas alterações')).toBeVisible()
    await expect(section(page, /Abertura reescrita/)).toContainText('Alterada')
    expect(server.puts).toEqual([])

    await saveButton(page).click()
    await expect(page.getByText('Rascunho salvo. Nada foi publicado.')).toBeVisible()
    await expect(status(page)).toContainText('Tudo salvo')
    expect(server.puts).toHaveLength(1)
    const [put] = server.puts
    expect(put.headers['if-match']).toBe(`"${rev(1)}"`)
    expect(put.expectedRevision).toBe(rev(1))
    expect(put.operationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Object.keys(put.body).sort()).toEqual([
      'action',
      'document',
      'expectedRevision',
      'operationId',
    ])
    expect(put.body.action).toBe('saveDraft')
    // só o título da abertura mudou; o resto do documento segue idêntico
    const sent = put.body.document as Doc
    const before = JSON.parse(original) as Doc
    expect(sent.commercial).toEqual(before.commercial)
    expect(sent.modules.map((m) => m.id)).toEqual(before.modules.map((m) => m.id))
    expect(sent.modules.slice(1)).toEqual(before.modules.slice(1))
    expect((sent.modules[0].content as { heading: string }).heading).toBe('Abertura reescrita')
    // o editor passou a usar a nova revisão
    await expect(page.getByText(`Revisão ${rev(2).slice(0, 11)}`)).toBeVisible()
  })

  test('FAQ: editar pergunta e resposta, adicionar e remover itens', async ({ page }) => {
    const server = await openEditor(page)
    await section(page, /Perguntas do rascunho/).click()
    await field(page, 'Pergunta 1').fill('Como faço o pedido?')
    await field(page, 'Resposta 1').fill('Pelo WhatsApp.\nRespondemos no mesmo dia.')
    await page.getByRole('button', { name: 'Adicionar item' }).click()
    // o foco vai para a pergunta nova, vazia
    const added = field(page, 'Pergunta 3')
    await expect(added).toBeFocused()
    await expect(added).toHaveValue('')
    await added.fill('Aceitam cartão?')
    await page.getByRole('button', { name: 'Remover Pergunta 1' }).click()
    await page.getByRole('button', { name: 'Remover Pergunta 1' }).click()
    await expect(field(page, 'Pergunta 1')).toHaveValue('Aceitam cartão?')
    await expect(field(page, 'Pergunta 2')).toHaveCount(0)
    // depois de remover, o foco volta ao botão de adicionar (não se perde na página)
    await expect(page.getByRole('button', { name: 'Adicionar item' })).toBeFocused()
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    const faq = (server.puts[0].body.document as Doc).modules.find((m) => m.template === 'faq')
    expect(
      ((faq as NonNullable<typeof faq>).content as { items: { question: string }[] }).items.map(
        (i) => i.question,
      ),
    ).toEqual(['Aceitam cartão?'])
  })

  test('faixa e passos: listas editoriais respeitam o limite de 12 itens', async ({ page }) => {
    await openEditor(page)
    await section(page, /Faixa de destaques/).click()
    const add = page.getByRole('button', { name: /Adicionar item|Limite de itens atingido/ })
    for (let i = 0; i < 20 && (await add.isEnabled()); i++) await add.click()
    await expect(add).toBeDisabled()
    await expect(add).toHaveText('Limite de itens atingido')
    await expect(page.getByText('Frases da faixa (12 de 12)')).toBeVisible()
    await expect(field(page, 'Frase 12')).toBeVisible()
  })

  test('visibilidade: seção opcional alterna; obrigatória não tem controle e a explica', async ({
    page,
  }) => {
    const server = await openEditor(page)
    await section(page, /História editorial/).click()
    const toggle = page.getByRole('switch', { name: /Mostrar/ })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(section(page, /História editorial/)).toContainText('Oculta')
    await expect(status(page)).toContainText('não salvas')
    await section(page, /Rascunho privado P4/).click()
    await expect(page.getByRole('switch')).toHaveCount(0)
    await expect(page.getByText('Sempre visível.')).toBeVisible()
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    const about = (server.puts[0].body.document as Doc).modules.find((m) => m.template === 'about')
    expect(about?.visible).toBe(false)
    const mandatory = (server.puts[0].body.document as Doc).modules.filter((m) =>
      ['hero', 'catalog', 'contact'].includes(m.template),
    )
    expect(mandatory.every((m) => m.visible)).toBe(true)
  })

  test('somente leitura: ids, tipo, âncora, mídia e dados comerciais não têm campo de edição', async ({
    page,
  }) => {
    await openEditor(page)
    await expect(page.getByLabel('Identificador')).toHaveCount(0)
    await expect(
      page.getByRole('textbox', { name: /Imagem|WhatsApp|Preço|Âncora|Tipo/ }),
    ).toHaveCount(0)
    await expect(page.getByText('Gerenciados na tela Produtos')).toHaveCount(0)
    await section(page, /Catálogo ao vivo/).click()
    await expect(page.getByText('Gerenciados na tela Produtos')).toBeVisible()
    await page.getByText('Documento e dados comerciais').click()
    await expect(page.getByRole('textbox', { name: /WhatsApp/ })).toHaveCount(0)
  })
})

test.describe('E6.1: validação e limites', () => {
  test('contador e erro acessível: 121 caracteres bloqueiam o salvamento até corrigir', async ({
    page,
  }) => {
    const server = await openEditor(page)
    const title = field(page, 'Título')
    await expect(page.getByTestId('char-count').first()).toContainText('de 120')
    await title.fill('a'.repeat(121))
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert').filter({ hasText: 'Sobra 1 caractere' })).toBeVisible()
    await expect(page.getByTestId('char-count').first()).toHaveText('121 de 120')
    const described = await title.getAttribute('aria-describedby')
    expect(described?.split(' ').length).toBeGreaterThanOrEqual(2)
    await expect(status(page)).toContainText('1 campo precisa de ajuste')
    await expect(saveButton(page)).toBeDisabled()
    await expect(section(page, /aaaa/)).toContainText('Precisa de ajuste')
    await title.fill('a'.repeat(120))
    await expect(title).not.toHaveAttribute('aria-invalid', 'true')
    await expect(saveButton(page)).toBeEnabled()
    expect(server.puts).toEqual([])
  })

  test('texto longo: 2000 passa, 2001 não; links e < > são recusados com explicação', async ({
    page,
  }) => {
    await openEditor(page)
    const summary = field(page, 'Resumo')
    await summary.fill('b'.repeat(2000))
    await expect(saveButton(page)).toBeEnabled()
    await summary.fill('b'.repeat(2001))
    await expect(saveButton(page)).toBeDisabled()
    await summary.fill('veja https://exemplo.com')
    await expect(
      page.getByText('Não coloque endereços de site ou links neste campo.'),
    ).toBeVisible()
    await summary.fill('oi <b>')
    await expect(page.getByText('Não use os símbolos < e >.')).toBeVisible()
    await summary.fill('Texto sem problema.')
    await expect(saveButton(page)).toBeEnabled()
  })

  test('problema em outra seção aparece na lista e impede salvar mesmo fora de vista', async ({
    page,
  }) => {
    await openEditor(page)
    await field(page, 'Título').fill('x'.repeat(130))
    await section(page, /Perguntas do rascunho/).click()
    await expect(page.getByRole('navigation', { name: 'Seções da página inicial' })).toContainText(
      'Precisa de ajuste',
    )
    await expect(saveButton(page)).toBeDisabled()
  })
})

test.describe('E6.1: alterações não salvas', () => {
  test('descartar pede confirmação; cancelar mantém, confirmar volta ao salvo sem enviar nada', async ({
    page,
  }) => {
    const server = await openEditor(page)
    const title = field(page, 'Título')
    const original = await title.inputValue()
    await title.fill('Rascunho temporário')
    await page.getByRole('button', { name: 'Descartar alterações' }).click()
    await expect(page.getByRole('dialog', { name: 'Descartar as alterações?' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar editando' })).toBeFocused()
    await page.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(title).toHaveValue('Rascunho temporário')
    await page.getByRole('button', { name: 'Descartar alterações' }).click()
    await page.getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(title).toHaveValue(original)
    await expect(status(page)).toContainText('Tudo salvo')
    expect(server.puts).toEqual([])
  })

  test('aviso de saída só com alterações: beforeunload e ponto na aba', async ({ page }) => {
    await openEditor(page)
    const warns = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      })
    expect(await warns()).toBe(false)
    await field(page, 'Título').fill('Mudança')
    await expect.poll(warns).toBe(true)
    await expect(page.getByRole('link', { name: /Página inicial/ })).toContainText(
      'alterações não salvas',
    )
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    await expect.poll(warns).toBe(false)
  })

  test('Atualizar com alterações pede confirmação antes de recarregar o servidor', async ({
    page,
  }) => {
    const server = await openEditor(page)
    await field(page, 'Título').fill('Mudança')
    const before = server.gets
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: /Descartar as alterações e atualizar/ }),
    ).toBeVisible()
    expect(server.gets).toBe(before)
    await page.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(field(page, 'Título')).toHaveValue('Mudança')
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
    await page.getByRole('button', { name: 'Descartar e atualizar' }).click()
    await expect.poll(() => server.gets).toBe(before + 1)
    await expect(field(page, 'Título')).not.toHaveValue('Mudança')
  })

  test('as alterações sobrevivem à troca de tela (Produtos) e ao voltar', async ({ page }) => {
    await openEditor(page)
    await field(page, 'Título').fill('Continua aqui')
    await page.getByRole('link', { name: /^Produtos/ }).click()
    await expect(page.getByRole('link', { name: /Página inicial/ })).toContainText(
      'alterações não salvas',
    )
    await page.getByRole('link', { name: /^Página inicial/ }).click()
    await expect(field(page, 'Título')).toHaveValue('Continua aqui')
  })

  test('sem autosave: esperar não grava nada', async ({ page }) => {
    const server = await openEditor(page)
    await field(page, 'Título').fill('Sem pressa')
    await page.waitForTimeout(1500)
    expect(server.puts).toEqual([])
  })
})

test.describe('E6.1: falhas ao salvar', () => {
  test('duplo clique em salvar envia uma única requisição', async ({ page }) => {
    const server = await openEditor(page, {
      onPut: async (route, put, srv) => {
        await new Promise((resolve) => setTimeout(resolve, 400))
        await accept(route, put, srv)
      },
    })
    await field(page, 'Título').fill('Duplo')
    await saveButton(page).dblclick()
    await expect(saved(page)).toBeVisible()
    expect(server.puts).toHaveLength(1)
  })

  test('durante o salvamento os campos ficam travados e o estado é anunciado', async ({ page }) => {
    await openEditor(page, {
      onPut: async (route, put, srv) => {
        await new Promise((resolve) => setTimeout(resolve, 600))
        await accept(route, put, srv)
      },
    })
    await field(page, 'Título').fill('Salvando')
    await saveButton(page).click()
    await expect(status(page)).toContainText('Salvando o rascunho')
    await expect(field(page, 'Título')).toBeDisabled()
    await expect(saved(page)).toBeVisible()
    await expect(field(page, 'Título')).toBeEnabled()
  })

  test('conflito (409): nada gravado, alterações preservadas, salvar bloqueado, carregar a versão atual pede confirmação', async ({
    page,
  }) => {
    const server = await openEditor(page, {
      onPut: (route) =>
        route.fulfill({ status: 409, json: { error: { code: 'CMS_REVISION_CONFLICT' } } }),
    })
    await field(page, 'Título').fill('Minha versão')
    await saveButton(page).click()
    const alert = page.getByRole('alert').filter({ hasText: 'O rascunho mudou em outro lugar' })
    await expect(alert).toContainText('Nada foi gravado')
    // o aviso recebe o foco e fica à vista, mesmo com o formulário longo
    await expect(alert).toBeFocused()
    await expect(alert).toBeInViewport()
    await expect(status(page)).toContainText('O rascunho não foi salvo')
    await expect(field(page, 'Título')).toHaveValue('Minha versão')
    await expect(saveButton(page)).toBeDisabled()
    await page.waitForTimeout(400)
    expect(server.puts).toHaveLength(1)
    // outra pessoa salvou: a versão atual do servidor é diferente
    server.revision = rev(5)
    ;(server.document.modules[0].content as { heading: string }).heading = 'Versão do servidor'
    await alert.getByRole('button', { name: 'Carregar versão atual…' }).click()
    await expect(page.getByRole('dialog', { name: 'Carregar a versão atual?' })).toBeVisible()
    await page.getByRole('button', { name: 'Descartar e carregar' }).click()
    await expect(field(page, 'Título')).toHaveValue('Versão do servidor')
    await expect(page.getByText(`Revisão ${rev(5).slice(0, 11)}`)).toBeVisible()
    expect(server.puts).toHaveLength(1)
  })

  test('falha de rede com recibo no servidor: confirma pelo recibo, sem reenviar', async ({
    page,
  }) => {
    const server = await openEditor(page, {
      onPut: (route, put, srv) => {
        // o servidor gravou, mas a resposta se perdeu
        srv.document = put.body.document
        srv.revision = rev(2)
        return route.abort('failed')
      },
      onReceipt: (route, srv) =>
        route.fulfill({
          status: 200,
          json: receipt(srv, srv.puts[0], srv.revision),
        }),
    })
    await field(page, 'Título').fill('Gravou e perdeu a resposta')
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    expect(server.puts).toHaveLength(1)
    expect(server.receipts).toHaveLength(1)
    expect(server.receipts[0]).toContain(server.puts[0].operationId)
    await expect(status(page)).toContainText('Tudo salvo')
  })

  test('falha de rede sem recibo: preserva o texto, trava edição, e só reenvia por clique com o mesmo operationId', async ({
    page,
  }) => {
    let first = true
    const server = await openEditor(page, {
      onPut: (route, put, srv) => {
        if (first) {
          first = false
          return route.abort('failed')
        }
        return accept(route, put, srv)
      },
    })
    await field(page, 'Título').fill('Texto que não pode se perder')
    await saveButton(page).click()
    const alert = page.getByRole('alert').filter({ hasText: 'Não conseguimos confirmar' })
    await expect(alert).toBeVisible()
    await expect(field(page, 'Título')).toHaveValue('Texto que não pode se perder')
    await expect(field(page, 'Título')).toBeDisabled()
    await page.waitForTimeout(600)
    expect(server.puts).toHaveLength(1)
    await alert.getByRole('button', { name: 'Tentar salvar de novo' }).click()
    await expect(saved(page)).toBeVisible()
    expect(server.puts).toHaveLength(2)
    expect(server.puts[1].operationId).toBe(server.puts[0].operationId)
    expect(server.puts[1].body).toEqual(server.puts[0].body)
    await expect(field(page, 'Título')).toHaveValue('Texto que não pode se perder')
  })

  test('"Verificar agora" consulta o recibo sem reenviar', async ({ page }) => {
    const server = await openEditor(page, { onPut: (route) => route.abort('failed') })
    await field(page, 'Título').fill('Verificar')
    await saveButton(page).click()
    const alert = page.getByRole('alert').filter({ hasText: 'Não conseguimos confirmar' })
    await expect(alert).toBeVisible()
    expect(server.receipts).toHaveLength(1)
    await alert.getByRole('button', { name: 'Verificar agora' }).click()
    await expect.poll(() => server.receipts.length).toBe(2)
    expect(server.puts).toHaveLength(1)
  })

  test('erro 5xx: tratado como incerto, nada de reenvio automático', async ({ page }) => {
    const server = await openEditor(page, {
      onPut: (route) =>
        route.fulfill({ status: 503, json: { error: { code: 'CMS_WRITE_INCOMPLETE' } } }),
    })
    await field(page, 'Título').fill('Meio gravado?')
    await saveButton(page).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Não conseguimos confirmar' }),
    ).toBeVisible()
    await page.waitForTimeout(600)
    expect(server.puts).toHaveLength(1)
  })

  test('servidor recusa (400): mensagem, nada gravado e texto preservado', async ({ page }) => {
    const server = await openEditor(page, {
      onPut: (route) =>
        route.fulfill({ status: 400, json: { error: { code: 'VALIDATION_ERROR', fields: {} } } }),
    })
    await field(page, 'Título').fill('Recusado')
    await saveButton(page).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'O servidor recusou o rascunho' }),
    ).toContainText('Nada foi gravado')
    await expect(field(page, 'Título')).toHaveValue('Recusado')
    expect(server.puts).toHaveLength(1)
    // ao editar de novo, o alerta some e é possível salvar outra tentativa
    await field(page, 'Título').fill('Recusado 2')
    await expect(page.getByRole('alert').filter({ hasText: 'O servidor recusou' })).toHaveCount(0)
    await expect(saveButton(page)).toBeEnabled()
  })

  test('CMS v2 indisponível (503 CMS_SCHEMA_UNAVAILABLE): nada gravado e nova tentativa manual', async ({
    page,
  }) => {
    let unavailable = true
    const server = await openEditor(page, {
      onPut: (route, put, srv) =>
        unavailable
          ? route.fulfill({ status: 503, json: { error: { code: 'CMS_SCHEMA_UNAVAILABLE' } } })
          : accept(route, put, srv),
    })
    await field(page, 'Título').fill('Quando voltar')
    await saveButton(page).click()
    const alert = page.getByRole('alert').filter({ hasText: 'O CMS v2 não está disponível' })
    await expect(alert).toContainText('Nada foi gravado')
    unavailable = false
    await alert.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(saved(page)).toBeVisible()
    expect(server.puts).toHaveLength(2)
    expect(server.puts[1].operationId).toBe(server.puts[0].operationId)
  })

  test('sessão expirada ao salvar: volta ao login e restaura as alterações depois de entrar', async ({
    page,
  }) => {
    let expired = true
    const server = await openEditor(page, {
      onPut: (route, put, srv) =>
        expired
          ? route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
          : accept(route, put, srv),
    })
    await field(page, 'Título').fill('Escrito antes de cair')
    await saveButton(page).click()
    await expect(page.getByLabel('Usuário')).toBeVisible()
    await expect(page.getByText(/alterações não salvas ficam guardadas/)).toBeVisible()
    expect(server.puts).toHaveLength(1)
    expired = false
    await page.getByLabel('Usuário').fill('owner')
    await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByText('Suas alterações foram restauradas depois do login')).toBeVisible()
    await expect(field(page, 'Título')).toHaveValue('Escrito antes de cair')
    await expect(status(page)).toContainText('não salvas')
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    expect(server.puts).toHaveLength(2)
  })

  test('sessão expirada, mas o rascunho mudou enquanto isso: preserva a cópia local em conflito sem sobrescrever o servidor', async ({
    page,
  }) => {
    let expired = true
    const server = await openEditor(page, {
      onPut: (route, put, srv) =>
        expired
          ? route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
          : accept(route, put, srv),
    })
    await field(page, 'Título').fill('Escrito antes de cair')
    await saveButton(page).click()
    await expect(page.getByLabel('Usuário')).toBeVisible()
    server.revision = rev(9)
    ;(server.document.modules[0].content as { heading: string }).heading = 'Mudou fora'
    expired = false
    await page.getByLabel('Usuário').fill('owner')
    await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(
      page.getByText('Suas alterações foram preservadas', { exact: false }),
    ).toBeVisible()
    await expect(field(page, 'Título')).toHaveValue('Escrito antes de cair')
    await expect(saveButton(page)).toBeDisabled()
    expect((server.document.modules[0].content as { heading: string }).heading).toBe('Mudou fora')
    expect(server.puts).toHaveLength(1)
  })
})

test.describe('E6.1: prévia e publicação', () => {
  test('a prévia é link para a rota autenticada e diz que só mostra o salvo; não há publicar', async ({
    page,
  }) => {
    await openEditor(page)
    const preview = page.getByRole('link', { name: /Abrir prévia/ })
    await expect(preview).toHaveAttribute('href', '/admin/preview')
    await expect(preview).toHaveAttribute('target', '_blank')
    await expect(preview).toHaveAccessibleName(/mostra só o último rascunho salvo/)
    await expect(page.getByText(/só o que for salvo aparece na prévia/)).toBeVisible()
    await expect(page.getByRole('button', { name: /publicar/i })).toHaveCount(0)
    await expect(page.getByText('Desativada. Nada deste documento está publicado.')).toBeHidden()
    await page.getByText('Documento e dados comerciais').click()
    await expect(page.getByText('Desativada. Nada deste documento está publicado.')).toBeVisible()
  })

  test('envia somente saveDraft: nunca publish, convert, start ou PUT fora do endpoint do rascunho', async ({
    page,
  }) => {
    const server = await openEditor(page)
    const other: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.pathname.startsWith('/api/admin/site') &&
        request.method() !== 'GET' &&
        url.pathname !== '/api/admin/site/draft'
      )
        other.push(`${request.method()} ${url.pathname}`)
    })
    await field(page, 'Título').fill('Só rascunho')
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    expect(other).toEqual([])
    expect(server.puts.map((put) => put.body.action)).toEqual(['saveDraft'])
  })
})

test.describe('E6.1: layout e acessibilidade', () => {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    test(`${width}px: sem rolagem horizontal, campos e botões de 44px, barra de salvar visível`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await openEditor(page)
      await field(page, 'Título').fill('Layout')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      const targets = [
        field(page, 'Título'),
        saveButton(page),
        page.getByRole('button', { name: 'Descartar alterações' }),
      ]
      for (const target of targets) {
        const box = await target.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      }
      // a barra de salvar fica dentro da janela, mesmo no fim de uma página longa
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      const bar = await saveButton(page).boundingBox()
      expect(bar && bar.y >= 0 && bar.y + bar.height <= height).toBe(true)
      expect(bar && bar.x >= 0 && bar.x + bar.width <= width).toBe(true)
    })
  }

  test('campo focado não fica escondido atrás da barra de salvar (390px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await openEditor(page)
    await section(page, /Perguntas do rascunho/).click()
    const last = field(page, /^Resposta/).last()
    await last.focus()
    const box = await last.boundingBox()
    const bar = await page.locator('[data-dirty]').last().boundingBox()
    expect(box && bar && box.y + box.height <= bar.y + 1).toBe(true)
  })

  test('teclado: Tab chega ao campo, digita, Tab até Salvar e Enter grava; foco visível', async ({
    page,
  }) => {
    const server = await openEditor(page)
    await field(page, 'Título').focus()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Pelo teclado')
    const outline = await field(page, 'Título').evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
    await saveButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(saved(page)).toBeVisible()
    expect(server.puts).toHaveLength(1)
  })

  test('diálogo de descarte: Esc não fecha, foco preso e volta ao botão', async ({ page }) => {
    await openEditor(page)
    await field(page, 'Título').fill('x')
    const discard = page.getByRole('button', { name: 'Descartar alterações' })
    await discard.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Descartar as alterações?' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true)
    await page.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toHaveCount(0)
  })
})

test('E6.2: Atualizar não desmonta o editor enquanto o PUT está pendente', async ({ page }) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const server = await openEditor(page, {
    onPut: async (route, put, srv) => {
      await held
      await accept(route, put, srv).catch(() => {})
    },
  })
  await field(page, 'Título').fill('Operação pendente')
  await saveButton(page).click()
  try {
    await expect(saveButton(page)).toContainText('Salvando')
    await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeDisabled()
    expect(server.gets).toBe(1)
  } finally {
    release()
  }
  await expect(saved(page)).toBeVisible()
  await expect(field(page, 'Título')).toHaveValue('Operação pendente')
  expect(server.puts).toHaveLength(1)
})

test('E6.2: expiração em Produtos preserva também a edição das seções', async ({ page }) => {
  const server = await openEditor(page, { hash: '?mock=expired#pagina-inicial' })
  await field(page, 'Título').fill('Texto local das seções')
  await page.getByRole('link', { name: /^Produtos/ }).click()
  await page.getByLabel('30 L, preço em reais, Dronken').fill('51500')
  await page.getByRole('button', { name: /^Salvar/ }).click()
  await expect(page.getByLabel('Usuário')).toBeVisible()
  await page.getByLabel('Usuário').fill('owner')
  await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByLabel('30 L, preço em reais, Dronken')).toHaveValue('515,00')
  await page.getByRole('link', { name: /^Página inicial/ }).click()
  await expect(field(page, 'Título')).toHaveValue('Texto local das seções')
  expect(server.puts).toEqual([])
})

test('E6.2: resposta 401 de uma tela desmontada não encerra o novo login', async ({ page }) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await openEditor(page, {
    onPut: async (route) => {
      await held
      await route
        .fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
        .catch(() => {})
    },
  })
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 200, json: {} }))
  await field(page, 'Título').fill('Sessão antiga')
  await saveButton(page).click()
  try {
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Sair/ }).click()
    await expect(page.getByLabel('Usuário')).toBeVisible()
    await page.getByLabel('Usuário').fill('owner')
    await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(field(page, 'Título')).toHaveValue('Rascunho privado P4')
    await field(page, 'Título').fill('Nova sessão preservada')
  } finally {
    release()
  }
  await page.waitForTimeout(200)
  await expect(field(page, 'Título')).toHaveValue('Nova sessão preservada')
  await expect(page.getByLabel('Usuário')).toHaveCount(0)
})

test('E6.2: expiração depois do commit reconhece o texto salvo sem reenviar', async ({ page }) => {
  const server = await openEditor(page, {
    onPut: (route, put, srv) => {
      srv.document = put.body.document
      srv.revision = rev(2)
      return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
    },
  })
  await field(page, 'Título').fill('Já persistido no servidor')
  await saveButton(page).click()
  await expect(page.getByLabel('Usuário')).toBeVisible()
  await page.getByLabel('Usuário').fill('owner')
  await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(field(page, 'Título')).toHaveValue('Já persistido no servidor')
  await expect(page.getByRole('alert').filter({ hasText: 'O documento mudou' })).toHaveCount(0)
  await expect(status(page)).toContainText('Tudo salvo')
  await expect(saveButton(page)).toBeDisabled()
  expect(server.puts).toHaveLength(1)
})

test('E6.2: expiração no CMS preserva também os preços pendentes de Produtos', async ({ page }) => {
  await openEditor(page, {
    onPut: (route) => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
  })
  await page.getByRole('link', { name: /^Produtos/ }).click()
  await page.getByLabel('30 L, preço em reais, Dronken').fill('51500')
  await page.getByRole('link', { name: /^Página inicial/ }).click()
  await field(page, 'Título').fill('Local antes da expiração')
  await saveButton(page).click()
  await expect(page.getByLabel('Usuário')).toBeVisible()
  await page.getByLabel('Usuário').fill('owner')
  await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(field(page, 'Título')).toHaveValue('Local antes da expiração')
  await page.getByRole('link', { name: /^Produtos/ }).click()
  await expect(page.getByLabel('30 L, preço em reais, Dronken')).toHaveValue('515,00')
})

test('E6.2: 404 inconclusivo bloqueia Atualizar e depois reconcilia sem outro PUT', async ({
  page,
}) => {
  let committed = false
  const server = await openEditor(page, {
    onPut: (route) => route.abort('failed'),
    onReceipt: (route, srv) =>
      committed
        ? route.fulfill({ status: 200, json: receipt(srv, srv.puts[0], srv.revision) })
        : route.fulfill({ status: 404, json: { error: { code: 'CMS_COMMAND_NOT_FOUND' } } }),
  })
  await field(page, 'Título').fill('Gravação tardia')
  await saveButton(page).click()
  const alert = page.getByRole('alert').filter({ hasText: 'Não conseguimos confirmar' })
  await expect(alert).toBeVisible()
  await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeDisabled()
  await expect(field(page, 'Título')).toBeDisabled()
  await page.waitForTimeout(250)
  expect(server.puts).toHaveLength(1)
  server.document = server.puts[0].body.document
  server.revision = rev(2)
  committed = true
  await alert.getByRole('button', { name: 'Verificar agora' }).click()
  await expect(saved(page)).toBeVisible()
  await expect(field(page, 'Título')).toHaveValue('Gravação tardia')
  expect(server.puts).toHaveLength(1)
  expect(server.receipts.every((url) => url.endsWith(server.puts[0].operationId))).toBe(true)
})

test('E6.2: cancelar recarga e fechamento da aba preserva o texto sem storage', async ({
  page,
}) => {
  await openEditor(page)
  await field(page, 'Título').fill('Texto antes de recarregar')
  await expect(field(page, 'Título')).toHaveValue('Texto antes de recarregar')
  const reloadDialog = page.waitForEvent('dialog')
  // Não aguardar um novo load: a navegação será cancelada pelo usuário no beforeunload.
  const reloading = page.evaluate(() => window.location.reload())
  const dialog = await reloadDialog
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await reloading
  await expect(field(page, 'Título')).toHaveValue('Texto antes de recarregar')
  const closeDialog = page.waitForEvent('dialog')
  await page.close({ runBeforeUnload: true })
  const closing = await closeDialog
  expect(closing.type()).toBe('beforeunload')
  await closing.dismiss()
  expect(page.isClosed()).toBe(false)
  await expect(field(page, 'Título')).toHaveValue('Texto antes de recarregar')
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
})

test('E6.2: salvar Produtos e seções mantém os dois domínios independentes', async ({ page }) => {
  const server = await openEditor(page)
  await field(page, 'Título').fill('CMS local independente')
  await page.getByRole('link', { name: /^Produtos/ }).click()
  await page.getByLabel('30 L, preço em reais, Dronken').fill('51500')
  await page.getByRole('button', { name: /^Salvar/ }).click()
  await expect(page.getByText('Tudo salvo.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /^Página inicial/ }).click()
  await expect(field(page, 'Título')).toHaveValue('CMS local independente')
  await expect(status(page)).toContainText('não salvas')
  expect(server.puts).toEqual([])
  expect(server.gets).toBe(1)
  await saveButton(page).click()
  await expect(saved(page)).toBeVisible()
  await page.getByRole('link', { name: /^Produtos/ }).click()
  await expect(page.getByLabel('30 L, preço em reais, Dronken')).toHaveValue('515,00')
  await expect(page.getByText('Tudo salvo.', { exact: true })).toBeVisible()
  expect(server.puts).toHaveLength(1)
})

for (const accessStatus of [200, 401, 403, 302]) {
  test(`M3D.1: Access ${accessStatus} during save preserves the editor and never resends`, async ({
    page,
  }) => {
    const server = await openEditor(page, {
      onPut: (route) =>
        route.fulfill({
          status: accessStatus,
          contentType: 'text/html',
          body: '<html>Access authentication required</html>',
          ...(accessStatus === 302 ? { headers: { Location: '/access-login' } } : {}),
        }),
      onReceipt: (route) =>
        route.fulfill({
          status: 401,
          contentType: 'text/html',
          body: '<html>Access expired</html>',
        }),
    })
    await field(page, 'Título').fill('Texto local preservado durante expiração Access')
    await saveButton(page).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Não conseguimos confirmar' }),
    ).toBeVisible()
    await expect(field(page, 'Título')).toHaveValue(
      'Texto local preservado durante expiração Access',
    )
    await expect(saveButton(page)).toBeDisabled()
    expect(server.puts).toHaveLength(1)
    const operationId = server.puts[0].operationId
    expect(server.receipts.every((url) => url.endsWith(operationId))).toBe(true)
    await page.getByRole('button', { name: 'Verificar agora' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Não conseguimos confirmar' }),
    ).toBeVisible()
    expect(server.puts).toHaveLength(1)
    expect(server.receipts).toHaveLength(2)
    await expect(field(page, 'Título')).toHaveValue(
      'Texto local preservado durante expiração Access',
    )
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
  })
}
