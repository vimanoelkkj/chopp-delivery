import { expect, type Locator, type Page, type Route, test } from '@playwright/test'
import sharp from 'sharp'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

/**
 * M2B: biblioteca visual de imagens no editor da "Página inicial".
 * Servidor simulado de rascunho e de mídia; nada vai a um servidor real. Cada teste decide como o
 * servidor de mídia responde, para provar estados, falhas e recuperação sem reenvio automático.
 */

const user = { id: 'owner-id', username: 'owner' }
const rev = (n: number) => `c2_${String(n).padStart(8, '0')}-1234-4123-8123-123456789012`
const mid = (n: number) => `media_${String(n).padStart(8, '0')}-1234-4123-8123-123456789012`
const short = (n: number) => String(n).padStart(8, '0')
const opId = (n: number) => `${String(n).padStart(8, '0')}-1234-4123-8123-123456789abc`

type Doc = ReturnType<typeof previewFixture>
type Put = { operationId: string; expectedRevision: string; body: { document: Doc } }
type Item = {
  id: string
  state: 'ready' | 'processing' | 'rejected' | 'deleted' | 'quarantined' | 'deleting'
  color: 'terracotta' | 'sage' | 'blue'
  /** Como a entrega do arquivo se comporta (a listagem não prova nada). */
  delivery?: 'ok' | 'fail'
  image?: Buffer
}
type Post = {
  operationId: string
  contentType: string
  ifNoneMatch: string | undefined
  body: Buffer
}
type Media = {
  items: Item[]
  consumed: number
  posts: Post[]
  asked: string[]
  deliveries: string[]
  lists: string[]
}
type MediaOptions = {
  items?: Item[]
  consumed?: number
  list?: (route: Route, media: Media) => Promise<void> | void
  upload?: (route: Route, post: Post, media: Media) => Promise<void> | void
  receipt?: (route: Route, operationId: string, media: Media) => Promise<void> | void
}
type Server = { revision: string; document: Doc; puts: Put[] }

const COLORS = { terracotta: '#c8693f', sage: '#9db89a', blue: '#8fb3cf' } as const
const images = {} as Record<keyof typeof COLORS, Buffer>
let upload: Buffer
test.beforeAll(async () => {
  for (const [name, background] of Object.entries(COLORS))
    images[name as keyof typeof COLORS] = await sharp({
      create: { width: 640, height: 480, channels: 3, background },
    })
      .png()
      .toBuffer()
  upload = images.terracotta
})

const readyItem = (n: number, color: Item['color'] = 'sage'): Item => ({
  id: mid(n),
  state: 'ready',
  color,
})
const library = (count: number): Item[] =>
  Array.from({ length: count }, (_, i) =>
    readyItem(count - i, (['sage', 'blue', 'terracotta'] as const)[i % 3]),
  )

const listJson = (media: Media, limit: number, cursor: string | null) => {
  const start = cursor ? Number(cursor.split(':')[0]) : 0
  const page = media.items.slice(start, start + limit)
  const more = start + limit < media.items.length
  return {
    media: page.map((item) => ({
      id: item.id,
      state: item.state,
      revision: opId(1),
      profiles: item.state === 'ready' ? ['hero', 'section'] : [],
      integrity: item.state === 'ready' ? 'not_checked' : 'unavailable',
    })),
    nextCursor: more ? `${start + limit}:${page[page.length - 1].id}` : null,
    capacity: {
      limit: 100,
      consumed: media.consumed,
      remaining: Math.max(0, 100 - media.consumed),
      includesTombstones: true,
    },
  }
}
const receiptJson = (operationId: string, status = 'done') => ({
  media: {
    id: `media_${operationId}`,
    state: status === 'done' ? 'ready' : 'rejected',
    revision: operationId,
    profiles: status === 'done' ? ['hero', 'section'] : [],
  },
  operation: { id: operationId, status },
})
const acceptUpload = (route: Route, post: Post, media: Media) => {
  media.items.unshift({ id: `media_${post.operationId}`, state: 'ready', color: 'terracotta' })
  media.consumed++
  return route.fulfill({ status: 200, json: receiptJson(post.operationId) })
}
const error = (status: number, code: string) => ({ status, json: { error: { code } } })

