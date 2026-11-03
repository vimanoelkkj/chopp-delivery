import { expect, type Page, type Route, test } from '@playwright/test'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

const user = { id: 'owner-id', username: 'owner' }
const REV1 = 'c1_12345678-1234-4123-8123-123456789012'
const REV2 = 'c2_22222222-1234-4123-8123-123456789012'

const noneBody = { schema: null, draft: { revision: REV1, document: null }, published: null }
const v1Body = {
  schema: 1,
  draft: { revision: REV1, document: { schemaVersion: 1 } },
  published: null,
}
const v2Body = { schema: 2, draft: { revision: REV2, document: previewFixture() }, published: null }

const doc = previewFixture()
const previewBody = {
  preview: {
    from: { versionId: 'version_12345678-1234-4123-8123-123456789012', revision: REV1 },
    document: doc,
    mapping: doc.modules.map((m) => ({
      from: { id: m.id, template: m.template === 'carousel' ? 'barrels' : m.template },
      to: { id: m.id, template: m.template },
    })),
    losses: [],
    warnings: ['CAROUSEL_EMPTY'],
  },
}
const receipt = (action: string, operationId: string) => ({
  command: {
    operationId,
    action,
    expectedRevision: REV1,
    revision: REV2,
    versionId: 'version_22222222-1234-4123-8123-123456789012',
  },
  site: { schema: 2, draft: { revision: REV2, document: doc }, published: null },
})

type Body = {
  action: string
  expectedRevision: string
  operationId: string
  acknowledge?: string[]
  document?: { schemaVersion: number; modules: unknown[] }
}
type Post = { action: string; operationId: string; headers: Record<string, string>; body: Body }
type Handler = (route: Route, post: Post) => Promise<void> | void

/** Sessão simulada. Registra cada POST em /convert e cada GET de recibo; nada vai ao servidor real. */
async function open(
  page: Page,
  site: unknown,
  onPost: Handler,
  onReceipt: (route: Route) => Promise<void> | void = (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'CMS_COMMAND_NOT_FOUND' } } }),
) {
  const posts: Post[] = []
  const receipts: string[] = []
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.route('**/api/admin/site/commands/**', (route) => {
    receipts.push(route.request().url())
    return onReceipt(route)
  })
  await page.route('**/api/admin/site/convert', async (route) => {
    const body = route.request().postDataJSON()
    const post: Post = {
      action: body.action,
      operationId: body.operationId,
      headers: route.request().headers(),
      body,
    }
    posts.push(post)
    await onPost(route, post)
  })
  await page.route('**/api/admin/site', (route) => route.fulfill({ status: 200, json: site }))
  await page.goto('/admin#pagina-inicial')
  return { posts, receipts }
}

const ok: Handler = (route, post) =>
  route.fulfill({
    status: 200,
    json:
      post.action === 'previewConversion' ? previewBody : receipt(post.action, post.operationId),
  })
const writes = (posts: Post[]) => posts.filter((post) => post.action !== 'previewConversion')

const startButton = (page: Page) => page.getByRole('button', { name: /Iniciar documento/ })
const confirmStart = (page: Page) => page.getByRole('button', { name: 'Criar documento' })

