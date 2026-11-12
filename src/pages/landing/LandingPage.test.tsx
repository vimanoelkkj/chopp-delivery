import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseExpandedCatalog } from '@/features/catalog/expanded-api'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { contact } from '@/features/contact/config'
import { parsePublishedSite } from '@/features/site/api'
import type { PublishedSiteState } from '@/features/site/usePublishedSite'
import { PublishedMedia } from '@/shared/ui/PublishedMedia'
import { projectPublicCmsV2 } from '../../../shared/cms/validation-v2'
import { previewFixture } from '../../../tests/e2e-real/preview-fixture'
import { LandingPage } from './LandingPage'

const source = vi.hoisted(() => ({
  catalog: { status: 'loading' } as CatalogState,
  editorial: { status: 'absent' } as PublishedSiteState,
}))
vi.mock('@/features/catalog/useCatalog', () => ({
  useCatalog: () => ({ state: source.catalog, retry: () => {} }),
}))
vi.mock('@/features/site/usePublishedSite', () => ({ usePublishedSite: () => source.editorial }))

const MEDIA_ID = 'media_12345678-1234-4123-8123-123456789012'
function published() {
  const doc = previewFixture()
  doc.commercial.whatsappNumber = '5531999999999'
  const hero = doc.modules.find((m) => m.template === 'hero')
  if (hero?.template !== 'hero') throw Error('Fixture hero missing')
  hero.content = {
    heading: 'Hero público',
    summary: 'Resumo público',
    deliveryRegion: 'Região publicada',
    media: { id: MEDIA_ID, alt: 'Imagem editorial' },
  }
  return doc
}
const render = () => renderToStaticMarkup(<LandingPage />)
const catalog = () => ({
  status: 'ready' as const,
  catalog: parseExpandedCatalog({
    revision: 'live-catalog',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [
          {
            id: 'dronken',
            name: 'Produto comercial',
            description: 'Dados do catálogo',
            visible: true,
            variants: [
              { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 51000 },
              { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: null },
            ],
          },
        ],
      },
    ],
  }),
})
beforeEach(() => {
  source.catalog = catalog()
  source.editorial = { status: 'absent' }
})

describe('approved storefront with published editorial content', () => {
  it.each(['loading', 'absent', 'error'] as const)(
    'keeps the current fallback and commercial path during %s',
    (status) => {
      source.editorial = { status }
      const html = render()
      expect(html).toContain(`data-editorial-state="${status}"`)
      expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"')
      for (const id of ['barris', 'chopes', 'como', 'sobre', 'faq', 'contato'])
        expect(html).toContain(`id="${id}"`)
      expect(html).toContain('O melhor do chopp.')
      expect(html).toContain(
        'Operação exclusiva por delivery • Entrega e instalação em Belo Horizonte e região • Sem retirada',
      )
      expect(html).not.toMatch(/s[aã]o jo[aã]o del[ -]?rei/i)
      expect(html).toContain('Produto comercial')
      expect(html).toContain('510,00')
      expect(html).toContain('Pedir no WhatsApp')
      if (contact.whatsappNumber) expect(html).toContain(`wa.me/${contact.whatsappNumber}`)
      expect(html).not.toContain('/api/admin/')
    },
  )
  it('renders supported modules in published order with matching navigation and CTAs', () => {
    const doc = published()
    const how = doc.modules.find((m) => m.template === 'how')
    const faq = doc.modules.find((m) => m.template === 'faq')
    if (!how || !faq) throw Error('Missing fixture modules')
    doc.modules = doc.modules.filter((m) => m !== how && m !== faq)
    doc.modules.splice(doc.modules.length - 1, 0, how, faq)
    source.editorial = { status: 'ready', site: parsePublishedSite(projectPublicCmsV2(doc)) }
    const html = render()
    expect(html).toContain('Hero público')
    expect(html).toContain('Resumo público')
    expect(html).toContain('Entrega e instalação em Região publicada • Sem retirada')
    expect(html).toContain('<span>Região publicada</span>')
    expect(html).not.toMatch(/s[aã]o jo[aã]o del[ -]?rei/i)
    expect(html).toContain('wa.me/5531999999999')
    expect(html).toContain('href="#barris"')
    expect(html.indexOf('id="como"')).toBeLessThan(html.indexOf('id="faq"'))
    expect(html).toContain('Produto comercial')
    expect(html).toContain('510,00')
    // Only the same-origin public media path may carry the ID; never admin/R2/absolute URLs.
    expect(html).not.toMatch(/src="[^"]*(?:api\/admin|r2|https?:)/)
    expect(html).toContain(`src="/api/site/media/${MEDIA_ID}/hero"`)
    // Until the image loads: invisible, out of the accessibility tree, local fallback still present.
    expect(html).toMatch(/<img src="\/api\/site\/media\/[^"]+\/hero" alt="" aria-hidden="true"/)
    expect(html).not.toContain('alt="Imagem editorial"')
    expect(html).toContain('Barril de chopp em aço inox escovado, 50 litros')
  })
  it('requests hero and about media through the shared helper and never requests media for the default presentation', () => {
    const doc = published()
    const about = doc.modules.find((m) => m.template === 'about')
    if (about?.template !== 'about') throw Error('Fixture about missing')
    about.content = {
      ...about.content,
      media: { id: MEDIA_ID.replace('1234', '4321'), alt: 'Sobre' },
    }
    source.editorial = { status: 'ready', site: parsePublishedSite(projectPublicCmsV2(doc)) }
    const html = render()
    expect(html).toContain(`/api/site/media/${MEDIA_ID.replace('1234', '4321')}/section`)
    expect(html).toContain('Barril de chopp em aço inox escovado"')
    // Draft preview and default presentation never request published media.
    source.editorial = { status: 'absent' }
    expect(render()).not.toContain('/api/site/media/')
  })
  it('never builds URLs from malformed or foreign media IDs', () => {
    for (const id of [
      'media_x',
      'https://evil.test/a.png',
      '../../api/admin/media',
      'media_12345678-1234-4123-8123-123456789012/../x',
    ])
      expect(
        renderToStaticMarkup(
          <PublishedMedia
            media={{ id, alt: 'x' }}
            profile="hero"
            fit="cover"
            fallback={<i data-fallback />}
          />,
        ),
      ).toBe('<i data-fallback="true"></i>')
  })
  it('omits unpublished/hidden modules and orphan navigation without removing the full catalog', () => {
    const doc = published()
    doc.modules = doc.modules.filter((m) => m.template !== 'carousel')
    const how = doc.modules.find((m) => m.template === 'how')
    if (how) how.visible = false
    source.editorial = { status: 'ready', site: parsePublishedSite(projectPublicCmsV2(doc)) }
    const html = render()
    expect(html).not.toContain('href="#barris"')
    expect(html).not.toContain('href="#como"')
    expect(html).not.toContain('id="como"')
    expect(html).toContain('id="chopes"')
    expect(html).toContain('Produto comercial')
  })
  it('does not let publication replace a failed catalog with editorial commerce', () => {
    source.editorial = {
      status: 'ready',
      site: parsePublishedSite(projectPublicCmsV2(published())),
    }
    source.catalog = { status: 'error' }
    const html = render()
    expect(html).toContain('Hero público')
    expect(html).not.toContain('510,00')
    expect(html).not.toContain('A partir de')
    expect(html).toContain('Tentar novamente')
  })
})
