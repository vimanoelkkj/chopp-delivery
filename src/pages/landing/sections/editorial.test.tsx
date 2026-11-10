import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseExpandedCatalog } from '@/features/catalog/expanded-api'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { contact } from '@/features/contact/config'
import { formatBRL } from '@/shared/lib/format'
import { AboutSection } from './AboutSection'
import { BarrelsSection } from './BarrelsSection'
import { CatalogSection } from './CatalogSection'
import { ContactSection } from './ContactSection'
import { FaqSection } from './FaqSection'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { PromoSection } from './PromoSection'
import { Ticker } from './Ticker'

describe('P3: approved section defaults captured before adaptation', () => {
  const defaults = {
    hero: <Hero />,
    barrels: <BarrelsSection state={{ status: 'loading' }} />,
    catalog: <CatalogSection state={{ status: 'loading' }} retry={() => {}} />,
    ticker: <Ticker />,
    how: <HowItWorks />,
    about: <AboutSection />,
    promo: <PromoSection />,
    faq: <FaqSection />,
    contact: <ContactSection />,
  }
  for (const [name, element] of Object.entries(defaults)) {
    it(`${name}: unchanged markup without editorial props`, () => {
      expect(renderToStaticMarkup(element)).toMatchSnapshot()
    })
  }
})

