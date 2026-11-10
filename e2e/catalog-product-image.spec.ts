import { readFileSync } from 'node:fs'
import { expect, type Page, type Route, test } from '@playwright/test'
import { projectPublicCmsV2 } from '../shared/cms/validation-v2'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

/**
 * F4A.6.4D: imagem principal do produto (`image` do catálogo público) e precedência na vitrine:
 * editorial do carrossel > principal do produto > foto aprovada > silhueta. Tudo simulado na rede
 * do navegador (dados descartáveis, nenhum recurso remoto).
 */
const P_DRONKEN = 'media_12345678-1234-4123-8123-123456789012'
const P_HEINEKEN = 'media_87654321-1234-4123-8123-123456789012'
const P_NOVO = 'media_aaaaaaaa-1234-4123-8123-123456789012'
const E_DRONKEN = 'media_11111111-1234-4123-8123-123456789012'
const HERO = 'media_22222222-1234-4123-8123-123456789012'
const image = readFileSync('src/shared/assets/kegs/keg-hero-50l.webp')

const std = (id: string, name: string, p30: number, p50: number, img?: string) => ({
  id,
  name,
  description: `Descrição ${name}`,
  visible: true,
  variants: [
    { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: p30 },
    { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: p50 },
  ],
  ...(img ? { image: { id: img, alt: `Foto principal de ${name}` } } : {}),
})
const novo = (img?: string) => ({
  id: 'item_novo',
  name: 'Produto Novo',
  description: 'Novo',
  visible: true,
  variants: [{ code: 'v_20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 25000 }],
  ...(img ? { image: { id: img, alt: 'Foto principal de Produto Novo' } } : {}),
})
const semFoto = {
  id: 'item_sem_foto',
  name: 'Sem Foto',
  description: 'Sem imagem',
  visible: true,
  variants: [{ code: 'v_10', label: 'Barril de 10 L', volumeMl: 10000, priceCents: 15000 }],
}
const catalog = (withImages: boolean, omit: string[] = []) => ({
  revision: 'r1',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: [
        std('dronken', 'Dronken', 51000, 65000, withImages ? P_DRONKEN : undefined),
        std('heineken', 'Heineken', 55000, 99000, withImages ? P_HEINEKEN : undefined),
        novo(withImages ? P_NOVO : undefined),
        semFoto,
      ].filter((i) => !omit.includes(i.id)),
    },
    { id: 'cachacas', name: 'Cachaças', items: [] },
  ],
})

type Entry = { itemId: string; media: { id: string; alt: string } | null }
function site(entries: Entry[]) {
  const doc = previewFixture()
  doc.commercial.whatsappNumber = '5531999999999'
  for (const module of doc.modules) {
    if (module.template === 'hero')
      module.content = { ...module.content, media: { id: HERO, alt: 'Hero editorial' } }
    if (module.template === 'carousel') module.content = { ...module.content, entries }
  }
  return projectPublicCmsV2(doc)
}

type Handler = (route: Route) => Promise<void> | void
const ok: Handler = (route) =>
  route.fulfill({ status: 200, contentType: 'image/webp', body: image })

async function open(
  page: Page,
  width: number,
  data: ReturnType<typeof catalog>,
  options: { entries?: Entry[]; media?: Handler; siteHandler?: Handler } = {},
) {
  const requested: string[] = []
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/catalog', (route) => route.fulfill({ json: data }))
  await page.route(
    '**/api/site',
    options.siteHandler ??
      ((route) =>
        options.entries
          ? route.fulfill({ json: site(options.entries) })
          : route.fulfill({ status: 404, json: { error: { code: 'CMS_NOT_PUBLISHED' } } })),
  )
  await page.route('**/api/site/media/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.includes(HERO)) requested.push(path)
    return (options.media ?? ok)(route)
  })
  await page.goto('/')
  await expect(page.locator('#barris article').first()).toBeAttached()
  return requested
}

