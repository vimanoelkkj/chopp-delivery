import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseCmsDocument as serverParse } from '../../../../server/cms/validation-v2'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'
import { previewHeaders } from '../../../../shared/preview-security'
import { previewFixture } from '../../../../tests/e2e-real/preview-fixture'
import { parseExpandedCatalog } from '../../catalog/expanded-api'
import type { CatalogState } from '../../catalog/useCatalog'
import { previewCarousel, readPreviewSnapshot } from './model'
import { PreviewRenderer } from './PreviewRenderer'

const revision = 'c2_12345678-1234-4123-8123-123456789012'
const snapshot = () => ({
  schema: 2,
  draft: { revision, document: previewFixture() },
  published: null,
})
const catalog: CatalogState = {
  status: 'ready',
  catalog: parseExpandedCatalog({
    revision: 'test-only',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [
          {
            id: 'dronken',
            name: 'Dronken',
            description: 'API',
            visible: true,
            variants: [{ code: 'fraction', label: '1,5 L', volumeMl: 1500, priceCents: 12345 }],
          },
          {
            id: 'heineken',
            name: 'Heineken',
            description: 'API',
            visible: true,
            variants: [{ code: '50', label: '50 L', volumeMl: 50000, priceCents: 99000 }],
          },
        ],
      },
    ],
  }),
}
describe('P4: strict read-only preview model', () => {
  it('shares the exact server validator implementation and accepts a valid v2 draft', () => {
    expect(serverParse).toBe(parseCmsDocument)
    expect(readPreviewSnapshot(snapshot())?.layout.sections.map((s) => s.template)).toEqual([
      'hero',
      'carousel',
      'ticker',
      'catalog',
      'faq',
      'about',
      'how',
      'highlight',
      'highlight',
      'contact',
    ])
  })
  for (const mutate of [
    (s: ReturnType<typeof snapshot>) => {
      Object.assign(s.draft.document, { priceCents: 1 })
    },
    (s: ReturnType<typeof snapshot>) => {
      s.schema = 3
    },
    (s: ReturnType<typeof snapshot>) => {
      s.draft.document.modules[0].content = {
        heading: '<script>x</script>',
        summary: '',
        media: null,
      }
    },
    (s: ReturnType<typeof snapshot>) => {
      s.draft.document.modules[1].id = 'hero'
    },
    (s: ReturnType<typeof snapshot>) => {
      s.draft.revision = 'invalid'
    },
    (s: ReturnType<typeof snapshot>) => {
      Object.assign(s.draft.document.modules[1].content, {
        entries: [{ itemId: 'dronken', media: null, priceCents: 1 }],
      })
    },
  ])
    it('fails closed for malformed versions, keys, content, identities and commercial overrides', () => {
      const s = snapshot()
      mutate(s)
      expect(() => readPreviewSnapshot(s)).toThrow('INVALID_PREVIEW')
    })
  it('instructs rather than converting an uninitialized site', () => {
    expect(
      readPreviewSnapshot({
        schema: null,
        draft: { revision: revision.replace('c2_', 'c1_'), document: null },
        published: null,
      }),
    ).toBeNull()
  })
  it('respects carousel entry order and diagnoses unavailable items without fake fallbacks', () => {
    const entries = [
      { itemId: 'heineken', media: null },
      { itemId: 'missing', media: null },
      { itemId: 'dronken', media: null },
    ]
    const result = previewCarousel(entries, catalog)
    expect(result.unavailable).toEqual(['missing'])
    if (result.state.status !== 'ready') throw new Error('expected ready')
    expect(result.state.catalog.expanded.categories[0].items.map((i) => i.id)).toEqual([
      'heineken',
      'dronken',
    ])
    expect(result.state.catalog.expanded.categories[0].items[1].variants[0]).toEqual({
      code: 'fraction',
      label: '1,5 L',
      volumeMl: 1500,
      priceCents: 12345,
    })
    expect(catalog.status === 'ready' && catalog.catalog.expanded.categories[0].items[0].id).toBe(
      'dronken',
    )
  })
  it('preserves API loading/error and empty carousel selections', () => {
    expect(previewCarousel([], { status: 'loading' }).state).toEqual({ status: 'loading' })
    expect(previewCarousel([], { status: 'error' }).state).toEqual({ status: 'error' })
    const selected = previewCarousel([], catalog).state
    expect(selected.status === 'ready' && selected.catalog.expanded.categories[0].items).toEqual([])
  })
  it('renders all existing sections in editorial order with unique IDs and inert commerce', () => {
    const value = readPreviewSnapshot(snapshot())
    if (!value) throw new Error('v2 required')
    const html = renderToStaticMarkup(
      <PreviewRenderer value={value} catalog={catalog} retry={() => {}} />,
    )
    expect(html).toContain('Rascunho privado P4')
    expect(html).toContain('1,5L')
    expect(html).not.toContain('https://wa.me/')
    expect(html).toContain('disabled=""')
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
    const links = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    for (const target of links) expect(ids).toContain(target)
    expect(html.indexOf('Perguntas do rascunho')).toBeLessThan(html.indexOf('História editorial'))
    expect(html).toContain('03 · Dúvidas')
    expect(html).toContain('04 • Origem')
    expect(html).toContain('05 • Sem')
  })
  it('removes orphan menu/hero links for hidden carousel/how/FAQ without altering the document', () => {
    const s = snapshot()
    for (const m of s.draft.document.modules)
      if (['carousel', 'how', 'faq'].includes(m.template)) m.visible = false
    const before = JSON.stringify(s)
    const value = readPreviewSnapshot(s)
    if (!value) throw new Error('required')
    const html = renderToStaticMarkup(
      <PreviewRenderer value={value} catalog={catalog} retry={() => {}} />,
    )
    expect(html).not.toContain('href="#barris"')
    expect(html).not.toContain('href="#como"')
    expect(html).not.toContain('href="#faq"')
    expect(JSON.stringify(s)).toBe(before)
  })
  it('resolves saved images through the authenticated ID/profile route, never storage keys, and keeps carousel.media diagnostic-only', () => {
    const s = snapshot()
    const ref = { id: 'media_12345678-1234-4123-8123-123456789012', alt: 'Privada' }
    Object.assign(s.draft.document.modules[0].content, { media: ref })
    Object.assign(s.draft.document.modules[1].content, {
      media: ref,
      entries: [{ itemId: 'dronken', media: ref }],
    })
    const value = readPreviewSnapshot(s)
    if (!value) throw new Error('required')
    const html = renderToStaticMarkup(
      <PreviewRenderer value={value} catalog={catalog} retry={() => {}} />,
    )
    // hero usa o perfil hero; seção institucional e imagem de barril, o perfil section
    expect(html).toContain(`src="/api/admin/media/${ref.id}/hero"`)
    expect(html).toContain(`src="/api/admin/media/${ref.id}/section"`)
    expect(html).toContain('alt="Privada"')
    expect(html).toContain('carousel.media preservada sem representação visual definida')
    // carousel.media segue sem representação visual: só a abertura usa o perfil hero
    // (o React também emite um <link rel="preload"> por imagem; conta-se só a tag <img>)
    expect((html.match(/<img[^>]*\/api\/admin\/media\/[^"]+\/hero"/g) ?? []).length).toBe(1)
    expect((html.match(/<img[^>]*\/api\/admin\/media\/[^"]+\/section"/g) ?? []).length).toBe(1)
    expect(html).not.toMatch(/cms\/derived|objectKey|sha256|quarantine/)
  })
  it('only permits the exact frame path; nested frames, external scripts/ancestors remain blocked', () => {
    const parent = previewHeaders('http://localhost:4185', false),
      frame = previewHeaders('http://localhost:4185', true)
    expect(parent['Content-Security-Policy']).toContain(
      'frame-src http://localhost:4185/admin/preview/frame;',
    )
    expect(parent['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    expect(frame['Content-Security-Policy']).toContain("frame-src 'none'")
    expect(frame['Content-Security-Policy']).toContain("frame-ancestors 'self'")
    expect(frame['Content-Security-Policy']).toContain("form-action 'none'")
    for (const policy of [parent, frame]) expect(policy['Cache-Control']).toBe('no-store')
  })
  it('Hero e Sobre usam apenas mídia privada nos palcos originais, com contain e cover', () => {
    const s = snapshot()
    for (const module of s.draft.document.modules)
      if (module.template === 'hero' || module.template === 'about')
        module.content.media = {
          id: 'media_12345678-1234-4123-8123-123456789012',
          alt: `Privada ${module.template}`,
        }
    const value = readPreviewSnapshot(s)
    if (!value) throw Error('Expected v2 snapshot')
    const html = renderToStaticMarkup(
      <PreviewRenderer value={value} catalog={catalog} retry={() => {}} />,
    )
    expect(html).toContain('data-media-fit="contain"')
    expect(html).toContain('data-media-fit="cover"')
    expect(html).toContain('/api/admin/media/media_12345678-1234-4123-8123-123456789012/hero')
    expect(html).toContain('/api/admin/media/media_12345678-1234-4123-8123-123456789012/section')
    expect(html).not.toContain('/api/site/media/')
    expect(html).not.toContain('publishedMedia')
  })
})
