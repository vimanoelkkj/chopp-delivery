import { expect, type Page, type Route, test } from '@playwright/test'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

const user = { id: 'owner-id', username: 'owner' }
const REV2 = 'c2_12345678-1234-4123-8123-123456789012'
const REV1 = 'c1_12345678-1234-4123-8123-123456789012'

const v2Body = (mutate?: (doc: ReturnType<typeof previewFixture>) => void) => {
  const document = previewFixture()
  mutate?.(document)
  return { schema: 2, draft: { revision: REV2, document }, published: null }
}
const noneBody = { schema: null, draft: { revision: REV1, document: null }, published: null }
const v1Body = {
  schema: 1,
  draft: { revision: REV1, document: { schemaVersion: 1 } },
  published: null,
}

type Reply = { status?: number; json?: unknown; body?: string; delayMs?: number }

/** Sessão simulada e GET /api/admin/site controlado; registra tudo que passar por /api/admin/site. */
async function openSite(page: Page, reply: Reply, hash = '#pagina-inicial') {
  const calls: { method: string; url: string }[] = []
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.route('**/api/admin/site**', async (route: Route) => {
    calls.push({ method: route.request().method(), url: route.request().url() })
    if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
    await route.fulfill({
      status: reply.status ?? 200,
      ...(reply.body === undefined ? { json: reply.json } : { body: reply.body }),
    })
  })
  await page.goto(`/admin${hash}`)
  return calls
}

const sectionList = (page: Page) =>
  page.getByRole('navigation', { name: 'Seções da página inicial' })

test.describe('Página inicial: leitura do documento v2', () => {
  test('lista as seções na ordem do documento, com id e visibilidade preservados', async ({
    page,
  }) => {
    const expected = previewFixture().modules
    await openSite(page, { json: v2Body() })
    await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeVisible()
    const items = sectionList(page).getByRole('button')
    await expect(items).toHaveCount(expected.length)
    // a primeira é a abertura e a última o contato, como no documento
    await expect(items.first()).toContainText('Rascunho privado P4')
    await expect(items.last()).toContainText('Contato')
    await expect(page.getByLabel('Resumo do documento')).toContainText(`${expected.length} seções`)
  })

  test('selecionar uma seção mostra estrutura e conteúdo com a situação de cada campo', async ({
    page,
  }) => {
    await openSite(page, { json: v2Body() })
    await sectionList(page)
      .getByRole('button', { name: /Perguntas do rascunho/ })
      .click()
    const detail = page.getByRole('region', { name: 'Perguntas do rascunho' })
    await expect(detail.getByRole('heading', { level: 2 })).toHaveText('Perguntas do rascunho')
    await expect(detail.getByText('module_12345678-1234-4123-8123-000000000003')).toBeVisible()
    await expect(detail.getByText('#faq')).toBeVisible()
    await expect(detail.getByText('Este conteúdo está publicado?')).toBeVisible()
    await expect(detail.getByText('até 120 caracteres').first()).toBeVisible()
    // as três situações existem na tela e são texto, não só cor
    await expect(detail.getByText('Editável depois').first()).toBeVisible()
    await expect(detail.getByText('Somente leitura').first()).toBeVisible()
    await sectionList(page)
      .getByRole('button', { name: /Rascunho privado P4/ })
      .click()
    await expect(
      page.getByRole('region', { name: 'Rascunho privado P4' }).getByText('Indisponível').first(),
    ).toBeVisible()
  })

  test('seção obrigatória tem visibilidade somente leitura e a oculta aparece como "Oculta"', async ({
    page,
  }) => {
    await openSite(page, {
      json: v2Body((doc) => {
        const index = doc.modules.findIndex((m) => m.template === 'about')
        doc.modules[index] = { ...doc.modules[index], visible: false } as never
      }),
    })
    const hidden = sectionList(page).getByRole('button', { name: /História editorial/ })
    await expect(hidden).toContainText('Oculta')
    await hidden.click()
    const detail = page.getByRole('region', { name: 'História editorial' })
    await expect(detail.getByText('Fora da página (oculta)')).toBeVisible()
    await sectionList(page)
      .getByRole('button', { name: /Rascunho privado P4/ })
      .click()
    await expect(page.getByText('Obrigatória: precisa estar sempre visível.')).toBeVisible()
  })

  test('é somente leitura: só um GET em /api/admin/site, nenhuma escrita, conversão ou início', async ({
    page,
  }) => {
    const calls = await openSite(page, { json: v2Body() })
    await expect(sectionList(page).getByRole('button').first()).toBeVisible()
    for (const name of [/Perguntas do rascunho/, /Como consultar/, /História editorial/])
      await sectionList(page).getByRole('button', { name }).click()
    await page.getByRole('button', { name: 'Atualizar' }).click()
    await expect.poll(() => calls.length).toBe(2)
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET'])
    expect(calls.every((call) => new URL(call.url).pathname === '/api/admin/site')).toBe(true)
  })

  test('mostra os avisos do documento e o link da prévia autenticada', async ({ page }) => {
    await openSite(page, {
      json: v2Body((doc) => {
        const index = doc.modules.findIndex((m) => m.template === 'carousel')
        doc.modules[index] = { ...doc.modules[index], visible: false } as never
      }),
    })
    await expect(page.getByText('A vitrine de barris está oculta.')).toBeVisible()
    const preview = page.getByRole('link', { name: 'Abrir prévia' })
    await expect(preview).toHaveAttribute('href', '/admin/preview')
    await expect(preview).toHaveAttribute('target', '_blank')
    await expect(preview).toHaveAttribute('rel', /noopener/)
  })

  test('documento e dados comerciais: publicação desativada e WhatsApp não definido', async ({
    page,
  }) => {
    await openSite(page, { json: v2Body() })
    await page.getByText('Documento e dados comerciais').click()
    await expect(page.getByText('Desativada. Nada deste documento está publicado.')).toBeVisible()
    await expect(page.getByText('Não definido')).toBeVisible()
    await expect(page.getByText(REV2)).toBeVisible()
  })
})

