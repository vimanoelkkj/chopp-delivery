import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { contact } from '@/features/contact/config'
import { CatalogSection } from '@/pages/landing/sections/CatalogSection'
import { formatBRL } from '@/shared/lib/format'
import { BarrelCarousel3D } from './BarrelCarousel3D'
import { parseExpandedCatalog } from './expanded-api'
import {
  chopesNote,
  labelMentionsVolume,
  type PublicItem,
  presentationText,
  splitChopes,
} from './presentation'
import type { CatalogState } from './useCatalog'

type V = { code: string; label: string; volumeMl: number; priceCents: number | null }
const std = (id: string, name: string, p30: number | null, p50: number | null): PublicItem => ({
  id,
  name,
  description: `Descrição ${name}`,
  visible: true,
  variants: [
    { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: p30 },
    { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: p50 },
  ],
})
const item = (id: string, name: string, variants: V[]): PublicItem => ({
  id,
  name,
  description: `Descrição ${name}`,
  visible: true,
  variants,
})
const bottle = (id: string, name: string, priceCents: number): PublicItem =>
  item(id, name, [{ code: 'bottle', label: 'Garrafa', volumeMl: 700, priceCents }])

const ORIGINAL = [
  std('dronken', 'Dronken', 51000, 65000),
  std('palato-beber', 'Palato Beber', 49000, 64000),
  std('villa-alema', 'Villa Alemã', 52000, 67000),
  std('krug-bier', 'Krug Bier', 57000, 76000),
  std('brahma', 'Brahma', null, 89000),
  std('kaiser', 'Kaiser', null, 89000),
  std('heineken', 'Heineken', null, 99000),
  std('chopp-de-vinho', 'Chopp de vinho', 57000, 79000),
]
const TWENTY_FORTY = item('item_new', 'Teste 20 e 40', [
  { code: 'v_20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 25000 },
  { code: 'v_40', label: 'Barril de 40 L', volumeMl: 40000, priceCents: 45000 },
])

const stateOf = (chopes: PublicItem[], cachacas: PublicItem[] = []): CatalogState => ({
  status: 'ready',
  catalog: parseExpandedCatalog({
    revision: 'r1',
    categories: [
      { id: 'chopes', name: 'Chopes', items: chopes },
      { id: 'cachacas', name: 'Cachaças', items: cachacas },
    ],
  }),
})
const render = (state: CatalogState) =>
  renderToStaticMarkup(<CatalogSection state={state} retry={() => {}} />)
const messages = (html: string) =>
  [...html.matchAll(/href="(https:\/\/wa\.me\/[^"\s]+)"/g)].map((m) =>
    new URL(m[1].replaceAll('&amp;', '&')).searchParams.get('text')?.replaceAll(' ', ' '),
  )
const count = (html: string, text: string) => html.split(text).length - 1