async function openEditor(
  page: Page,
  options: { media?: MediaOptions; document?: Doc; unsupported?: boolean } = {},
) {
  const server: Server = {
    revision: rev(1),
    document: options.document ?? previewFixture(),
    puts: [],
  }
  const media: Media = {
    items: options.media?.items ?? library(3),
    consumed: options.media?.consumed ?? (options.media?.items ?? library(3)).length,
    posts: [],
    asked: [],
    deliveries: [],
    lists: [],
  }
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 200, json: { authenticated: true, user } }),
  )
  await page.route('**/api/admin/site/commands/**', (route) =>
    route.fulfill(error(404, 'CMS_COMMAND_NOT_FOUND')),
  )
  await page.route('**/api/admin/site/draft', async (route) => {
    const body = route.request().postDataJSON()
    server.puts.push({
      operationId: body.operationId,
      expectedRevision: body.expectedRevision,
      body,
    })
    if (body.expectedRevision !== server.revision)
      return route.fulfill(error(409, 'CMS_REVISION_CONFLICT'))
    server.document = body.document
    server.revision = rev(Number(server.revision.slice(3, 11)) + 1)
    return route.fulfill({
      status: 200,
      json: {
        command: {
          operationId: body.operationId,
          action: 'saveDraft',
          expectedRevision: body.expectedRevision,
          revision: server.revision,
          versionId: 'version_22222222-1234-4123-8123-123456789012',
        },
        site: {
          schema: 2,
          draft: { revision: server.revision, document: server.document },
          published: null,
        },
      },
    })
  })
  await page.route('**/api/admin/site', (route) =>
    route.fulfill({
      status: 200,
      json: {
        schema: 2,
        draft: { revision: server.revision, document: server.document },
        published: null,
      },
    }),
  )
  await page.route(
    (url) => url.pathname.startsWith('/api/admin/media'),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const parts = url.pathname.split('/').filter(Boolean) // api admin media ...
      if (options.unsupported) return route.fulfill(error(404, 'NOT_FOUND'))
      if (parts.length === 3 && request.method() === 'GET') {
        media.lists.push(url.search)
        if (options.media?.list) return options.media.list(route, media)
        return route.fulfill({
          status: 200,
          json: listJson(
            media,
            Number(url.searchParams.get('limit')),
            url.searchParams.get('cursor'),
          ),
        })
      }
      if (parts.length === 3 && request.method() === 'POST') {
        const headers = request.headers()
        const post: Post = {
          operationId: headers['x-operation-id'],
          contentType: headers['content-type'],
          ifNoneMatch: headers['if-none-match'],
          body: request.postDataBuffer() ?? Buffer.alloc(0),
        }
        media.posts.push(post)
        return (options.media?.upload ?? acceptUpload)(route, post, media)
      }
      if (parts[3] === 'commands') {
        media.asked.push(parts[4])
        if (options.media?.receipt) return options.media.receipt(route, parts[4], media)
        return route.fulfill({
          ...error(404, 'MEDIA_OPERATION_NOT_FOUND'),
          json: { error: { code: 'MEDIA_OPERATION_NOT_FOUND' }, outcome: 'unknown' },
        })
      }
      // entrega: /api/admin/media/:id/:profile
      const item = media.items.find((candidate) => candidate.id === parts[3])
      media.deliveries.push(url.pathname)
      if (item?.state !== 'ready') return route.fulfill(error(404, 'MEDIA_NOT_AVAILABLE'))
      if (item.delivery === 'fail') return route.fulfill(error(503, 'MEDIA_UNAVAILABLE'))
      return route.fulfill({
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        contentType: 'image/png',
        body: item.image ?? images[item.color],
      })
    },
  )
  await page.goto('/admin#pagina-inicial')
  await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Seções da página inicial' })).toBeVisible()
  return { server, media }
}

const section = (page: Page, name: RegExp | string) =>
  page.getByRole('navigation', { name: 'Seções da página inicial' }).getByRole('button', { name })
const saveButton = (page: Page) =>
  page.getByRole('button', { name: /^(Salvar rascunho|Salvando…)$/ })
const saved = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Rascunho salvo. Nada foi publicado.' })
const picker = (page: Page) => page.getByRole('dialog', { name: 'Escolher imagem' })
const tile = (page: Page, n: number) =>
  picker(page).getByRole('radio', { name: new RegExp(`Imagem ${short(n)}`) })
const alt = (page: Page) => page.getByRole('textbox', { name: 'Texto alternativo da imagem' })
const choose = (page: Page) => page.getByRole('button', { name: /^(Escolher|Trocar) imagem$/ })
const pickFile = (page: Page) => picker(page).locator('input[type="file"]')
const confirmPick = (page: Page) => picker(page).getByRole('button', { name: 'Usar esta imagem' })
const feedback = (page: Page, text: string | RegExp) =>
  picker(page).locator('[role="status"], [role="alert"]').filter({ hasText: text })
const png = (name = 'foto.png', buffer = upload) => ({ name, mimeType: 'image/png', buffer })

async function openPicker(page: Page) {
  await choose(page).click()
  await expect(picker(page)).toBeVisible()
}
async function associate(page: Page, n: number) {
  await openPicker(page)
  await expect(tile(page, n)).toBeEnabled()
  await tile(page, n).check()
  await confirmPick(page).click()
  await expect(picker(page)).toBeHidden()
}

