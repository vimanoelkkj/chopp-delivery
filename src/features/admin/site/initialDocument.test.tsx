import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { deriveLayout } from '../../../../shared/cms/layout'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'
import { AboutSection } from '../../../pages/landing/sections/AboutSection'
import { BarrelsSection } from '../../../pages/landing/sections/BarrelsSection'
import { CatalogSection } from '../../../pages/landing/sections/CatalogSection'
import { ContactSection } from '../../../pages/landing/sections/ContactSection'
import { FaqSection } from '../../../pages/landing/sections/FaqSection'
import { Hero } from '../../../pages/landing/sections/Hero'
import { HowItWorks } from '../../../pages/landing/sections/HowItWorks'
import { PromoSection } from '../../../pages/landing/sections/PromoSection'
import { Ticker } from '../../../pages/landing/sections/Ticker'
import { buildInitialDocument, INITIAL_COPY, INITIAL_SECTION_COUNT } from './initialDocument'

// Os componentes são renderizados sem conteúdo editorial: o que mostram é o texto que o site usa hoje.
const html = (element: ReactElement) => renderToStaticMarkup(element)
const noop = () => {}

describe('documento inicial do CMS v2', () => {
  it('passa no validador do próprio servidor no modo `start` (carrossel visível)', () => {
    const result = parseCmsDocument(buildInitialDocument(), 'start')
    expect(result.fields).toBeUndefined()
    expect(result.value?.schemaVersion).toBe(2)
  })

  it('tem as seções esperadas, ids obrigatórios fixos e ids opcionais únicos no formato do contrato', () => {
    const document = buildInitialDocument()
    expect(document.modules).toHaveLength(INITIAL_SECTION_COUNT)
    expect(document.modules.map((m) => m.template)).toEqual([
      'hero',
      'carousel',
      'ticker',
      'catalog',
      'how',
      'about',
      'faq',
      'contact',
    ])
    const fixed = document.modules.filter((m) =>
      ['hero', 'catalog', 'contact'].includes(m.template),
    )
    expect(fixed.every((m) => m.id === m.template)).toBe(true)
    const optional = document.modules.filter((m) => !fixed.includes(m)).map((m) => m.id)
    expect(new Set(optional).size).toBe(optional.length)
    expect(optional.every((id) => /^module_[0-9a-f-]{36}$/.test(id))).toBe(true)
  })

  it('não inventa dados comerciais: vitrine sem barris, sem mídia, WhatsApp em branco, só entrega', () => {
    const document = buildInitialDocument()
    expect(document.commercial).toEqual({ fulfillmentMode: 'delivery', whatsappNumber: null })
    const carousel = document.modules.find((m) => m.template === 'carousel')
    expect(carousel?.content).toMatchObject({ entries: [], media: null })
    expect(JSON.stringify(document)).not.toMatch(/R\$|priceCents|volumeMl|variants/)
    expect(document.modules.every((m) => m.visible)).toBe(true)
  })

  it('gera o layout sem erros e ids novos a cada chamada (um documento por operação)', () => {
    const a = buildInitialDocument()
    const b = buildInitialDocument()
    expect(deriveLayout(a).diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(a.modules[1].id).not.toBe(b.modules[1].id)
  })

  it('cada texto é o que a homepage mostra hoje (nada foi inventado nem ficou desatualizado)', () => {
    const c = INITIAL_COPY
    const hero = html(<Hero />)
    expect(hero).toContain('O melhor do chopp.')
    expect(hero).toContain('Direto para o seu evento.')
    expect(c.hero.heading).toBe('O melhor do chopp. Direto para o seu evento.')
    expect(hero).toContain(c.hero.summary)

    const barrels = html(<BarrelsSection state={{ status: 'loading' }} />)
    expect(barrels).toContain(c.carousel.heading)
    expect(barrels).toContain(c.carousel.lead)

    const ticker = html(<Ticker />)
    for (const item of c.ticker) expect(ticker).toContain(item)

    const catalog = html(<CatalogSection state={{ status: 'loading' }} retry={noop} />)
    expect(catalog).toContain(c.catalog.heading)
    expect(catalog).toContain(c.catalog.intro)

    const how = html(<HowItWorks />)
    expect(how).toContain(c.how.heading)
    for (const step of c.how.steps) {
      expect(how).toContain(step.title)
      expect(how).toContain(step.body)
    }

    const about = html(<AboutSection />)
    expect(about).toContain(c.about.heading)
    expect(about).toContain(c.about.body)

    expect(html(<PromoSection />)).toBe('')
    expect(buildInitialDocument().modules.some((module) => module.template === 'highlight')).toBe(
      false,
    )

    const faq = html(<FaqSection />)
    expect(faq).toContain('Perguntas')
    expect(faq).toContain('frequentes')
    expect(c.faq.heading).toBe('Perguntas frequentes')

    const contact = html(<ContactSection ctaRef={noop} />)
    expect(contact).toContain('Bora')
    expect(contact).toContain('pedir?')
    expect(c.contact.heading).toBe('Bora pedir?')
    expect(contact).toContain(c.contact.body)
  })
})