describe('F4A.5.2: vitrine comercial dinâmica', () => {
  const previous = contact.whatsappNumber
  beforeEach(() => {
    contact.whatsappNumber = '5531999990000'
  })
  afterEach(() => {
    contact.whatsappNumber = previous
  })

  it('catálogo original: tabela 30/50 L aprovada, sem lista complementar e com o texto comercial', () => {
    const html = render(stateOf(ORIGINAL))
    expect(html).toContain('<table')
    expect(count(html, '<tr class=')).toBe(8)
    expect(html).not.toContain('Outras apresentações')
    expect(html).not.toContain(' ml')
    expect(html).toContain(
      'Oito opções de chopp com preços por litragem. Chopeira profissional inclusa.',
    )
    // 8 produtos: 30 L em 5 (3 só vendem 50 L) + 50 L em 8 = 13 pedidos, todos pela tabela.
    expect(messages(html)).toHaveLength(13)
    expect(html).toContain('Indisponível')
  })

  it('produto novo 20 L e 40 L: as duas variantes, com preço, volume em litros e pedido correto', () => {
    const html = render(stateOf([...ORIGINAL, TWENTY_FORTY]))
    // O catálogo original continua na tabela, intacto.
    expect(count(html, '<tr class=')).toBe(8)
    expect(html).toContain('<table')
    // As novas variantes ficam na lista complementar, sem ml cru.
    expect(html).toContain('Barril de 20 L')
    expect(html).toContain('Barril de 40 L')
    expect(html).toContain(formatBRL(250))
    expect(html).toContain(formatBRL(450))
    expect(html).not.toContain('20000 ml')
    expect(html).not.toContain('Barril de 20 L · 20 L')
    const sent = messages(html)
    expect(sent).toHaveLength(15)
    expect(sent).toContain(
      'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de Teste 20 e 40 (Barril de 20 L). Quantidade: 1 unidade. Preço unitário: R$ 250. Total: R$ 250.',
    )
    expect(sent.some((m) => m?.includes('Teste 20 e 40 (Barril de 40 L)'))).toBe(true)
  })

  it('produto 30/50 L com variante adicional de 20 L: nada se perde nem se repete', () => {
    const mixed = item('mix', 'Misto', [
      { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 40000 },
      { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: 60000 },
      { code: 'v_20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 30000 },
    ])
    const { table, extras } = splitChopes([mixed])
    expect(table).toHaveLength(1)
    expect(table[0].prices).toEqual({ 30: 400, 50: 600 })
    expect(extras).toHaveLength(1)
    expect(extras[0].variants.map((v) => v.code)).toEqual(['v_20'])
    const html = render(stateOf([mixed]))
    expect(html).toContain('Outras apresentações')
    const sent = messages(html)
    expect(sent).toHaveLength(3)
    expect(sent.filter((m) => m?.includes('(30L)'))).toHaveLength(1)
    expect(sent.filter((m) => m?.includes('(50L)'))).toHaveLength(1)
    expect(sent.filter((m) => m?.includes('(Barril de 20 L)'))).toHaveLength(1)
  })

  it('variante com o mesmo volume de 30/50 L mas outro código não é fundida na tabela', () => {
    const odd = item('odd', 'Duplo', [
      { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 40000 },
      { code: 'promo', label: 'Promo 30 L', volumeMl: 30000, priceCents: 35000 },
    ])
    const { table, extras } = splitChopes([odd])
    expect(table[0].prices[30]).toBe(400)
    expect(extras[0].variants.map((v) => v.code)).toEqual(['promo'])
  })

  it('variante sem preço não gera pedido e não esconde as demais', () => {
    const partial = item('partial', 'Parcial', [
      { code: 'v_20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 25000 },
      { code: 'v_40', label: 'Barril de 40 L', volumeMl: 40000, priceCents: null },
    ])
    const html = render(stateOf([partial]))
    expect(html).toContain('Não comercializado')
    expect(messages(html)).toHaveLength(1)
    expect(html).toContain('Barril de 40 L')
  })

  it('produto oculto nunca entra em nenhuma das duas apresentações', () => {
    const hidden = { ...std('oculto', 'Oculto', 1000, 2000), visible: false }
    const { table, extras } = splitChopes([hidden, TWENTY_FORTY])
    expect(table).toEqual([])
    expect(extras.map((i) => i.id)).toEqual(['item_new'])
  })

  it('30/50 L sem preço, com outra variante vendida: nenhuma variante some', () => {
    const only20 = item('so20', 'Só 20', [
      { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: null },
      { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: null },
      { code: 'v_20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 25000 },
    ])
    const { table, extras } = splitChopes([only20])
    expect(table).toEqual([])
    expect(extras[0].variants).toHaveLength(3)
  })

  it('várias cachaças: um banner e uma mensagem independentes para cada uma', () => {
    const html = render(
      stateOf(ORIGINAL, [
        bottle('c1', 'Cachaça Um', 9000),
        bottle('c2', 'Cachaça Dois', 12000),
        bottle('c3', 'Cachaça Três', 15000),
      ]),
    )
    const sent = messages(html).filter((m) => m?.includes('Cachaça'))
    expect(sent).toHaveLength(3)
    expect(new Set(sent).size).toBe(3)
    expect(sent[1]).toContain('Cachaça Dois')
    expect(sent[1]).toContain('R$ 120,00')
  })

  it('volumes em litros, inclusive fracionários, sem ml cru', () => {
    const html = render(
      stateOf([
        item('frac', 'Especial', [
          { code: 'a', label: 'Edição', volumeMl: 20500, priceCents: 30000 },
          { code: 'b', label: 'Mini', volumeMl: 750, priceCents: 5000 },
        ]),
      ]),
    )
    expect(html).toContain('20,5 L')
    expect(html).toContain('750 ml')
    expect(html).not.toContain('20500')
  })

  it('texto da seção vem da contagem real, sem número fixo', () => {
    expect(chopesNote(8)).toMatch(/^Oito opções de chopp/)
    expect(chopesNote(3)).toMatch(/^Três opções/)
    expect(chopesNote(1)).toMatch(/^Uma opção de chopp/)
    expect(chopesNote(13)).toMatch(/^13 opções/)
    expect(chopesNote(null)).toBe('Consulte os valores dos barris de 30 e de 50 litros.')
    expect(chopesNote(0)).not.toContain('0 ')
  })
})

describe('F4A.5.2: rótulos e apresentação', () => {
  it.each([
    ['Barril de 20 L', 20000, true],
    ['Garrafa 750ml', 750, true],
    ['Growler 1,5 L', 1500, true],
    ['Growler PET', 1500, false],
    ['Barril de 120 L', 20000, false],
    ['Barril', null, false],
  ])('labelMentionsVolume(%s, %s) = %s', (label, ml, expected) => {
    expect(labelMentionsVolume(label, ml)).toBe(expected)
  })

  it('presentationText mantém 30L/50L e não repete o volume', () => {
    expect(presentationText('Barril de 30 L', 30000)).toBe('30L')
    expect(presentationText('50', 50000)).toBe('50L')
    expect(presentationText('Barril de 20 L', 20000)).toBe('Barril de 20 L')
    expect(presentationText('Growler PET', 1500)).toBe('Growler PET - 1,5L')
  })
})

describe('F4A.5.2: carrossel', () => {
  const carousel = (items: PublicItem[]) => renderToStaticMarkup(<BarrelCarousel3D items={items} />)

  it('rótulo da variante não repete o volume, nem no pedido', () => {
    const previous = contact.whatsappNumber
    contact.whatsappNumber = '5531999990000'
    try {
      const html = carousel([TWENTY_FORTY])
      expect(html).toContain('Barril de 20 L')
      expect(html).not.toContain('Barril de 20 L (20L)')
      const text = decodeURIComponent(html.match(/wa\.me\/\d+\?text=([^"&]+)/)?.[1] ?? '')
      expect(text).toContain('(Barril de 20 L)')
      expect(text).not.toContain('20 L - 20L')
    } finally {
      contact.whatsappNumber = previous
    }
  })

  it('produto sem foto própria usa a silhueta neutra, nunca a foto de outro produto', () => {
    const html = carousel([TWENTY_FORTY])
    expect(html).toContain('data-keg-placeholder')
    expect(html).not.toMatch(/keg-(hero-50l|studio-30l)/)
  })

  it('a foto acompanha a identidade do produto, não a posição no carrossel', () => {
    const photos = (items: PublicItem[]) =>
      Object.fromEntries(
        [
          ...carousel(items).matchAll(
            /src="[^"]*keg-(hero-50l|studio-30l)[^"]*"[^>]*alt="Barril de Chopp ([^"]*?) em/g,
          ),
        ].map((m) => [m[2], m[1]]),
      )
    const dronken = std('dronken', 'Dronken', 51000, 65000)
    const krug = std('krug-bier', 'Krug Bier', 57000, 76000)
    const expected = { Dronken: 'studio-30l', 'Krug Bier': 'hero-50l' }
    expect(photos([dronken, krug])).toEqual(expected)
    expect(photos([krug, dronken])).toEqual(expected)
  })
})