test.describe('Página inicial: estados', () => {
  test('sem documento: explica e só oferece iniciar por ação explícita (sem escrita ao abrir)', async ({
    page,
  }) => {
    const calls = await openSite(page, { json: noneBody })
    await expect(
      page.getByRole('heading', { name: 'Ainda não há documento da página inicial' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Iniciar documento/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /converter/i })).toHaveCount(0)
    expect(calls.map((call) => call.method)).toEqual(['GET'])
  })

  test('rascunho v1: oferece conversão só depois da prévia, nunca ao abrir', async ({ page }) => {
    await openSite(page, { json: v1Body })
    await expect(
      page.getByRole('heading', { name: 'O rascunho está no formato antigo (v1)' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Iniciar documento/ })).toHaveCount(0)
  })

  test('sessão expirada (401): volta ao login com o aviso', async ({ page }) => {
    await openSite(page, { status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
    await expect(page.getByRole('heading', { name: /Painel/, level: 1 })).toBeVisible()
    await expect(page.getByText(/sessão expirou/i)).toBeVisible()
    await expect(page.getByLabel('Usuário')).toBeVisible()
  })

  test('sem permissão (403): mensagem própria, sem tentar de novo', async ({ page }) => {
    await openSite(page, { status: 403, json: { error: { code: 'FORBIDDEN' } } })
    await expect(
      page.getByRole('heading', { name: 'Sem permissão para ver a página inicial' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0)
  })

  test('CMS indisponível (503): alerta com nova tentativa', async ({ page }) => {
    await openSite(page, { status: 503, json: { error: { code: 'CMS_SCHEMA_UNAVAILABLE' } } })
    await expect(page.getByRole('alert')).toContainText('O CMS está indisponível no momento')
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  })

  for (const [title, reply] of [
    ['erro de servidor (500)', { status: 500, json: { error: {} } }],
    ['resposta que não é JSON', { status: 200, body: 'não é json' }],
    [
      'documento inválido',
      {
        status: 200,
        json: {
          schema: 2,
          draft: { revision: REV2, document: { schemaVersion: 2 } },
          published: null,
        },
      },
    ],
    ['publicado não nulo', { status: 200, json: { ...v2Body(), published: { versionId: 'x' } } }],
  ] as [string, Reply][]) {
    test(`falha segura sem renderizar conteúdo: ${title}`, async ({ page }) => {
      await openSite(page, reply)
      await expect(page.getByRole('alert')).toContainText(
        'Não conseguimos carregar a página inicial',
      )
      await expect(sectionList(page)).toHaveCount(0)
    })
  }

  test('carregando: mostra o estado de carregamento até a resposta chegar', async ({ page }) => {
    await openSite(page, { json: v2Body(), delayMs: 600 })
    await expect(page.getByRole('status', { name: 'Carregando a página inicial' })).toBeVisible()
    await expect(sectionList(page).getByRole('button').first()).toBeVisible()
  })
})

test.describe('Página inicial: navegação e acessibilidade', () => {
  test('sem fragmento o painel abre em Produtos; o link troca de tela e voltar/avançar funcionam', async ({
    page,
  }) => {
    await openSite(page, { json: v2Body() }, '')
    await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Produtos' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.getByRole('link', { name: 'Página inicial' }).click()
    await expect(page).toHaveURL(/#pagina-inicial$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeHidden()
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible()
    await page.goForward()
    await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeVisible()
  })

  test('alterações não salvas do catálogo sobrevivem à troca de tela e a aba avisa', async ({
    page,
  }) => {
    await openSite(page, { json: v2Body() }, '')
    const price = page.getByLabel('30 L, preço em reais, Dronken')
    await price.fill('51500')
    await expect(page.getByText('1 produto tem alterações não salvas.')).toBeVisible()
    await page.getByRole('link', { name: 'Página inicial' }).click()
    await expect(sectionList(page).getByRole('button').first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Produtos.*alterações não salvas/ })).toBeVisible()
    await page.getByRole('link', { name: /Produtos/ }).click()
    await expect(page.getByLabel('30 L, preço em reais, Dronken')).toHaveValue('515,00')
    await expect(page.getByText('1 produto tem alterações não salvas.')).toBeVisible()
  })

  test('ao trocar de tela o foco vai para o título e o carregamento inicial não rouba foco', async ({
    page,
  }) => {
    await openSite(page, { json: v2Body() }, '')
    await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible()
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY')
    await page.getByRole('link', { name: 'Página inicial' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeFocused()
  })

  test('teclado: a lista de seções se percorre com Tab e Enter seleciona', async ({ page }) => {
    await openSite(page, { json: v2Body() })
    const second = sectionList(page).getByRole('button', { name: /Barris do catálogo/ })
    await second.focus()
    await expect(second).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(second).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('region', { name: 'Barris do catálogo' })).toBeVisible()
  })

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    test(`${width}px: sem rolagem horizontal e alvos de toque de pelo menos 44 px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await openSite(page, { json: v2Body() })
      await expect(sectionList(page).getByRole('button').first()).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0)
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('main a[href], main button, nav a[href], summary')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const r = el.getBoundingClientRect()
            return {
              name: (el.textContent ?? '').trim().slice(0, 28),
              w: Math.round(r.width),
              h: Math.round(r.height),
            }
          })
          .filter((el) => el.w < 43.5 || el.h < 43.5),
      )
      expect(small).toEqual([])
    })
  }
})