test.describe('E6.0: sem documento', () => {
  test('abrir e cancelar não grava nada', async ({ page }) => {
    const { posts } = await open(page, noneBody, ok)
    await expect(startButton(page)).toBeVisible()
    await startButton(page).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(posts).toEqual([])
  })

  test('confirmar envia exatamente um startV2 com If-Match, operationId e o documento inicial', async ({
    page,
  }) => {
    const { posts } = await open(page, noneBody, (route, post) => {
      const result = receipt(post.action, post.operationId)
      result.site.draft.document = post.body.document as typeof doc
      return route.fulfill({ status: 200, json: result })
    })
    await startButton(page).click()
    await confirmStart(page).click()
    await expect(
      page.getByText('Documento da página inicial criado. Nada foi publicado.'),
    ).toBeVisible()
    expect(posts).toHaveLength(1)
    const [post] = posts
    expect(post.action).toBe('startV2')
    expect(post.headers['if-match']).toBe(`"${REV1}"`)
    expect(post.body.expectedRevision).toBe(REV1)
    expect(post.body.operationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(post.body.document?.schemaVersion).toBe(2)
    expect(post.body.document?.modules).toHaveLength(9)
    await expect(page.getByText('Rascunho incompleto', { exact: true })).toBeVisible()
    await expect(page.getByText('A vitrine ainda não tem barris selecionados.')).toBeVisible()
    await expect(page.getByText('O WhatsApp do documento ainda não foi configurado.')).toBeVisible()
    // depois de criar, a tela é a de leitura e não oferece mais iniciar nem converter
    await expect(startButton(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /converter/i })).toHaveCount(0)
  })

  test('clique duplo em confirmar produz uma única requisição', async ({ page }) => {
    const { posts } = await open(page, noneBody, async (route, post) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      await ok(route, post)
    })
    await startButton(page).click()
    await confirmStart(page).dblclick()
    await expect(page.getByText(/Documento da página inicial criado/)).toBeVisible()
    expect(writes(posts)).toHaveLength(1)
  })

  test('conflito de revisão (409): explica, não repete e não grava', async ({ page }) => {
    const { posts } = await open(page, noneBody, (route) =>
      route.fulfill({ status: 409, json: { error: { code: 'CMS_REVISION_CONFLICT' } } }),
    )
    await startButton(page).click()
    await confirmStart(page).click()
    await expect(page.getByRole('alert')).toContainText('O documento mudou')
    await expect(page.getByRole('alert')).toContainText('Nada foi gravado')
    await expect(page.getByRole('button', { name: 'Atualizar' }).first()).toBeVisible()
    await page.waitForTimeout(500)
    expect(posts).toHaveLength(1)
  })

  test('resposta perdida com recibo no servidor: verifica e mostra o documento sem reenviar', async ({
    page,
  }) => {
    let operationId = ''
    const { posts, receipts } = await open(
      page,
      noneBody,
      (route, post) => {
        operationId = post.operationId
        return route.abort('failed')
      },
      (route) => route.fulfill({ status: 200, json: receipt('startV2', operationId) }),
    )
    await startButton(page).click()
    await confirmStart(page).click()
    await expect(page.getByText(/Documento da página inicial criado/)).toBeVisible()
    expect(posts).toHaveLength(1)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toContain(`/api/admin/site/commands/${operationId}`)
  })

  test('recibo 404 mantém a incerteza e reconcilia uma conclusão tardia sem reenviar', async ({
    page,
  }) => {
    let committed = false
    let operationId = ''
    let document = doc
    const { posts, receipts } = await open(
      page,
      noneBody,
      (route, post) => {
        operationId = post.operationId
        document = post.body.document as typeof doc
        return route.abort('failed')
      },
      (route) =>
        committed
          ? route.fulfill({
              status: 200,
              json: {
                ...receipt('startV2', operationId),
                site: {
                  schema: 2,
                  draft: { revision: REV2, document },
                  published: null,
                },
              },
            })
          : route.fulfill({ status: 404, json: { error: { code: 'CMS_COMMAND_NOT_FOUND' } } }),
    )
    await startButton(page).click()
    await confirmStart(page).click()
    await expect(page.getByRole('alert')).toContainText('Não conseguimos confirmar o resultado')
    await expect(page.getByRole('alert')).not.toContainText('Nada foi gravado')
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0)
    await expect(startButton(page)).toBeDisabled()
    await page.getByRole('button', { name: 'Verificar agora' }).click()
    await expect.poll(() => receipts.length).toBe(2)
    await expect(page.getByRole('button', { name: 'Verificar agora' })).toBeVisible()
    expect(posts).toHaveLength(1)
    committed = true
    await page.getByRole('button', { name: 'Verificar agora' }).click()
    await expect(page.getByText('Rascunho incompleto', { exact: true })).toBeVisible()
    expect(posts).toHaveLength(1)
    expect(receipts).toHaveLength(3)
    expect(receipts.every((url) => url.endsWith(`/commands/${operationId}`))).toBe(true)
  })

  test('sessão expirada (401) ao confirmar volta ao login', async ({ page }) => {
    await open(page, noneBody, (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
    )
    await startButton(page).click()
    await confirmStart(page).click()
    await expect(page.getByLabel('Usuário')).toBeVisible()
  })

  test('CMS v2 indisponível (503 CMS_SCHEMA_UNAVAILABLE): nada gravado e nova tentativa manual', async ({
    page,
  }) => {
    let unavailable = true
    const { posts } = await open(page, noneBody, (route, post) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: { code: 'CMS_SCHEMA_UNAVAILABLE' } } })
        : ok(route, post),
    )
    await startButton(page).click()
    await confirmStart(page).click()
    await expect(page.getByRole('alert')).toContainText('ainda não está disponível')
    await expect(page.getByRole('alert')).toContainText('Nada foi gravado')
    expect(posts).toHaveLength(1)
    unavailable = false
    await page.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(page.getByText(/Documento da página inicial criado/)).toBeVisible()
    expect(posts).toHaveLength(2)
    expect(posts[1].operationId).toBe(posts[0].operationId)
    expect(posts[1].body).toEqual(posts[0].body)
  })

  test('teclado: Esc fecha o diálogo, o foco volta ao botão e Cancelar é o foco inicial', async ({
    page,
  }) => {
    const { posts } = await open(page, noneBody, ok)
    await startButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(startButton(page)).toBeFocused()
    expect(posts).toEqual([])
  })
})