for (const width of [390, 1440]) {
  test(`3C: Hero e Sobre associam, trocam e desassociam sem publicar; enquadramento real em ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const wide = await sharp({
      create: { width: 1600, height: 400, channels: 3, background: '#c8693f' },
    })
      .png()
      .toBuffer()
    const portrait = await sharp({
      create: { width: 400, height: 1600, channels: 3, background: '#8fb3cf' },
    })
      .png()
      .toBuffer()
    const writes: string[] = []
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()))
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    })
    const { server, media } = await openEditor(page, {
      media: {
        items: [
          { ...readyItem(1), image: wide },
          { ...readyItem(2, 'blue'), image: portrait },
          readyItem(3),
        ],
      },
    })
    await associate(page, 1)
    const slot = page.locator('[data-media-slot]')
    await expect(slot.locator('[data-media-fit="contain"]')).toHaveAttribute(
      'data-media-cropped',
      'false',
    )
    await alt(page).fill('Hero de teste')
    expect(server.puts).toHaveLength(0)
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    await section(page, /História editorial/).click()
    await associate(page, 3)
    await expect(slot.locator('[data-media-fit="cover"]')).toHaveAttribute(
      'data-media-cropped',
      'false',
    )
    await alt(page).fill('Sobre de teste')
    await associate(page, 2)
    await expect(alt(page)).toHaveValue('Sobre de teste')
    await expect(slot.locator('[data-media-fit="cover"]')).toHaveAttribute(
      'data-media-cropped',
      'true',
    )
    await expect(slot.getByText('Recorte central neste enquadramento')).toBeVisible()
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    await page.getByRole('button', { name: 'Remover imagem', exact: true }).click()
    await expect(slot.locator('img')).toHaveCount(0)
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    const about = server.document.modules.find((module) => module.template === 'about')
    if (about?.template !== 'about') throw Error('Missing fixture about')
    expect(about.content.media).toBeNull()
    await associate(page, 2)
    await alt(page).fill('Sobre de teste')
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    expect(server.puts.map((put) => put.expectedRevision)).toEqual([rev(1), rev(2), rev(3), rev(4)])
    await page.goto('/admin/preview/frame')
    const heroFrame = page.locator(
      'section[aria-labelledby="hero-title"] [data-media-fit="contain"]',
    )
    const aboutFrame = page.locator('#sobre [data-media-fit="cover"]')
    await expect(heroFrame).toHaveAttribute('data-media-state', 'ready')
    await expect(heroFrame).toHaveAttribute('data-media-cropped', 'false')
    await aboutFrame.scrollIntoViewIfNeeded()
    await expect(aboutFrame).toHaveAttribute('data-media-state', 'ready')
    await expect(aboutFrame).toHaveAttribute('data-media-cropped', 'true')
    await expect(aboutFrame.locator('img')).toHaveCSS('object-fit', 'cover')
    await expect(heroFrame.locator('img')).toHaveCSS('object-fit', 'contain')
    for (const frame of [heroFrame, aboutFrame]) {
      const boxes = await frame.evaluate((node) => {
        const image = node.querySelector('img')?.getBoundingClientRect()
        const parent = node.parentElement?.getBoundingClientRect()
        return {
          image: image && { w: image.width, h: image.height },
          parent: parent && { w: parent.width, h: parent.height },
        }
      })
      expect(boxes.image).toEqual(boxes.parent)
    }
    await heroFrame.screenshot({ path: testInfo.outputPath('hero-contain.png') })
    await aboutFrame.screenshot({ path: testInfo.outputPath('sobre-cover.png') })
    expect(media.posts).toHaveLength(0)
    expect(writes.every((path) => path === 'PUT /api/admin/site/draft')).toBe(true)
    expect(await page.locator('img[src^="/api/site/media/"]').count()).toBe(0)
  })
}

test.describe('M2B: biblioteca (estados)', () => {
  test('mostra miniaturas reais, cota consumida/restante e a regra de formato e tamanho', async ({
    page,
  }) => {
    const { media } = await openEditor(page, { media: { items: library(7), consumed: 7 } })
    await openPicker(page)
    const dialog = picker(page)
    await expect(
      dialog.getByText('7 de 100 registros usados', { exact: true }).first(),
    ).toBeVisible()
    await expect(dialog.getByText('93 envios restantes')).toBeVisible()
    const meter = dialog.getByRole('progressbar', { name: '7 de 100 registros usados' })
    await expect(meter).toHaveAttribute('value', '7')
    await expect(meter).toHaveAttribute('max', '100')
    await expect(dialog.getByText(/Cota vitalícia/)).toBeVisible()
    await expect(dialog.getByText(/PNG, JPEG ou WebP, até 5 MB/)).toBeVisible()
    await expect(dialog.getByText(/mesmo se for recusado/)).toBeVisible()
    // cada miniatura é uma imagem entregue de verdade, não um desenho
    await expect(dialog.getByRole('radio')).toHaveCount(7)
    await expect(dialog.getByText('Pronta', { exact: true })).toHaveCount(7)
    await expect.poll(() => dialog.locator('img[data-media-state="ready"]').count()).toBe(7)
    expect(
      media.deliveries.every((url) => /\/api\/admin\/media\/media_[^/]+\/section$/.test(url)),
    ).toBe(true)
    expect(media.lists[0]).toContain('limit=12')
  })

  test('carregando, vazia e com erro: cada estado tem seu texto e a ação certa', async ({
    page,
  }) => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let fail = true
    await openEditor(page, {
      media: {
        items: [],
        consumed: 0,
        list: async (route, media) => {
          await gate
          if (fail) return route.fulfill(error(503, 'MEDIA_UNAVAILABLE'))
          return route.fulfill({ status: 200, json: listJson(media, 12, null) })
        },
      },
    })
    await openPicker(page)
    await expect(picker(page).getByText('Carregando a biblioteca…')).toBeVisible()
    release()
    await expect(
      picker(page).getByRole('alert').filter({ hasText: 'Não foi possível carregar a biblioteca' }),
    ).toBeVisible()
    await expect(picker(page).getByText('Nada foi alterado.')).toBeVisible()
    // enquanto a biblioteca não carrega, não se oferece envio
    await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toBeDisabled()
    fail = false
    await picker(page).getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(picker(page).getByText('Ainda não há imagens na biblioteca.')).toBeVisible()
    await expect(picker(page).getByText('0 de 100 registros usados').first()).toBeVisible()
    await expect(confirmPick(page)).toBeDisabled()
  })

  test('ambiente sem biblioteca: explica, não oferece envio e o texto continua editável', async ({
    page,
  }) => {
    await openEditor(page, { unsupported: true })
    await openPicker(page)
    await expect(
      picker(page)
        .getByRole('alert')
        .filter({ hasText: 'A biblioteca de imagens não está disponível aqui' }),
    ).toBeVisible()
    await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toHaveCount(0)
    await expect(picker(page).getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0)
    await picker(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(picker(page)).toBeHidden()
    await page.getByRole('textbox', { name: 'Título' }).fill('Texto continua editável')
    await expect(saveButton(page)).toBeEnabled()
  })

  test('paginação: 12 por página, "Carregar mais" usa o cursor do servidor e não repete imagens', async ({
    page,
  }) => {
    const { media } = await openEditor(page, { media: { items: library(14), consumed: 14 } })
    await openPicker(page)
    await expect(picker(page).getByRole('radio')).toHaveCount(12)
    await picker(page).getByRole('button', { name: 'Carregar mais imagens' }).click()
    await expect(picker(page).getByRole('radio')).toHaveCount(14)
    await expect(picker(page).getByRole('button', { name: 'Carregar mais imagens' })).toHaveCount(0)
    expect(media.lists).toHaveLength(2)
    expect(new URLSearchParams(media.lists[1]).get('cursor')).toMatch(/^12:media_/)
    const names = await picker(page)
      .getByRole('radio')
      .evaluateAll((all) => all.map((radio) => (radio as HTMLInputElement).value))
    expect(new Set(names).size).toBe(14)
  })

  test('só é selecionável o que o servidor entrega: indisponível, processando e recusada ficam bloqueadas', async ({
    page,
  }) => {
    await openEditor(page, {
      media: {
        items: [
          readyItem(1, 'sage'),
          { ...readyItem(2), delivery: 'fail' },
          { ...readyItem(3), state: 'processing' },
          { ...readyItem(4), state: 'rejected' },
          { ...readyItem(5), state: 'deleted' },
        ],
        consumed: 5,
      },
    })
    await openPicker(page)
    await expect(tile(page, 1)).toBeEnabled()
    await expect(tile(page, 2)).toBeDisabled()
    await expect(tile(page, 3)).toBeDisabled()
    await expect(tile(page, 4)).toBeDisabled()
    await expect(tile(page, 5)).toBeDisabled()
    const dialog = picker(page)
    await expect(dialog.getByText('Indisponível', { exact: true })).toHaveCount(1)
    await expect(dialog.getByText('Processando', { exact: true })).toHaveCount(1)
    await expect(dialog.getByText('Recusada', { exact: true })).toHaveCount(1)
    await expect(dialog.getByText('Excluída', { exact: true })).toHaveCount(1)
    await expect(confirmPick(page)).toBeDisabled()
    await tile(page, 1).check()
    await expect(confirmPick(page)).toBeEnabled()
    await expect(dialog.getByText(/Imagem 00000001 escolhida/)).toBeVisible()
  })

  test('atualizar a lista: uma imagem que estava processando passa a poder ser escolhida', async ({
    page,
  }) => {
    const { media } = await openEditor(page, {
      media: { items: [{ ...readyItem(2), state: 'processing' }, readyItem(1)], consumed: 2 },
    })
    await openPicker(page)
    await expect(tile(page, 2)).toBeDisabled()
    await expect(picker(page).getByText('Processando', { exact: true })).toBeVisible()
    media.items[0].state = 'ready'
    await picker(page).getByRole('button', { name: 'Atualizar lista' }).click()
    await expect(tile(page, 2)).toBeEnabled()
    await expect(picker(page).getByText('Processando', { exact: true })).toHaveCount(0)
    expect(media.lists).toHaveLength(2)
  })

  test('teclado: setas trocam a escolha, Esc e Cancelar fecham sem alterar o rascunho', async ({
    page,
  }) => {
    const { server } = await openEditor(page, { media: { items: library(3), consumed: 3 } })
    await openPicker(page)
    await expect(tile(page, 3)).toBeEnabled()
    await tile(page, 3).focus()
    await page.keyboard.press('Space')
    await expect(tile(page, 3)).toBeChecked()
    await page.keyboard.press('ArrowRight')
    await expect(picker(page).getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(tile(page, 3)).not.toBeChecked()
    await page.keyboard.press('Escape')
    await expect(picker(page)).toBeHidden()
    // o foco volta ao botão que abriu a janela e nada mudou
    await expect(choose(page)).toBeFocused()
    await expect(alt(page)).toHaveCount(0)
    expect(server.puts).toEqual([])
    await openPicker(page)
    await picker(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(picker(page)).toBeHidden()
    await expect(page.getByText('Tudo salvo. Nenhuma alteração pendente.')).toBeVisible()
  })
})

test.describe('M2B: associação ao rascunho', () => {
  test('escolher não salva: só "Salvar rascunho" grava {id, alt}, e só na seção escolhida', async ({
    page,
  }) => {
    const { server, media } = await openEditor(page)
    const original = JSON.stringify(server.document)
    await associate(page, 2)
    // a imagem aparece no campo, o foco vai ao texto alternativo e o rascunho está só local
    await expect(alt(page)).toBeFocused()
    await expect(page.locator('[data-media-slot] img[data-media-state="ready"]')).toBeVisible()
    await expect(page.getByText('Alterações não salvas em 1 seção')).toBeVisible()
    await expect(page.getByText(/Sem texto alternativo\. O rascunho aceita/)).toBeVisible()
    expect(server.puts).toEqual([])
    expect(media.posts).toEqual([])
    expect(media.deliveries.some((url) => url.endsWith(`${mid(2)}/hero`))).toBe(true)

    await alt(page).fill('Barril de chopp sobre o balcão')
    await expect(page.getByText(/Sem texto alternativo/)).toHaveCount(0)
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    expect(server.puts).toHaveLength(1)
    const sent = server.puts[0].body.document as Doc
    const before = JSON.parse(original) as Doc
    const hero = sent.modules[0].content as { media: unknown }
    expect(hero.media).toEqual({ id: mid(2), alt: 'Barril de chopp sobre o balcão' })
    // nada mais mudou: ordem, ids, comercial e as demais seções seguem idênticos
    expect(sent.commercial).toEqual(before.commercial)
    expect(sent.modules.slice(1)).toEqual(before.modules.slice(1))
    expect(sent.modules.map((m) => m.id)).toEqual(before.modules.map((m) => m.id))
    expect(server.puts[0].operationId).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('trocar usa outro ID e mantém o texto alternativo para conferência; remover deixa sem imagem', async ({
    page,
  }) => {
    const { server } = await openEditor(page)
    await associate(page, 1)
    await alt(page).fill('Primeiro texto')
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()

    await expect(page.getByRole('button', { name: 'Trocar imagem' })).toBeVisible()
    await page.getByRole('button', { name: 'Trocar imagem' }).click()
    await expect(tile(page, 3)).toBeEnabled()
    await expect(picker(page).getByText('Em uso nesta página')).toHaveCount(1)
    await tile(page, 3).check()
    await confirmPick(page).click()
    await expect(alt(page)).toHaveValue('Primeiro texto')
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    expect((server.document.modules[0].content as { media: unknown }).media).toEqual({
      id: mid(3),
      alt: 'Primeiro texto',
    })
    // a imagem antiga continua na biblioteca, intacta: nada a apagou nem a sobrescreveu
    const hero = (id: number) => `${mid(id)}/hero`
    await expect(page.locator('[data-media-slot] img').first()).toHaveAttribute(
      'src',
      new RegExp(hero(3)),
    )

    await page.getByRole('button', { name: 'Remover imagem' }).click()
    await expect(page.getByRole('button', { name: 'Escolher imagem' })).toBeFocused()
    await expect(alt(page)).toHaveCount(0)
    await saveButton(page).click()
    await expect(saved(page)).toBeVisible()
    expect((server.document.modules[0].content as { media: unknown }).media).toBeNull()
  })

  test('texto alternativo: contador, limite de 200 e links/símbolos recusados com explicação', async ({
    page,
  }) => {
    const { server } = await openEditor(page)
    await associate(page, 1)
    const field = alt(page)
    await expect(page.locator('[data-media-slot]').getByTestId('char-count')).toContainText(
      'de 200',
    )
    await field.fill('a'.repeat(201))
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert').filter({ hasText: 'Sobra 1 caractere' })).toBeVisible()
    await expect(saveButton(page)).toBeDisabled()
    await field.fill('veja https://exemplo.com')
    await expect(
      page.getByText('Não coloque endereços de site ou links neste campo.'),
    ).toBeVisible()
    await field.fill('oi <b>')
    await expect(page.getByText('Não use os símbolos < e >.')).toBeVisible()
    await field.fill('a'.repeat(200))
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await expect(saveButton(page)).toBeEnabled()
    expect(server.puts).toEqual([])
  })

  test('Sobre e Destaque aceitam imagem; a vitrine só preserva a dela, sem botão para trocar', async ({
    page,
  }) => {
    const document = previewFixture()
    const carousel = document.modules.find((m) => m.template === 'carousel')
    if (carousel?.template !== 'carousel') throw new Error('fixture')
    carousel.content.media = { id: mid(2), alt: 'Capa da vitrine' }
    carousel.content.entries = [{ itemId: 'dronken', media: { id: mid(1), alt: 'Barril' } }]
    await openEditor(page, { document })
    await section(page, /História editorial/).click()
    await expect(choose(page)).toBeVisible()
    await section(page, /Destaque editorial/).click()
    await expect(choose(page)).toBeVisible()
    await section(page, /Barris do catálogo/).click()
    await expect(choose(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Trocar imagem|Remover imagem/ })).toHaveCount(0)
    await expect(page.getByText(/função visual desta imagem ainda não está definida/)).toBeVisible()
    await expect(page.getByText(/acompanham as entradas da vitrine/)).toBeVisible()
    // catálogo, perguntas e contato não têm imagem
    for (const name of [/Catálogo ao vivo/, /Perguntas do rascunho/, /Contato do rascunho/]) {
      await section(page, name).click()
      await expect(choose(page)).toHaveCount(0)
    }
  })

  test('a abertura sem imagem avisa que a publicação exigirá uma, mas o rascunho salva', async ({
    page,
  }) => {
    await openEditor(page)
    await expect(
      page.getByText(/A abertura precisará de uma imagem para ser publicada/),
    ).toBeVisible()
    await expect(page.getByText(/A página usa a imagem padrão/)).toBeVisible()
  })
})

test.describe('M2B: envio', () => {
  test('envia PNG com tipo, operação e If-None-Match corretos, seleciona o resultado e não salva o rascunho', async ({
    page,
  }) => {
    const { server, media } = await openEditor(page, { media: { items: library(2), consumed: 2 } })
    await openPicker(page)
    await pickFile(page).setInputFiles(png('minha foto.png'))
    await expect(feedback(page, /Imagem [0-9a-f]{8} enviada/)).toBeVisible()
    expect(media.posts).toHaveLength(1)
    const [post] = media.posts
    expect(post.contentType).toBe('image/png')
    expect(post.ifNoneMatch).toBe('*')
    expect(post.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(post.body.equals(upload)).toBe(true)
    // a cota sobe, a imagem nova aparece primeiro, já escolhida, e continua sem salvar
    await expect(picker(page).getByText('3 de 100 registros usados').first()).toBeVisible()
    const fresh = picker(page).getByRole('radio', {
      name: new RegExp(`Imagem ${post.operationId.slice(0, 8)}`),
    })
    await expect(fresh).toBeChecked()
    await expect(fresh).toBeEnabled()
    await expect(picker(page).getByText(/Nada foi salvo no rascunho ainda/)).toBeVisible()
    expect(server.puts).toEqual([])
    await confirmPick(page).click()
    await expect(page.getByText('Alterações não salvas em 1 seção')).toBeVisible()
    expect(server.puts).toEqual([])
  })

  test('ao reabrir a janela, o resultado do envio anterior e a seleção não sobram', async ({
    page,
  }) => {
    await openEditor(page, { media: { items: library(2), consumed: 2 } })
    await openPicker(page)
    await pickFile(page).setInputFiles(png())
    await expect(feedback(page, /Imagem [0-9a-f]{8} enviada/)).toBeVisible()
    await picker(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(picker(page)).toBeHidden()
    await openPicker(page)
    await expect(picker(page).getByRole('radio')).toHaveCount(3)
    await expect(feedback(page, /enviada/)).toHaveCount(0)
    await expect(picker(page).getByRole('radio', { checked: true })).toHaveCount(0)
    await expect(confirmPick(page)).toBeDisabled()
  })

  test('arquivos inválidos são recusados no navegador: nada é enviado e a cota não é usada', async ({
    page,
  }) => {
    const { media } = await openEditor(page)
    await openPicker(page)
    const refused = async (file: Parameters<Locator['setInputFiles']>[0], text: RegExp) => {
      await pickFile(page).setInputFiles(file)
      await expect(
        picker(page).getByRole('alert').filter({ hasText: 'Esta imagem não foi enviada' }),
      ).toContainText(text)
      await expect(picker(page).getByRole('alert')).toContainText(
        'nenhum registro da cota foi usado',
      )
    }
    await refused(
      { name: 'a.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a......') },
      /Use PNG, JPEG ou WebP/,
    )
    await refused(
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('isto não é uma imagem') },
      /conteúdo do arquivo/,
    )
    await refused({ name: 'vazio.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, /vazio/)
    const big = Buffer.concat([upload.subarray(0, 8), Buffer.alloc(5 * 1024 * 1024)])
    await refused({ name: 'grande.png', mimeType: 'image/png', buffer: big }, /limite é 5 MB/)
    const wide = await sharp({
      create: { width: 6001, height: 8, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer()
    await refused({ name: 'larga.png', mimeType: 'image/png', buffer: wide }, /6001 × 8 px/)
    expect(media.posts).toEqual([])
    await expect(picker(page).getByText('3 de 100 registros usados').first()).toBeVisible()
  })

  const refusals: [number, string, string][] = [
    [400, 'MEDIA_INVALID', 'O servidor recusou a imagem'],
    [413, 'MEDIA_BYTES', 'Imagem grande demais'],
    [429, 'MEDIA_QUOTA', 'A cota de imagens acabou'],
    [409, 'MEDIA_BUSY_OR_CONFLICT', 'Outro envio está em andamento'],
  ]
  for (const [status, code, title] of refusals)
    test(`recusa ${status} do servidor: "${title}", sem recibo, sem reenvio automático`, async ({
      page,
    }) => {
      const { media } = await openEditor(page, {
        media: { upload: (route) => route.fulfill(error(status, code)) },
      })
      await openPicker(page)
      await pickFile(page).setInputFiles(png())
      await expect(picker(page).getByRole('alert').filter({ hasText: title })).toBeVisible()
      await page.waitForTimeout(400)
      expect(media.posts).toHaveLength(1)
      expect(media.asked).toEqual([])
      // um novo envio é uma nova operação, escolhida pelo administrador
      await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toBeEnabled()
    })

  test('cota esgotada: só dá para escolher imagens já enviadas', async ({ page }) => {
    await openEditor(page, { media: { items: library(2), consumed: 100 } })
    await openPicker(page)
    await expect(picker(page).getByText('Nenhum envio restante')).toBeVisible()
    await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toBeDisabled()
    await expect(picker(page).getByText(/só é possível escolher imagens já enviadas/)).toBeVisible()
    await expect(tile(page, 2)).toBeEnabled()
  })

  test('envio duplo é ignorado, a janela não fecha durante o envio e Cancelar fica desligado', async ({
    page,
  }) => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { media } = await openEditor(page, {
      media: {
        upload: async (route, post, server) => {
          await gate
          return acceptUpload(route, post, server)
        },
      },
    })
    await openPicker(page)
    await pickFile(page).setInputFiles(png('um.png'))
    await expect(feedback(page, /Enviando e processando um\.png/)).toBeVisible()
    await expect(picker(page).getByRole('button', { name: 'Enviando…' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await pickFile(page).setInputFiles(png('dois.png'))
    await page.keyboard.press('Escape')
    await expect(picker(page)).toBeVisible()
    await expect(picker(page).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await expect(confirmPick(page)).toBeDisabled()
    release()
    await expect(feedback(page, /Imagem [0-9a-f]{8} enviada/)).toBeVisible()
    expect(media.posts).toHaveLength(1)
    await picker(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(picker(page)).toBeHidden()
  })
})

test.describe('M2B: respostas inconclusivas e recibos', () => {
  test('404 inconclusivo bloqueia Escolher arquivo e preserva a operação até resolução conclusiva', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = crypto.randomUUID.bind(crypto)
      const generated: string[] = []
      Object.assign(window, { recoveryOperationIds: generated })
      crypto.randomUUID = () => {
        const id = original()
        generated.push(id)
        return id
      }
    })
    let resolved = false
    const { media } = await openEditor(page, {
      media: {
        upload: (route, post, server) => {
          if (server.posts.length === 1) return route.abort('failed')
          if (server.posts.length === 2) return route.fulfill(error(409, 'MEDIA_BUSY'))
          return acceptUpload(route, post, server)
        },
        receipt: (route, operationId, server) =>
          resolved
            ? route.fulfill({ status: 200, json: receiptJson(operationId, 'failed') })
            : server.posts.length > 1
              ? route.fulfill({
                  status: 202,
                  json: {
                    operation: {
                      id: operationId,
                      status: 'running',
                      reconciliationRequired: false,
                    },
                    outcome: 'unknown',
                  },
                })
              : route.fulfill({
                  ...error(404, 'MEDIA_OPERATION_NOT_FOUND'),
                  json: { error: { code: 'MEDIA_OPERATION_NOT_FOUND' }, outcome: 'unknown' },
                }),
      },
    })
    await openPicker(page)
    const ids = () =>
      page.evaluate(
        () => (window as unknown as { recoveryOperationIds: string[] }).recoveryOperationIds,
      )
    const before = (await ids()).length
    await pickFile(page).setInputFiles(png('original.png'))
    const warning = feedback(page, /Não conseguimos confirmar o envio/)
    await expect(warning).toBeVisible()
    const original = media.posts[0]
    expect((await ids()).slice(before)).toEqual([original.operationId])
    await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toBeDisabled()
    await expect(pickFile(page)).toBeDisabled()
    await expect(picker(page).getByRole('button', { name: 'Descartar aviso' })).toHaveCount(0)

    // Bypass the DOM's disabled attribute: the hook itself must refuse any new start.
    await pickFile(page).evaluate((element: HTMLInputElement) => {
      element.disabled = false
    })
    await pickFile(page).setInputFiles(png('outra.png', images.blue))
    await pickFile(page).evaluate((element: HTMLInputElement) => {
      element.disabled = true
    })
    await expect(warning).toBeVisible()
    await picker(page).getByRole('button', { name: 'Verificar agora' }).click()
    await expect.poll(() => media.asked.length).toBe(2)
    expect(media.posts).toHaveLength(1)
    expect((await ids()).slice(before)).toEqual([original.operationId])
    expect(media.asked.every((id) => id === original.operationId)).toBe(true)

    // Existing image selection remains independent; reopening cannot reset the pending upload.
    await tile(page, 3).check()
    await confirmPick(page).click()
    await expect(picker(page)).toBeHidden()
    await choose(page).click()
    await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toBeDisabled()
    await expect(pickFile(page)).toBeDisabled()
    await picker(page).getByRole('button', { name: 'Repetir o mesmo envio' }).click()
    await expect(feedback(page, /ainda mostra este envio em andamento/)).toBeVisible()
    expect(media.posts).toHaveLength(2)
    expect(media.posts[1].operationId).toBe(original.operationId)
    expect(media.posts[1].body.equals(original.body)).toBe(true)
    expect((await ids()).slice(before)).toEqual([original.operationId])
    await expect(pickFile(page)).toBeDisabled()

    resolved = true
    await picker(page).getByRole('button', { name: 'Verificar agora' }).click()
    await expect(feedback(page, /O servidor não conseguiu processar a imagem/)).toBeVisible()
    await expect(pickFile(page)).toBeEnabled()
    await picker(page).getByRole('button', { name: 'Escolher arquivo…' }).click()
    // The native chooser is tested through the same input, with a new explicit user selection.
    await pickFile(page).setInputFiles(png('nova.png', images.blue))
    await expect(feedback(page, /Imagem [0-9a-f]{8} enviada/)).toBeVisible()
    expect(media.posts).toHaveLength(3)
    expect(media.posts[2].operationId).not.toBe(original.operationId)
    expect((await ids()).slice(before)).toEqual([original.operationId, media.posts[2].operationId])
  })

  test('resposta perdida depois de gravar: o recibo confirma, sem segundo envio', async ({
    page,
  }) => {
    const { media } = await openEditor(page, {
      media: {
        upload: async (route, post, server) => {
          server.items.unshift({ id: `media_${post.operationId}`, state: 'ready', color: 'blue' })
          server.consumed++
          await route.abort('failed')
        },
        receipt: (route, operationId) =>
          route.fulfill({ status: 200, json: receiptJson(operationId) }),
      },
    })
    await openPicker(page)
    await pickFile(page).setInputFiles(png('perdida.png'))
    await expect(feedback(page, /Imagem [0-9a-f]{8} enviada/)).toBeVisible()
    expect(media.posts).toHaveLength(1)
    expect(media.asked).toEqual([media.posts[0].operationId])
    await page.waitForTimeout(500)
    expect(media.posts).toHaveLength(1)
    await expect(
      picker(page).getByRole('radio', {
        name: new RegExp(`Imagem ${media.posts[0].operationId.slice(0, 8)}`),
      }),
    ).toBeChecked()
  })

  test('sem recibo (404): consulta primeiro, não reenvia sozinho; repetir usa a MESMA operação e os mesmos bytes', async ({
    page,
  }) => {
    let attempt = 0
    const { media } = await openEditor(page, {
      media: {
        upload: async (route, post, server) => {
          attempt++
          if (attempt === 1) return route.abort('failed')
          return acceptUpload(route, post, server)
        },
      },
    })
    await openPicker(page)
    await pickFile(page).setInputFiles(png('incerta.png'))
    const warning = picker(page)
      .getByRole('alert')
      .filter({ hasText: 'Não conseguimos confirmar o envio' })
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('não prova que o envio falhou')
    await expect(warning).toContainText('não duplica')
    expect(media.asked).toEqual([media.posts[0].operationId])
    // nada é reenviado por conta própria
    await page.waitForTimeout(800)
    expect(media.posts).toHaveLength(1)
    await expect(picker(page).getByRole('button', { name: 'Verificar agora' })).toBeVisible()
    await picker(page).getByRole('button', { name: 'Verificar agora' }).click()
    await expect.poll(() => media.asked.length).toBe(2)
    expect(media.posts).toHaveLength(1)

    await picker(page).getByRole('button', { name: 'Repetir o mesmo envio' }).click()
    await expect(feedback(page, /Imagem [0-9a-f]{8} enviada/)).toBeVisible()
    expect(media.posts).toHaveLength(2)
    expect(media.posts[1].operationId).toBe(media.posts[0].operationId)
    expect(media.posts[1].body.equals(media.posts[0].body)).toBe(true)
  })

  test('operação ainda em andamento: não oferece repetir nem novo envio, só verificar', async ({
    page,
  }) => {
    let phase: 'running' | 'done' = 'running'
    const { media } = await openEditor(page, {
      media: {
        upload: (route) => route.abort('failed'),
        receipt: (route, operationId) =>
          phase === 'running'
            ? route.fulfill({
                status: 202,
                json: {
                  operation: { id: operationId, status: 'running', reconciliationRequired: false },
                  outcome: 'unknown',
                },
              })
            : route.fulfill({ status: 200, json: receiptJson(operationId) }),
      },
    })
    await openPicker(page)
    await pickFile(page).setInputFiles(png())
    const warning = picker(page)
      .getByRole('alert')
      .filter({ hasText: 'Não conseguimos confirmar o envio' })
    await expect(warning).toContainText('ainda mostra este envio em andamento')
    await expect(picker(page).getByRole('button', { name: 'Repetir o mesmo envio' })).toHaveCount(0)
    await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toBeDisabled()
    phase = 'done'
    await picker(page).getByRole('button', { name: 'Verificar agora' }).click()
    await expect(feedback(page, /Imagem [0-9a-f]{8} enviada/)).toBeVisible()
    expect(media.posts).toHaveLength(1)
  })

  test('recibo que registra falha: mostra a falha e o novo envio é outra operação', async ({
    page,
  }) => {
    const { media } = await openEditor(page, {
      media: {
        upload: (route) => route.abort('failed'),
        receipt: (route, operationId) =>
          route.fulfill({ status: 200, json: receiptJson(operationId, 'failed') }),
      },
    })
    await openPicker(page)
    await pickFile(page).setInputFiles(png())
    await expect(
      picker(page)
        .getByRole('alert')
        .filter({ hasText: 'O servidor não conseguiu processar a imagem' }),
    ).toBeVisible()
    await expect(picker(page).getByRole('button', { name: 'Repetir o mesmo envio' })).toHaveCount(0)
    await pickFile(page).setInputFiles(png())
    await expect.poll(() => media.posts.length).toBe(2)
    expect(media.posts[1].operationId).not.toBe(media.posts[0].operationId)
  })

  test('recibo inalcançável: continua incerto e bloqueia novos envios até verificar', async ({
    page,
  }) => {
    const { media } = await openEditor(page, {
      media: {
        upload: (route) => route.abort('failed'),
        receipt: (route) => route.abort('failed'),
      },
    })
    await openPicker(page)
    await pickFile(page).setInputFiles(png())
    const warning = picker(page)
      .getByRole('alert')
      .filter({ hasText: 'Não conseguimos confirmar o envio' })
    await expect(warning).toContainText('recibo também não pôde ser consultado')
    await expect(picker(page).getByRole('button', { name: 'Escolher arquivo…' })).toBeDisabled()
    await expect(picker(page).getByRole('button', { name: 'Repetir o mesmo envio' })).toHaveCount(0)
    expect(media.posts).toHaveLength(1)
  })
})

test.describe('M2B: sessão, conflito e alterações locais', () => {
  test('sessão expirada ao abrir a biblioteca: login e as edições locais voltam', async ({
    page,
  }) => {
    let expired = true
    await openEditor(page, {
      media: {
        list: (route, media) =>
          expired
            ? route.fulfill(error(401, 'UNAUTHENTICATED'))
            : route.fulfill({ status: 200, json: listJson(media, 12, null) }),
      },
    })
    await page.getByRole('textbox', { name: 'Título' }).fill('Escrito antes de cair')
    await choose(page).click()
    await expect(page.getByLabel('Usuário')).toBeVisible()
    expired = false
    await page.getByLabel('Usuário').fill('owner')
    await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByText('Suas alterações foram restauradas depois do login')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Título' })).toHaveValue('Escrito antes de cair')
  })

  test('sessão expirada durante o envio: nada é reenviado e o rascunho local é preservado', async ({
    page,
  }) => {
    const { media } = await openEditor(page, {
      media: { upload: (route) => route.fulfill(error(401, 'UNAUTHENTICATED')) },
    })
    await associate(page, 1)
    await alt(page).fill('Texto local')
    await openPicker(page)
    await pickFile(page).setInputFiles(png())
    await expect(page.getByLabel('Usuário')).toBeVisible()
    expect(media.posts).toHaveLength(1)
    expect(media.asked).toEqual([])
    await page.getByLabel('Usuário').fill('owner')
    await page.getByLabel('Senha').fill('qualquer-senha-de-teste')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByText('Suas alterações foram restauradas depois do login')).toBeVisible()
    await expect(alt(page)).toHaveValue('Texto local')
    expect(media.posts).toHaveLength(1)
  })

  test('conflito de revisão: a associação não sobrescreve a versão nova e fica no rascunho local', async ({
    page,
  }) => {
    const { server } = await openEditor(page)
    await associate(page, 1)
    await alt(page).fill('Minha imagem')
    server.revision = rev(9)
    ;(server.document.modules[0].content as { heading: string }).heading = 'Mudou em outro lugar'
    await saveButton(page).click()
    const alert = page.getByRole('alert').filter({ hasText: 'O rascunho mudou em outro lugar' })
    await expect(alert).toContainText('Nada foi gravado')
    await expect(alt(page)).toHaveValue('Minha imagem')
    await expect(saveButton(page)).toBeDisabled()
    expect((server.document.modules[0].content as { media: unknown }).media).toBeNull()
    expect(server.puts).toHaveLength(1)
  })

  test('escolher imagem enquanto o salvamento está em andamento não é possível (campos travados)', async ({
    page,
  }) => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await openEditor(page)
    await page.route('**/api/admin/site/draft', async (route) => {
      await gate
      await route.fulfill(error(409, 'CMS_REVISION_CONFLICT'))
    })
    await page.getByRole('textbox', { name: 'Título' }).fill('Mudança')
    await saveButton(page).click()
    await expect(choose(page)).toBeDisabled()
    release()
  })
})

test.describe('M2B: layout em 390, 768 e 1440 px', () => {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    test(`biblioteca e campo de imagem cabem em ${width}px, sem rolagem lateral`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await openEditor(page, { media: { items: library(14), consumed: 14 } })
      await openPicker(page)
      const dialog = picker(page)
      await expect(dialog.getByRole('radio')).toHaveCount(12)
      const box = await dialog.boundingBox()
      expect(box?.x).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1)
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      // a ação principal fica ao alcance sem rolar a galeria inteira
      await expect(confirmPick(page)).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeInViewport()
      for (const button of await dialog.getByRole('button').all()) {
        if (!(await button.isVisible())) continue
        const size = await button.boundingBox()
        if (size) expect(size.height, await button.innerText()).toBeGreaterThanOrEqual(36)
      }
      await expect(tile(page, 14)).toBeEnabled()
      await tile(page, 14).check()
      await confirmPick(page).click()
      await expect(picker(page)).toBeHidden()
      await expect(page.locator('[data-media-slot]')).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true)
    })
  }
})
