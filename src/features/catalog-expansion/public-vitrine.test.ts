import { describe, expect, it } from 'vitest'
import type { PublicCatalog } from '../../../shared/catalog'
import { parseExpandedCatalog } from '../catalog/expanded-api'
import {
  buildCachacaWhatsAppMessage,
  formatBottleLabel,
  normalizeCachacaName,
} from './CachacasShowcase'
import { centsToReaisSafe, formatPriceFromCents, getVisibleCatalog } from './types'

describe('Vitrine Pública Conectada à API Real (F3C.3)', () => {
  const mockRealApiResponse = (): PublicCatalog => ({
    revision: 'r42-live-contract',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [
          {
            id: 'dronken',
            name: 'Dronken',
            description: 'Double Double',
            visible: true,
            variants: [
              { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 51000 },
              { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: 65000 },
            ],
          },
          {
            id: 'brahma',
            name: 'Brahma',
            description: 'Chopp clássico',
            visible: true,
            variants: [
              { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: null },
              { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: 89000 },
            ],
          },
          {
            id: 'chope-especial-4-tamanhos',
            name: 'Chope Especial',
            description: 'Artesanal com 4 opções',
            visible: true,
            variants: [
              { code: '7.5', label: 'Barril de 7,5 L', volumeMl: 7500, priceCents: 18000 },
              { code: '20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 35000 },
              { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 52000 },
              { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: 75000 },
            ],
          },
        ],
      },
      {
        id: 'cachacas',
        name: 'Cachaças',
        items: [
          {
            id: 'cachaca',
            name: 'Temos cachaça',
            description: 'Conservada em barril de umburana com jequitibá rosa',
            visible: true,
            variants: [{ code: 'bottle', label: 'Garrafa', volumeMl: 700, priceCents: 3000 }],
          },
        ],
      },
      {
        id: 'categoria-vazia-teste',
        name: 'Categoria Vazia',
        items: [],
      },
    ],
  })

  it('consome o contrato real da API pública preservando integridade das categorias e itens', () => {
    const raw = mockRealApiResponse()
    const parsed = parseExpandedCatalog(raw)

    expect(parsed.expanded.revision).toBe('r42-live-contract')
    expect(parsed.expanded.categories).toHaveLength(3)

    // Chopes
    const chopes = parsed.expanded.categories.find((c) => c.id === 'chopes')
    expect(chopes).toBeDefined()
    expect(chopes?.items.find((i) => i.id === 'dronken')?.variants[0].priceCents).toBe(51000)
    expect(chopes?.items.find((i) => i.id === 'brahma')?.variants[0].priceCents).toBeNull()

    // Cachaça com formato retornado pelo D1
    const cachacas = parsed.expanded.categories.find((c) => c.id === 'cachacas')
    const realCachaca = cachacas?.items[0]
    expect(realCachaca?.id).toBe('cachaca')
    expect(realCachaca?.variants[0].volumeMl).toBe(700)
    expect(realCachaca?.variants[0].priceCents).toBe(3000)
  })

  it('filtra rigorosamente produtos com visible: false e categorias vazias sem expor fixtures', () => {
    const raw = mockRealApiResponse()
    raw.categories[0].items.push({
      id: 'chope-oculto-sazonal',
      name: 'Chope Oculto',
      description: 'Não deve aparecer na vitrine',
      visible: false,
      variants: [{ code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 60000 }],
    })
    const visibleCatalog = getVisibleCatalog(raw, {
      includeHidden: false,
      omitEmptyCategories: true,
    })

    // Categoria vazia omitida
    expect(visibleCatalog.map((c) => c.id)).not.toContain('categoria-vazia-teste')
    expect(visibleCatalog.map((c) => c.id)).toEqual(['chopes', 'cachacas'])

    // Item oculto omitido
    const chopes = visibleCatalog.find((c) => c.id === 'chopes')
    expect(chopes?.items.some((i) => i.id === 'chope-oculto-sazonal')).toBe(false)
    expect(chopes?.items).toHaveLength(3)
  })

  it('preserva preços em centavos inteiros e trata variantes com preço null como não compráveis', () => {
    const raw = mockRealApiResponse()
    const brahma = raw.categories[0].items.find((i) => i.id === 'brahma')
    const brahma30 = brahma?.variants.find((v) => v.code === '30')

    expect(brahma30?.priceCents).toBeNull()
    expect(centsToReaisSafe(brahma30?.priceCents)).toBeNull()
    expect(formatPriceFromCents(brahma30?.priceCents)).toBe('—')

    const brahma50 = brahma?.variants.find((v) => v.code === '50')
    expect(brahma50?.priceCents).toBe(89000)
    expect(centsToReaisSafe(brahma50?.priceCents)).toBe(890)
    expect(formatPriceFromCents(brahma50?.priceCents)).toBe('R$ 890')
  })

  it('suporta chope com mais de 2 variantes (7,5 L, 20 L, 30 L, 50 L) com centavos inteiros', () => {
    const raw = mockRealApiResponse()
    const especial = raw.categories[0].items.find((i) => i.id === 'chope-especial-4-tamanhos')

    expect(especial?.variants).toHaveLength(4)
    expect(especial?.variants.map((v) => v.volumeMl)).toEqual([7500, 20000, 30000, 50000])
    expect(especial?.variants.map((v) => formatPriceFromCents(v.priceCents))).toEqual([
      'R$ 180',
      'R$ 350',
      'R$ 520',
      'R$ 750',
    ])
  })

  it('normaliza a identificação da cachaça real vinda da API ("Temos cachaça" -> "Cachaça") e formata 700 ml', () => {
    expect(normalizeCachacaName('Temos cachaça')).toBe('Cachaça')
    expect(normalizeCachacaName('Temos cachaca')).toBe('Cachaça')
    expect(normalizeCachacaName('Cachaça')).toBe('Cachaça')
    expect(normalizeCachacaName('Cachaça Prata (Demonstração)')).toBe('Cachaça Prata')

    // Rótulo da garrafa
    expect(formatBottleLabel({ label: 'Garrafa', volumeMl: 700 })).toBe('Garrafa 700 ml')
    expect(formatBottleLabel({ label: 'Garrafa 700 ml', volumeMl: 700 })).toBe('Garrafa 700 ml')
    expect(formatBottleLabel({ label: 'Garrafa', volumeMl: 1000 })).toBe('Garrafa 1.000 ml')

    // Mensagem de WhatsApp com os dados comerciais reais da cachaça Delegas
    const msg = buildCachacaWhatsAppMessage('Temos cachaça', {
      label: 'Garrafa',
      volumeMl: 700,
      priceCents: 3000,
    })
    expect(msg).toBe('Olá! Gostaria de pedir uma garrafa de Cachaça 700 ml por R$ 30,00.')
  })
})