test.describe('E6.0: rascunho v1', () => {
  const convertButton = (page: Page) => page.getByRole('button', { name: /Converter para v2/ })

  test('abrir pede só a prévia (nenhum comando de escrita) e mostra consequências', async ({
    page,
  }) => {
    const { posts } = await open(page, v1Body, ok)
    await expect(page.getByText('O que acontece na conversão')).toBeVisible()
    await expect(page.getByText('Avisos da conversão')).toBeVisible()
    await expect(page.getByText('Nenhuma perda de conteúdo foi detectada.')).toBeVisible()
    await expect(convertButton(page)).toBeVisible()
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.every((post) => post.action === 'previewConversion')).toBe(true)
    expect(posts.every((post) => !('document' in post.body))).toBe(true)
  })

  test('a conversão exige a confirmação específica e envia só os reconhecimentos', async ({
    page,
  }) => {
    const { posts } = await open(page, v1Body, ok)
    await convertButton(page).click()
    const confirm = page.getByRole('button', { name: 'Converter agora' })
    await expect(confirm).toBeDisabled()
    expect(writes(posts)).toEqual([])
    await page.getByLabel('Entendo que a conversão é definitiva.').check()
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(
      page.getByText('Documento convertido para o v2. Nada foi publicado.'),
    ).toBeVisible()
    const sent = writes(posts)
    expect(sent).toHaveLength(1)
    expect(sent[0].action).toBe('convertToV2')
    expect(sent[0].headers['if-match']).toBe(`"${REV1}"`)
    expect('document' in sent[0].body).toBe(false)
    expect(sent[0].body.acknowledge).toEqual([])
  })

  test('cancelar a confirmação não converte', async ({ page }) => {
    const { posts } = await open(page, v1Body, ok)
    await convertButton(page).click()
    await page.getByRole('button', { name: 'Cancelar' }).click()
    expect(writes(posts)).toEqual([])
    await expect(convertButton(page)).toBeVisible()
  })

  test('conflito na conversão (409): nada gravado e sem reenvio', async ({ page }) => {
    const { posts } = await open(page, v1Body, (route, post) =>
      post.action === 'previewConversion'
        ? ok(route, post)
        : route.fulfill({ status: 409, json: { error: { code: 'CMS_REVISION_CONFLICT' } } }),
    )
    await convertButton(page).click()
    await page.getByLabel('Entendo que a conversão é definitiva.').check()
    await page.getByRole('button', { name: 'Converter agora' }).click()
    await expect(page.getByRole('alert')).toContainText('O documento mudou')
    await page.waitForTimeout(500)
    expect(writes(posts)).toHaveLength(1)
  })

  test('operação reutilizada com outros dados (409 CMS_OPERATION_CONFLICT) é recusada sem gravar', async ({
    page,
  }) => {
    const { posts } = await open(page, v1Body, (route, post) =>
      post.action === 'previewConversion'
        ? ok(route, post)
        : route.fulfill({ status: 409, json: { error: { code: 'CMS_OPERATION_CONFLICT' } } }),
    )
    await convertButton(page).click()
    await page.getByLabel('Entendo que a conversão é definitiva.').check()
    await page.getByRole('button', { name: 'Converter agora' }).click()
    await expect(page.getByRole('alert')).toContainText('Operação recusada')
    expect(writes(posts)).toHaveLength(1)
  })

  test('falha ao gerar a prévia: não oferece converter', async ({ page }) => {
    await open(page, v1Body, (route) =>
      route.fulfill({ status: 500, json: { error: { code: 'INTERNAL' } } }),
    )
    await expect(page.getByRole('alert')).toContainText('Não foi possível gerar a prévia')
    await expect(convertButton(page)).toHaveCount(0)
  })
})

test('documento v2 existente: não oferece iniciar nem converter e não envia comandos', async ({
  page,
}) => {
  const { posts } = await open(page, v2Body, ok)
  await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Seções da página inicial' })).toBeVisible()
  await expect(startButton(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /converter/i })).toHaveCount(0)
  expect(posts).toEqual([])
})

test.describe('E6.0: layout responsivo', () => {
  for (const width of [390, 768, 1440]) {
    test(`${width}px: sem rolagem horizontal e alvos de toque de 44px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, noneBody, ok)
      await expect(startButton(page)).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      const box = await startButton(page).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      await startButton(page).click()
      for (const name of ['Cancelar', 'Criar documento']) {
        const dialogBox = await page.getByRole('button', { name }).boundingBox()
        expect(dialogBox?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(width)
      }
    })
  }
})
