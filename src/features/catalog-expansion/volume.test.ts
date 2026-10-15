import { describe, expect, it } from 'vitest'
import { buildCachacaWhatsAppMessage, formatBottleLabel } from './CachacasShowcase'
import { buildCatalogWhatsAppMessage, formatVariantLabel } from './messages'
import {
  bottlePresentation,
  formatPresentation,
  formatVolume,
  labelStatesVolume,
  volumesInLabel,
} from './volume'

const NBSP = ' '

describe('volumesInLabel: números com unidade, em ml e sem ponto flutuante', () => {
  it.each([
    ['Barril de 30 L', [30000]],
    ['Barril 7,5 L', [7500]],
    ['Barril 7.5 L', [7500]],
    ['Barril 7,5L', [7500]],
    ['Barril 0,33 l', [330]],
    ['Garrafa 700 ml', [700]],
    ['Garrafa 1000 ml', [1000]],
    ['Garrafa 1.000 ml', [1, 1000]], // decimal ou milhar: as duas leituras valem
    ['Garrafa 1,5 L', [1500]],
    ['Barril 1.234,5 L', [1234500]],
    ['Barril 20 litros', [20000]],
    ['Barril 20 lts', [20000]],
    ['Barril 120 L', [120000]],
    ['Garrafa', []],
    ['Barril especial', []],
    ['Chope 3 amigos', []], // número sem unidade
    ['Kit 2 Litrões', []], // "Litrões" é palavra, não unidade
  ])('%s', (label, expected) => {
    expect(volumesInLabel(label)).toEqual(expected)
  })
})

describe('labelStatesVolume: o volumeMl é a fonte de verdade', () => {
  it.each([
    ['Barril de 30 L', 30000, true],
    ['Barril 7.5 L', 7500, true],
    ['Barril 7,5 L', 7500, true],
    ['Garrafa 1000 ml', 1000, true],
    ['Garrafa 1.000 ml', 1000, true],
    ['Garrafa 1 L', 1000, true],
    ['Barril 120 L', 20000, false], // 120 contém "20", mas é outro volume
    ['Barril 30 L', 20000, false], // o rótulo declara OUTRO volume
    ['Garrafa 750 ml', 700, false],
    ['Garrafa', 700, false],
  ])('%s com %i ml → %s', (label, ml, expected) => {
    expect(labelStatesVolume(label, ml)).toBe(expected)
  })
})

describe('formatVolume: exato', () => {
  it.each([
    [20000, 'L', '20 L'],
    [7500, 'L', '7,5 L'],
    [330, 'L', '0,33 L'],
    [1, 'L', '0,001 L'],
    [1234567, 'L', '1.234,567 L'],
    [700, 'ml', '700 ml'],
    [1000, 'ml', '1.000 ml'],
  ] as const)('%i ml em %s → %s', (ml, unit, expected) => {
    expect(formatVolume(ml, unit)).toBe(expected)
  })
})