const cases: { name: string; render: (text: string) => ReactElement; landmark?: string }[] = [
  {
    name: 'hero',
    render: (text) => <Hero editorial={{ heading: text, summary: text }} />,
    landmark: 'hero-title',
  },
  {
    name: 'carousel header',
    render: (text) => (
      <BarrelsSection state={{ status: 'loading' }} editorial={{ heading: text, lead: text }} />
    ),
    landmark: 'barris-title',
  },
  {
    name: 'catalog header',
    render: (text) => (
      <CatalogSection
        state={{ status: 'loading' }}
        retry={() => {}}
        editorial={{ heading: text, intro: text }}
      />
    ),
    landmark: 'chopes-title',
  },
  { name: 'ticker', render: (text) => <Ticker editorial={{ items: [text, text] }} /> },
  {
    name: 'how',
    render: (text) => (
      <HowItWorks
        editorial={{
          heading: text,
          steps: [
            { title: text, body: text },
            { title: text, body: text },
          ],
        }}
      />
    ),
    landmark: 'como-title',
  },
  {
    name: 'about',
    render: (text) => <AboutSection editorial={{ heading: text, body: text }} />,
    landmark: 'sobre-title',
  },
  {
    name: 'highlight',
    render: (text) => <PromoSection editorial={{ heading: text, body: text }} />,
    landmark: 'promo-title',
  },
  {
    name: 'faq',
    render: (text) => (
      <FaqSection editorial={{ heading: text, items: [{ question: text, answer: text }] }} />
    ),
    landmark: 'faq-title',
  },
  {
    name: 'contact',
    render: (text) => <ContactSection editorial={{ heading: text, body: text }} />,
    landmark: 'contato-title',
  },
]
describe('P3: typed editorial content and escaped rendering', () => {
  for (const scenario of cases) {
    it(`${scenario.name}: renders content and preserves its accessible landmark`, () => {
      const html = renderToStaticMarkup(scenario.render('Texto editorial válido'))
      expect(html).toContain('Texto editorial válido')
      if (scenario.landmark) {
        expect(html).toContain(`aria-labelledby="${scenario.landmark}"`)
        expect(html).toContain(`id="${scenario.landmark}"`)
      }
    })
    it(`${scenario.name}: never interprets text as HTML`, () => {
      const html = renderToStaticMarkup(scenario.render('<script>alert("x")</script> & teste'))
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('&lt;/script&gt; &amp; teste')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('dangerouslySetInnerHTML')
    })
  }
  it('keeps FAQ button/panel relationships and starts with every item collapsed', () => {
    const html = renderToStaticMarkup(
      <FaqSection
        editorial={{
          heading: 'Dúvidas locais',
          items: [
            { question: 'Primeira?', answer: 'Resposta 1' },
            { question: 'Outra?', answer: 'Resposta 2' },
          ],
        }}
      />,
    )
    const buttons = [
      ...html.matchAll(
        /<button[^>]*id="([^"]+)"[^>]*aria-expanded="(true|false)"[^>]*aria-controls="([^"]+)"/g,
      ),
    ]
    expect(buttons).toHaveLength(2)
    expect(buttons.map((button) => button[2])).toEqual(['false', 'false'])
    for (const button of buttons)
      expect(html).toContain(`id="${button[3]}" aria-labelledby="${button[1]}"`)
  })
  it('does not fill empty editorial lists or text with invented defaults', () => {
    expect(renderToStaticMarkup(<Ticker editorial={{ items: [] }} />)).not.toContain('<li')
    expect(
      renderToStaticMarkup(<HowItWorks editorial={{ heading: '', steps: [] }} />),
    ).not.toContain('Escolha o Chopp')
    expect(
      renderToStaticMarkup(<FaqSection editorial={{ heading: '', items: [] }} />),
    ).not.toContain('<button')
    expect(renderToStaticMarkup(<Hero editorial={{ heading: '', summary: '' }} />)).not.toContain(
      'O melhor do chopp',
    )
  })
  it('replaces institutional body without retaining the default historical assertion', () => {
    const html = renderToStaticMarkup(
      <AboutSection
        editorial={{ heading: 'Nossa história', body: 'Texto fornecido pelo administrador.' }}
      />,
    )
    expect(html).toContain('Texto fornecido pelo administrador.')
    expect(html).not.toContain('Fundado em')
    expect(html).not.toContain('Não entregamos latas')
    expect(html).toMatch(/keg-studio-30l[^"]*\.webp/)
  })
})

const ready = (
  variants: { code: string; label: string; volumeMl: number; priceCents: number }[],
): CatalogState => ({
  status: 'ready',
  catalog: parseExpandedCatalog({
    revision: 'p3-test',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [
          {
            id: 'p3-beer',
            name: 'Produto da API',
            description: 'Descrição da API',
            visible: true,
            variants,
          },
        ],
      },
    ],
  }),
})
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((link) => link[1])
describe('P3: editorial props cannot set commercial data or navigation', () => {
  for (const volumeMl of [750, 1500, 20000, 30000, 50000]) {
    it(`preserves API volume ${volumeMl} and its WhatsApp message`, () => {
      const previous = contact.whatsappNumber
      contact.whatsappNumber = '5532999999999' // Disposable test number; never production configuration.
      try {
        const state = ready([
          { code: 'api-variant', label: 'Apresentação API', volumeMl, priceCents: 12345 },
        ])
        const before = renderToStaticMarkup(<BarrelsSection state={state} />)
        const after = renderToStaticMarkup(
          <BarrelsSection
            state={state}
            editorial={{ heading: 'Editorial', lead: 'Somente texto' }}
          />,
        )
        expect(hrefs(after)).toEqual(hrefs(before))
        const message = new URL(
          hrefs(after).find((href) => href.startsWith('https://wa.me/')) ?? '',
        ).searchParams.get('text')
        expect(message).toContain('Produto da API')
        expect(after).toContain(formatBRL(123.45))
        expect(message).toContain(
          volumeMl === 750 ? '750 ml' : volumeMl === 1500 ? '1,5L' : `${volumeMl / 1000}L`,
        )
      } finally {
        contact.whatsappNumber = previous
      }
    })
  }
  it('preserves variants with duplicate volumes, mixed sizes and fallback catalog', () => {
    const state = ready([
      { code: '20-a', label: '20 L A', volumeMl: 20000, priceCents: 10000 },
      { code: '20-b', label: '20 L B', volumeMl: 20000, priceCents: 12000 },
      { code: '30', label: '30 L', volumeMl: 30000, priceCents: 20000 },
      { code: '50', label: '50 L', volumeMl: 50000, priceCents: 30000 },
    ])
    const html = renderToStaticMarkup(
      <CatalogSection
        state={state}
        retry={() => {}}
        editorial={{ heading: 'Editorial', intro: 'Apresentações reais' }}
      />,
    )
    // 30/50 L ficam na tabela aprovada; as demais apresentações, na lista complementar (sem repetir).
    for (const amount of [100, 120]) expect(html).toContain(formatBRL(amount))
    for (const amount of [200, 300]) expect(html).toContain(formatBRL(amount, { cents: false }))
    expect(html).toContain('20 L A')
    expect(html).toContain('20 L B')
    expect(html).not.toContain('Tabela Comparativa de Litragens')
  })
  it('keeps Hero commercial minimum, fixed CTAs and source images', () => {
    const state = ready([{ code: '50', label: '50 L', volumeMl: 50000, priceCents: 30000 }])
    const content = {
      heading: 'Título editorial',
      summary: 'Resumo editorial',
      priceCents: 1,
      volumeMl: 1,
      whatsappNumber: 'invalid',
      imageSrc: 'javascript:alert(1)',
    }
    const before = renderToStaticMarkup(<Hero state={state} />)
    const after = renderToStaticMarkup(<Hero state={state} editorial={content} />)
    expect(after).toContain(formatBRL(300))
    expect(hrefs(after)).toEqual(hrefs(before))
    expect(after).toContain('href="#barris"')
    expect(after).toContain('href="#chopes"')
    expect(after).toMatch(/keg-hero-50l[^"]*\.webp/)
    expect(after).toContain('18+')
  })
})
