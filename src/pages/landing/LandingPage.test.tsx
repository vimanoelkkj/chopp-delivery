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
  it.each(['absent', 'ready'] as const)(
    'explains chopp in one compact section without repeating service benefits during %s',
    (status) => {
      if (status === 'ready')
        source.editorial = { status, site: parsePublishedSite(projectPublicCmsV2(published())) }
      const html = render()
      expect(html.match(/id="por-que-chopp"/g)).toHaveLength(1)
      expect(html.indexOf('id="diferenciais"')).toBeLessThan(html.indexOf('id="por-que-chopp"'))
      expect(html.indexOf('id="chopes"')).toBeLessThan(html.indexOf('id="por-que-chopp"'))
      expect(html.indexOf('id="por-que-chopp"')).toBeLessThan(html.indexOf('id="como"'))
      const section = html.match(/<section id="por-que-chopp"[\s\S]*?<\/section>/)?.[0] ?? ''
      expect(section).toContain('Por que escolher chopp para seu evento?')
      expect(section).toContain('Chopp é uma cerveja servida diretamente do barril')
      expect(section.match(/<dt /g)).toHaveLength(3)
      for (const title of ['Praticidade', 'Menos embalagens', 'Experiência'])
        expect(section).toContain(title)
      expect(section).toContain('garrafas e latas individuais')
      expect(section).not.toMatch(
        /Copos inclusos|Entrega e instalação|Atendimento rápido|Oito marcas|Escolha o chopp|Dados e tomada|R\$|barato|saudável|sabor|qualidade|temperatura|gelado|<li |<a |<button/i,
      )
    },
  )
  it.each(['absent', 'ready'] as const)(
    'places the four confirmed benefits after the carousel with editorial state %s',
    (status) => {
      if (status === 'ready')
        source.editorial = { status, site: parsePublishedSite(projectPublicCmsV2(published())) }
      const html = render()
      expect(html.match(/id="diferenciais"/g)).toHaveLength(1)
      expect(html.indexOf('id="barris"')).toBeLessThan(html.indexOf('id="diferenciais"'))
      expect(html.indexOf('id="chopes"')).toBeLessThan(html.indexOf('id="diferenciais"'))
      expect(html.indexOf('id="diferenciais"')).toBeLessThan(html.indexOf('id="como"'))
      const section = html.match(/<section id="diferenciais"[\s\S]*?<\/section>/)?.[0] ?? ''
      expect(section.match(/<li /g)).toHaveLength(4)
      for (const title of [
        'Copos descartáveis inclusos',
        'Entrega e instalação',
        'Atendimento rápido',
        'Variedade',
      ])
        expect(section).toContain(title)
      expect(section).toContain(
        'Fornecemos de 50 a 100 copos descartáveis, conforme a necessidade combinada para seu evento.',
      )
      expect(section).toContain('Oito marcas de chopp')
      expect(section).not.toMatch(/grátis|gratuit|consigna|\d+\s*(?:minutos|horas)|<a |<button/i)
      expect(section.match(/aria-hidden="true"/g)).toHaveLength(4)
      expect(html).toContain('Produto comercial')
      expect(html).toContain('510,00')
    },
  )
  it.each(['loading', 'absent', 'error'] as const)(
    'keeps the current fallback and commercial path during %s',
    (status) => {
      source.editorial = { status }
      const html = render()
      expect(html).toContain(`data-editorial-state="${status}"`)
      expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"')
      for (const id of ['barris', 'chopes', 'como', 'faq', 'contato'])
        expect(html).toContain(`id="${id}"`)
      expect(html).not.toContain('id="sobre"')
      expect(html).not.toContain('O chopp como centro da sua celebração')
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
      expect(html).not.toMatch(/promoções|promoção|Quero essa|câmara fria|Higienização rigorosa/i)
      expect(html).toContain('Pix, dinheiro, cartão de crédito e cartão de débito')
      expect(html).toContain('antes da conclusão do pedido')
      expect(html).toContain('frete é calculado conforme o bairro')
      expect(html).toContain('escadas')
    },
  )
  it('preserves institutional content when published by the CMS', () => {
    const doc = published()
    const about = doc.modules.find((m) => m.template === 'about')
    if (!about) throw Error('Missing institutional fixture')
    about.content = {
      ...about.content,
      heading: 'Institucional publicado',
      body: 'Conteúdo institucional aprovado pelo editor.',
    }
    source.editorial = { status: 'ready', site: parsePublishedSite(projectPublicCmsV2(doc)) }
    const html = render()
    expect(html).toContain('id="sobre"')
    expect(html).toContain('Institucional publicado')
    expect(html).toContain('Conteúdo institucional aprovado pelo editor.')
  })
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
    expect(html).not.toContain('id="diferenciais"')
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