// Por CSS: cartões laterais ficam aria-hidden e não aparecem em consultas por papel.
const card = (page: Page, name: string) =>
  page
    .locator('#barris article')
    .filter({ has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) })
const published = (page: Page, name: string) =>
  card(page, name).locator('img[src^="/api/site/media/"]')
const keg = (page: Page, name: string) =>
  card(page, name).locator(`img[alt="Barril de Chopp ${name} em Aço Inox"]`)
const placeholder = (page: Page, name: string) => card(page, name).locator('[data-keg-placeholder]')
const broken = (page: Page) =>
  page.evaluate(() =>
    [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
  )

for (const width of [390, 1440]) {
  test.describe(`imagem principal do produto em ${width}px`, () => {
    test('sem publicação editorial: cada produto mostra a própria imagem; sem imagem, foto ou silhueta', async ({
      page,
    }) => {
      const requested = await open(page, width, catalog(true))
      await expect(published(page, 'Dronken')).toHaveAttribute(
        'src',
        `/api/site/media/${P_DRONKEN}/section`,
      )
      await expect(published(page, 'Dronken')).toHaveAttribute('alt', 'Foto principal de Dronken')
      await expect(published(page, 'Heineken')).toHaveAttribute(
        'src',
        `/api/site/media/${P_HEINEKEN}/section`,
      )
      await expect(published(page, 'Produto Novo')).toHaveAttribute(
        'src',
        `/api/site/media/${P_NOVO}/section`,
      )
      // Sem imagem principal: só a silhueta neutra, sem foto de outra marca nem requisição.
      await expect(published(page, 'Sem Foto')).toHaveCount(0)
      await expect(placeholder(page, 'Sem Foto')).toHaveCount(1)
      expect(requested.sort()).toEqual(
        [P_DRONKEN, P_HEINEKEN, P_NOVO].map((id) => `/api/site/media/${id}/section`).sort(),
      )
      expect(await broken(page)).toEqual([])
    })

    test('a imagem editorial vence a principal no carrossel; sem editorial, vale a principal', async ({
      page,
    }) => {
      const requested = await open(page, width, catalog(true), {
        entries: [
          { itemId: 'dronken', media: { id: E_DRONKEN, alt: 'Editorial do Dronken' } },
          { itemId: 'heineken', media: null },
        ],
      })
      await expect(published(page, 'Dronken')).toHaveAttribute(
        'src',
        `/api/site/media/${E_DRONKEN}/section`,
      )
      await expect(published(page, 'Dronken')).toHaveAttribute('alt', 'Editorial do Dronken')
      await expect(published(page, 'Heineken')).toHaveAttribute(
        'src',
        `/api/site/media/${P_HEINEKEN}/section`,
      )
      // A principal do Dronken não é requisitada: a editorial a substituiu no carrossel.
      expect(requested.some((path) => path.includes(P_DRONKEN))).toBe(false)
    })

    test('entradas reordenadas mantêm cada imagem no produto certo', async ({ page }) => {
      await open(page, width, catalog(true), {
        entries: [
          { itemId: 'heineken', media: null },
          { itemId: 'dronken', media: null },
        ],
      })
      const order = await page
        .locator('#barris article h3')
        .evaluateAll((all) => all.map((h) => h.textContent))
      expect(order).toEqual(['Heineken', 'Dronken'])
      await expect(published(page, 'Heineken')).toHaveAttribute(
        'src',
        `/api/site/media/${P_HEINEKEN}/section`,
      )
      await expect(published(page, 'Dronken')).toHaveAttribute(
        'src',
        `/api/site/media/${P_DRONKEN}/section`,
      )
    })

    for (const [name, handler] of [
      [
        '404',
        (route: Route) =>
          route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{}}' }),
      ],
      [
        'corpo corrompido',
        (route: Route) => route.fulfill({ status: 200, contentType: 'image/webp', body: 'x' }),
      ],
      ['falha de rede', (route: Route) => route.abort('failed')],
    ] as const) {
      test(`imagem indisponível (${name}): foto aprovada ou silhueta permanecem, sem imagem quebrada`, async ({
        page,
      }) => {
        await open(page, width, catalog(true), { media: handler })
        await expect(keg(page, 'Dronken')).toHaveCount(1)
        // O arquivo da foto aprovada vem do servidor local: com muitos testes em paralelo, damos folga.
        await expect(keg(page, 'Dronken')).toBeVisible({ timeout: 20_000 })
        await expect(placeholder(page, 'Produto Novo')).toHaveCount(1)
        await expect(published(page, 'Dronken')).toHaveCount(0)
        expect(await broken(page)).toEqual([])
      })
    }

    // O conteúdo editorial pode falhar de várias formas. Em todas, a página assenta no estado "error"
    // e a imagem principal aparece depois (a fallback editorial resolvida), sem imagem quebrada.
    for (const [name, handler] of [
      [
        'HTTP 500 em texto',
        (route: Route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'x' }),
      ],
      [
        'HTTP 500 em JSON',
        (route: Route) =>
          route.fulfill({ status: 500, json: { error: { code: 'PUBLIC_SITE_UNAVAILABLE' } } }),
      ],
      [
        'JSON inválido',
        (route: Route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '{"truncado":' }),
      ],
      ['falha de rede', (route: Route) => route.abort('failed')],
      // Sem resposta: o app desiste em 10 s e então mostra a imagem principal.
      ['sem resposta', () => new Promise<void>(() => {})],
    ] as const) {
      test(`/api/site com ${name}: a imagem principal aparece depois do fallback editorial`, async ({
        page,
      }) => {
        test.setTimeout(60_000)
        const requested = await open(page, width, catalog(true), { siteHandler: handler })
        await expect(page.locator('[data-editorial-state]')).toHaveAttribute(
          'data-editorial-state',
          'error',
          { timeout: 20_000 },
        )
        await expect(published(page, 'Dronken')).toHaveAttribute(
          'src',
          `/api/site/media/${P_DRONKEN}/section`,
          { timeout: 20_000 },
        )
        await expect(published(page, 'Produto Novo')).toHaveAttribute(
          'src',
          `/api/site/media/${P_NOVO}/section`,
        )
        // Cada imagem principal é requisitada uma vez, só depois de o editorial se resolver.
        expect(requested.sort()).toEqual(
          [P_DRONKEN, P_HEINEKEN, P_NOVO].map((id) => `/api/site/media/${id}/section`).sort(),
        )
        expect(await broken(page)).toEqual([])
      })
    }

    test('produto oculto (fora do catálogo público): sem cartão, sem imagem e sem requisição', async ({
      page,
    }) => {
      const requested = await open(page, width, catalog(true, ['heineken']))
      await expect(card(page, 'Heineken')).toHaveCount(0)
      await expect(page.locator('#barris')).not.toContainText('Heineken')
      expect(requested.some((path) => path.includes(P_HEINEKEN))).toBe(false)
      await expect(published(page, 'Dronken')).toHaveCount(1)
    })

    test('preços, variantes e pedidos são idênticos com e sem imagem principal', async ({
      browser,
    }) => {
      const texts: { barris: string; chopes: string; buttons: number }[] = []
      for (const withImages of [false, true]) {
        const context = await browser.newContext()
        const page = await context.newPage()
        try {
          await open(page, width, catalog(withImages))
          await expect(page.locator('#chopes table')).toBeVisible()
          if (withImages) await expect(published(page, 'Dronken')).toHaveCount(1)
          texts.push({
            barris: await page.locator('#barris').innerText(),
            chopes: await page.locator('#chopes').innerText(),
            buttons: await page.locator('#chopes a, #chopes button, #barris a').count(),
          })
        } finally {
          await context.close()
        }
      }
      expect(texts[1]).toEqual(texts[0])
    })
  })
}
