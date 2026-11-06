import { afterEach, describe, expect, it, vi } from 'vitest'
import { CMS_LIMITS } from '../../../shared/cms/common'
import { projectPublicCmsV2 } from '../../../shared/cms/validation-v2'
import { previewFixture } from '../../../tests/e2e-real/preview-fixture'
import { parseExpandedCatalog } from '../catalog/expanded-api'
import { fetchPublishedSite, parsePublishedSite, selectEditorialCarousel } from './api'

function publication() {
  const doc = previewFixture()
  doc.commercial.whatsappNumber = '5531999999999'
  const hero = doc.modules.find((m) => m.template === 'hero')
  if (hero?.template !== 'hero') throw Error('Fixture hero missing')
  hero.content = {
    heading: 'Título publicado',
    summary: 'Texto publicado',
    deliveryRegion: 'Região editorial',
    media: { id: 'media_12345678-1234-4123-8123-123456789012', alt: 'Imagem editorial' },
  }
  return projectPublicCmsV2(doc)
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
afterEach(() => vi.unstubAllGlobals())

describe('published site boundary', () => {
  it('accepts only the published projection and derives existing layout rules', () => {
    const input = publication()
    const before = JSON.stringify(input)
    const site = parsePublishedSite(input)
    expect(site.document.modules[0].content).toMatchObject({ heading: 'Título publicado' })
    expect(site.layout.homeHref).toBe('#topo')
    expect(site.layout.heroCarouselHref).toBe('#barris')
    expect(JSON.stringify(input)).toBe(before)
  })
  it.each(['admin', 'draft', 'prices', 'media-url', 'anchor', 'hidden', 'schema'] as const)(
    'rejects %s fields rather than exposing or interpreting them',
    (fault) => {
      const value = publication()
      let input: unknown = value
      if (fault === 'admin') input = { ...value, actor_id: 'PRIVATE_SENTINEL' }
      if (fault === 'draft') input = { schema: 2, draft: { document: value }, published: null }
      if (fault === 'prices') Object.assign(value.modules[0].content, { priceCents: 1 })
      if (fault === 'media-url')
        Object.assign(value.modules[0].content, {
          media: { id: 'x', alt: 'x', url: 'https://private.invalid/object' },
        })
      if (fault === 'anchor') value.modules[0].anchor = 'admin/preview'
      if (fault === 'hidden') Object.assign(value.modules[0], { visible: false })
      if (fault === 'schema') input = { ...value, schemaVersion: 1 }
      expect(() => parsePublishedSite(input)).toThrow('INVALID_PUBLIC_SITE')
    },
  )
  it('requests only the public endpoint with same-origin Access compatibility and distinguishes absence', async () => {
    const fetchMock = vi.fn(async () => json(200, publication()))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    expect((await fetchPublishedSite(signal))?.document.modules[0].content).toMatchObject({
      heading: 'Título publicado',
    })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/site', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal,
    })
    fetchMock.mockImplementation(async () => json(404, { error: { code: 'CMS_NOT_PUBLISHED' } }))
    expect(await fetchPublishedSite(signal)).toBeNull()
  })
  it.each(['server', 'network', 'html', 'invalid', 'unknown-404', 'oversized'] as const)(
    'fails closed for %s responses',
    async (fault) => {
      vi.stubGlobal('fetch', async () => {
        if (fault === 'network') throw Error('PRIVATE_SENTINEL')
        if (fault === 'server') return json(503, { error: { code: 'CMS_UNAVAILABLE' } })
        if (fault === 'html') return new Response('<html>Access</html>')
        if (fault === 'unknown-404') return json(404, { error: { code: 'NOT_FOUND' } })
        if (fault === 'oversized') return json(200, { text: 'x'.repeat(CMS_LIMITS.bytes + 1024) })
        return json(200, { draft: 'PRIVATE_SENTINEL' })
      })
      await expect(fetchPublishedSite(new AbortController().signal)).rejects.toThrow()
    },
  )
})

it('selects editorial carousel IDs without changing catalog values, availability or the full catalog', () => {
  const catalog = parseExpandedCatalog({
    revision: 'catalog-test',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [
          {
            id: 'a',
            name: 'Catálogo A',
            description: '',
            visible: true,
            variants: [
              { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 51000 },
              { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: null },
            ],
          },
          {
            id: 'b',
            name: 'Catálogo B',
            description: '',
            visible: true,
            variants: [{ code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 64000 }],
          },
        ],
      },
    ],
  })
  const before = JSON.stringify(catalog)
  const state = { status: 'ready' as const, catalog }
  const selected = selectEditorialCarousel(
    [
      { itemId: 'b', media: null },
      { itemId: 'missing', media: null },
      { itemId: 'a', media: null },
    ],
    state,
  )
  if (selected.status !== 'ready') throw Error('Expected ready selection')
  const items = selected.catalog.expanded.categories[0].items
  expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  expect(items[1]).toBe(catalog.expanded.categories[0].items[0])
  expect(items[1].variants[1].priceCents).toBeNull()
  expect(selected.catalog.products).toBe(catalog.products)
  expect(JSON.stringify(catalog)).toBe(before)
  expect(selectEditorialCarousel([], { status: 'loading' })).toEqual({ status: 'loading' })
  expect(selectEditorialCarousel([], { status: 'error' })).toEqual({ status: 'error' })
})
