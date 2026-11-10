import { readFileSync } from 'node:fs'
import { expect, type Page, type Route, test } from '@playwright/test'
import { projectPublicCmsV2 } from '../shared/cms/validation-v2'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

/**
 * F4A.6.2: a mídia de `carousel.entries[].media` aparece no cartão do produto certo (por itemId),
 * mantendo a foto atual como fallback. Tudo simulado na rede do navegador: nenhum recurso remoto.
 */
const DRONKEN_MEDIA = 'media_12345678-1234-4123-8123-123456789012'
const HEINEKEN_MEDIA = 'media_87654321-1234-4123-8123-123456789012'
const HERO_MEDIA = 'media_11111111-1234-4123-8123-123456789012'
const UNKNOWN_MEDIA = 'media_12345678-4321-4123-8123-123456789012'
const image = readFileSync('src/shared/assets/kegs/keg-hero-50l.webp')

type Entry = { itemId: string; media: { id: string; alt: string } | null }
function site(entries: Entry[]) {
  const doc = previewFixture()
  doc.commercial.whatsappNumber = '5531999999999'
  for (const module of doc.modules) {
    // Uma publicação exige imagem no hero; ela não faz parte do que este spec verifica.
    if (module.template === 'hero')
      module.content = { ...module.content, media: { id: HERO_MEDIA, alt: 'Hero editorial' } }
    if (module.template === 'carousel') module.content = { ...module.content, entries }
  }
  return projectPublicCmsV2(doc)
}
const ref = (id: string, alt: string) => ({ id, alt })
const dronken = { itemId: 'dronken', media: ref(DRONKEN_MEDIA, 'Foto editorial do Dronken') }
const heineken = { itemId: 'heineken', media: ref(HEINEKEN_MEDIA, 'Foto editorial da Heineken') }

type MediaHandler = (route: Route) => Promise<void> | void
const ok: MediaHandler = (route) =>
  route.fulfill({ status: 200, contentType: 'image/webp', body: image })

async function open(
  page: Page,
  width: number,
  entries: Entry[],
  media: MediaHandler = ok,
  hide: string[] = [],
) {
  const requested: string[] = []
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/site', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: site(entries) }),
  )
  await page.route('**/api/site/media/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.includes(HERO_MEDIA)) requested.push(path)
    return media(route)
  })
  if (hide.length)
    await page.route('**/api/catalog', async (route) => {
      const data = await (await route.fetch()).json()
      for (const category of data.categories)
        category.items = category.items.filter((i: { id: string }) => !hide.includes(i.id))
      await route.fulfill({ json: data })
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
const broken = (page: Page) =>
  page.evaluate(() =>
    [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
  )

for (const width of [390, 1440]) {
  test.describe(`mídia editorial do carrossel em ${width}px`, () => {
    test('cada imagem aparece no cartão do próprio produto, com o alt editorial', async ({
      page,
    }) => {
      const requested = await open(page, width, [dronken, heineken])
      await expect(published(page, 'Dronken')).toHaveAttribute(
        'src',
        `/api/site/media/${DRONKEN_MEDIA}/section`,
      )
      await expect(published(page, 'Heineken')).toHaveAttribute(
        'src',
        `/api/site/media/${HEINEKEN_MEDIA}/section`,
      )
      await expect(published(page, 'Dronken')).toHaveAttribute('alt', 'Foto editorial do Dronken')
      await expect(published(page, 'Heineken')).toHaveAttribute('alt', 'Foto editorial da Heineken')
      // Carregada, a foto antiga do produto sai do lugar (o fallback não fica sobreposto).
      await expect(keg(page, 'Dronken')).toHaveCount(0)
      expect(requested.sort()).toEqual(
        [
          `/api/site/media/${DRONKEN_MEDIA}/section`,
          `/api/site/media/${HEINEKEN_MEDIA}/section`,
        ].sort(),
      )
      expect(await broken(page)).toEqual([])
    })

    test('entradas reordenadas mantêm cada imagem no produto certo', async ({ page }) => {
      await open(page, width, [heineken, dronken])
      await expect(card(page, 'Heineken').first()).toBeAttached()
      const order = await page
        .locator('#barris article h3')
        .evaluateAll((all) => all.map((h) => h.textContent))
      expect(order).toEqual(['Heineken', 'Dronken'])
      await expect(published(page, 'Heineken')).toHaveAttribute(
        'src',
        `/api/site/media/${HEINEKEN_MEDIA}/section`,
      )
      await expect(published(page, 'Dronken')).toHaveAttribute(
        'src',
        `/api/site/media/${DRONKEN_MEDIA}/section`,
      )
    })

    test('entrada sem mídia mantém a foto atual e não faz nenhuma requisição de mídia', async ({
      page,
    }) => {
      const requested = await open(page, width, [{ itemId: 'dronken', media: null }, heineken])
      await expect(published(page, 'Heineken')).toHaveCount(1)
      await expect(keg(page, 'Dronken')).toHaveCount(1)
      await expect(published(page, 'Dronken')).toHaveCount(0)
      expect(requested).toEqual([`/api/site/media/${HEINEKEN_MEDIA}/section`])
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
      test(`imagem indisponível (${name}): a foto atual permanece, sem imagem quebrada`, async ({
        page,
      }) => {
        await open(page, width, [dronken], handler)
        await expect(keg(page, 'Dronken')).toHaveCount(1)
        await expect(keg(page, 'Dronken')).toBeVisible()
        await expect(published(page, 'Dronken')).toHaveCount(0)
        expect(await broken(page)).toEqual([])
      })
    }

    test('produto oculto ou inexistente no catálogo não recebe imagem nem gera requisição', async ({
      page,
    }) => {
      const stranger = { itemId: 'nao-existe', media: ref(UNKNOWN_MEDIA, 'Sem produto') }
      const requested = await open(page, width, [heineken, stranger], ok, ['heineken'])
      // Heineken está oculta no catálogo público: a entrada some, com a imagem dela.
      await expect(card(page, 'Heineken')).toHaveCount(0)
      await expect(page.locator('#barris')).not.toContainText('Heineken')
      expect(requested).toEqual([])
      // A seleção válida restante nunca esvazia a vitrine (Dronken segue com a foto atual).
      await expect(page.locator('#barris article').first()).toBeAttached()
      expect(await broken(page)).toEqual([])
    })
  })
}