describe('apresentação sem volume duplicado (tabela, chips, cards)', () => {
  it.each([
    // [rótulo, ml, unidade, esperado]
    ['Barril de 30 L', 30000, 'L', 'Barril de 30 L'],
    ['Barril especial', 20000, 'L', 'Barril especial · 20 L'],
    ['Barril 7.5 L', 7500, 'L', 'Barril 7.5 L'], // antes: "Barril 7.5 L · 7,5 L"
    ['Barril 7,5L', 7500, 'L', 'Barril 7,5L'],
    ['Barril 120 L', 20000, 'L', 'Barril 120 L · 20 L'],
    ['Barril 30 L', 20000, 'L', 'Barril 30 L · 20 L'], // volumeMl manda: o volume real aparece
    ['Garrafa 1000 ml', 1000, 'ml', 'Garrafa 1000 ml'], // antes: "Garrafa 1000 ml · 1.000 ml"
    ['Garrafa 1.000 ml', 1000, 'ml', 'Garrafa 1.000 ml'],
    ['Garrafa 1 L', 1000, 'ml', 'Garrafa 1 L'],
    ['Garrafa', 1000, 'ml', 'Garrafa · 1.000 ml'],
    ['Sem volume', null, 'L', 'Sem volume'],
  ] as const)('%s + %s %s → %s', (label, volumeMl, unit, expected) => {
    expect(formatPresentation({ label, volumeMl }, unit)).toBe(expected)
    expect(formatVariantLabel({ label, volumeMl }, unit)).toBe(expected)
  })

  it('formatBottleLabel preserva as saídas aprovadas e não duplica', () => {
    expect(formatBottleLabel({ label: 'Garrafa', volumeMl: 700 })).toBe('Garrafa 700 ml')
    expect(formatBottleLabel({ label: 'Garrafa 700 ml', volumeMl: 700 })).toBe('Garrafa 700 ml')
    expect(formatBottleLabel({ label: 'Garrafa', volumeMl: 1000 })).toBe('Garrafa 1.000 ml')
    expect(formatBottleLabel({ label: 'Garrafa 1000 ml', volumeMl: 1000 })).toBe('Garrafa 1000 ml')
    expect(formatBottleLabel({ label: 'Garrafa 1,5 L', volumeMl: 1500 })).toBe('Garrafa 1,5 L')
    expect(formatBottleLabel({ label: 'Garrafa 750 ml', volumeMl: 700 })).toBe(
      'Garrafa 750 ml 700 ml',
    )
    expect(formatBottleLabel({ label: 'Garrafa', volumeMl: null })).toBe('Garrafa')
  })
})

describe('mensagens do WhatsApp', () => {
  const variant = (label: string, volumeMl: number | null, priceCents: number | null = 12345) => ({
    code: 'v_x',
    label,
    volumeMl,
    priceCents,
  })

  it('chope: igualdade exata, sem volume repetido', () => {
    expect(buildCatalogWhatsAppMessage('Chope X', variant('Barril especial', 20000), 'L')).toBe(
      `Olá! Gostaria de pedir Chope X, Barril especial · 20 L, por R$${NBSP}123,45.`,
    )
    expect(buildCatalogWhatsAppMessage('Chope X', variant('Barril 7.5 L', 7500), 'L')).toBe(
      `Olá! Gostaria de pedir Chope X, Barril 7.5 L, por R$${NBSP}123,45.`,
    )
    expect(
      buildCatalogWhatsAppMessage('Chope X', variant('Barril de 30 L', 30000, 51029), 'L'),
    ).toBe(`Olá! Gostaria de pedir Chope X, Barril de 30 L, por R$${NBSP}510,29.`)
  })

  it('preço null não gera pedido', () => {
    expect(buildCatalogWhatsAppMessage('Chope X', variant('Barril', 20000, null), 'L')).toBeNull()
    expect(buildCachacaWhatsAppMessage('Cachaça', variant('Garrafa', 700, null))).toBeNull()
  })

  it.each([
    ['Garrafa', 700, 'uma garrafa de Cachaça Ouro 700 ml por'],
    ['Garrafa 700 ml', 700, 'uma garrafa de Cachaça Ouro 700 ml por'],
    ['Garrafa', 1000, 'uma garrafa de Cachaça Ouro 1.000 ml por'],
    ['Garrafa 1000 ml', 1000, 'uma garrafa de Cachaça Ouro 1.000 ml por'], // antes: "Garrafa 1000 ml · 1.000 ml"
    ['Garrafa 1,5 L', 1500, 'uma garrafa de Cachaça Ouro 1.500 ml por'],
    ['Garrafa especial', 700, 'uma garrafa de Cachaça Ouro Garrafa especial · 700 ml por'],
    ['Garrafa especial 700 ml', 700, 'uma garrafa de Cachaça Ouro Garrafa especial 700 ml por'],
    ['Garrafa 750 ml', 700, 'uma garrafa de Cachaça Ouro Garrafa 750 ml · 700 ml por'],
  ])('cachaça "%s" + %i ml', (label, ml, expected) => {
    expect(buildCachacaWhatsAppMessage('Cachaça Ouro', variant(label, ml, 3000))).toBe(
      `Olá! Gostaria de pedir ${expected} R$${NBSP}30,00.`,
    )
  })

  it('cachaça sem volume mantém o comportamento anterior', () => {
    expect(bottlePresentation({ label: 'Garrafa premium', volumeMl: null })).toBe('premium')
  })
})
