import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCachacaWhatsAppMessage, formatBottleLabel } from './CachacasShowcase'
import { buildCatalogWhatsAppMessage, formatVariantLabel } from './messages'
import type { PublicCatalogV2 } from './types'
import {
  bottlePresentation,
  formatPresentation,
  labelStatesVolume,
  volumeLabelIssue,
  volumesInLabel,
} from './volume'

/**
 * Auditoria F3C.5, P2.1: "Barril -20 L" era lido como 20 L (o parser ignorava o sinal) e o rótulo
 * passava sem o volume canônico. Um volume com sinal negativo NUNCA equivale a um volume positivo.
 * O rótulo persistido não é "corrigido": aparece literalmente, junto do volume canônico do servidor.
 */
const NBSP = ' '

// hífen-menos, hífen Unicode, hífen não separável, figura, en, em, barra horizontal, menos
// matemático, hífen-menos pequeno e de largura total
const MINUS_SIGNS = ['-', '‐', '‑', '‒', '–', '—', '―', '−', '﹣', '－']

describe('volumes negativos nunca equivalem a volumes positivos', () => {
  it.each(MINUS_SIGNS.map((sign) => [`${sign}20 L`, sign]))(
    'sinal %j colado ao número: "Barril %s" não declara 20 L',
    (_label, sign) => {
      expect(volumesInLabel(`Barril ${sign}20 L`)).toEqual([])
      expect(labelStatesVolume(`Barril ${sign}20 L`, 20000)).toBe(false)
    },
  )

  it.each([
    ['Barril -20 L', 20000],
    ['Barril - 20 L', 20000], // sinal separado por espaço
    ['Barril -  20 L', 20000], // dois espaços
    ['Barril -\t20 L', 20000], // tabulação
    [`Barril${NBSP}-${NBSP}20${NBSP}L`, 20000], // espaço não separável
    ['Barril -​20 L', 20000], // caractere de largura zero
    ['-20 L', 20000], // no início do rótulo
    ['Barril (-20 L)', 20000], // entre parênteses
    ['Barril -20L', 20000], // sem espaço antes da unidade
    ['Barril -20 l', 20000],
    ['Barril -20 litros', 20000],
    ['Barril -20 Litro', 20000],
    ['Barril -20 lts', 20000],
    ['Barril -7,5 L', 7500], // decimal com vírgula
    ['Barril -7.5 L', 7500], // decimal com ponto
    ['Barril -0,33 l', 330],
    ['Garrafa -700 ml', 700],
    ['Garrafa - 700 ml', 700],
    ['Garrafa -700ml', 700],
    ['Garrafa -1000 ml', 1000],
    ['Garrafa -1.000 ml', 1000], // milhar
    ['Garrafa -1,5 L', 1500],
    ['Barril -1.234,5 L', 1234500],
    ['Barril a-20 L', 20000], // sinal colado à palavra: ainda sem equivalência
  ])('"%s" não equivale a %i ml', (label, ml) => {
    expect(labelStatesVolume(label, ml)).toBe(false)
  })

  it('um volume positivo no mesmo rótulo continua valendo; o negativo, não', () => {
    expect(volumesInLabel('Barril -20 L (20 L)')).toEqual([20000])
    expect(labelStatesVolume('Barril -20 L (20 L)', 20000)).toBe(true)
    expect(volumesInLabel('Barril -30 L e 20 L')).toEqual([20000])
  })

  it('formatos positivos já suportados não mudam', () => {
    for (const [label, ml] of [
      ['Barril de 30 L', 30000],
      ['Barril 7.5 L', 7500],
      ['Barril 7,5L', 7500],
      ['Garrafa 700 ml', 700],
      ['Garrafa 1.000 ml', 1000],
      ['Garrafa 1000 ml', 1000],
      ['Barril 20 L - promoção', 20000], // hífen DEPOIS da quantidade
    ] as const) {
      expect(labelStatesVolume(label, ml)).toBe(true)
    }
  })

  it('única mudança de comportamento de propósito: hífen com espaços ANTES do número', () => {
    // "Barril especial - 20 L" é indistinguível de um sinal negativo ("- 20 L"); a regra é nunca
    // aceitar sinal. Custo: o volume canônico é acrescentado (redundante, mas nunca errado).
    expect(labelStatesVolume('Barril especial - 20 L', 20000)).toBe(false)
    expect(formatPresentation({ label: 'Barril especial - 20 L', volumeMl: 20000 }, 'L')).toBe(
      'Barril especial - 20 L · 20 L',
    )
  })
})

describe('apresentação e mensagem tratam o negativo como volume NÃO informado', () => {
  it('o volume canônico do servidor é acrescentado e o rótulo literal é preservado', () => {
    expect(formatPresentation({ label: 'Barril -20 L', volumeMl: 20000 }, 'L')).toBe(
      'Barril -20 L · 20 L',
    )
    expect(formatVariantLabel({ label: 'Barril −20 L', volumeMl: 20000 }, 'L')).toBe(
      'Barril −20 L · 20 L',
    )
    expect(formatBottleLabel({ label: 'Garrafa -700 ml', volumeMl: 700 })).toBe(
      'Garrafa -700 ml 700 ml',
    )
  })

  it('mensagem do chope: o negativo não satisfaz o volume, o canônico aparece', () => {
    const variant = { code: 'v_x', label: 'Barril -20 L', volumeMl: 20000, priceCents: 12345 }
    expect(buildCatalogWhatsAppMessage('Chope X', variant, 'L')).toBe(
      `Olá! Gostaria de pedir Chope X, Barril -20 L · 20 L, por R$${NBSP}123,45.`,
    )
  })

  it.each([
    ['Garrafa -700 ml', 'Garrafa -700 ml · 700 ml'],
    ['Garrafa - 700 ml', 'Garrafa - 700 ml · 700 ml'],
    ['Garrafa −700 ml', 'Garrafa −700 ml · 700 ml'],
  ])('mensagem da cachaça "%s"', (label, shown) => {
    expect(bottlePresentation({ label, volumeMl: 700 })).toBe(shown)
    expect(
      buildCachacaWhatsAppMessage('Cachaça Ouro', { label, volumeMl: 700, priceCents: 3000 }),
    ).toBe(`Olá! Gostaria de pedir uma garrafa de Cachaça Ouro ${shown} por R$${NBSP}30,00.`)
  })

  it('preço null continua sem mensagem, também com rótulo negativo', () => {
    expect(
      buildCatalogWhatsAppMessage(
        'X',
        { code: 'v', label: 'Barril -20 L', volumeMl: 20000, priceCents: null },
        'L',
      ),
    ).toBeNull()
  })
})

describe('volumeLabelIssue: inconsistência sinalizada, nunca corrigida', () => {
  it.each([
    ['Barril -20 L', 20000, 'negative'],
    ['Barril - 20 L', 20000, 'negative'],
    ['Garrafa −700 ml', 700, 'negative'],
    ['Barril -20 L (20 L)', 20000, 'negative'], // o negativo é lixo mesmo com o positivo ao lado
    ['Barril 30 L', 20000, 'mismatch'], // rótulo declara OUTRO volume positivo
    ['Garrafa 750 ml', 700, 'mismatch'],
    ['Barril de 30 L', 30000, null],
    ['Barril especial', 20000, null],
    ['Garrafa', 700, null],
    ['Barril -20 L', null, null], // sem volume canônico não há o que comparar
  ] as const)('"%s" com %s ml → %s', (label, volumeMl, issue) => {
    expect(volumeLabelIssue({ label, volumeMl })).toBe(issue)
  })
})

describe('caminho completo até o link do WhatsApp (renderização real da vitrine)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const catalog: PublicCatalogV2 = {
    revision: 'r1',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [
          {
            id: 'negativo',
            name: 'Chope Negativo',
            description: 'Chopp',
            visible: true,
            variants: [
              { code: 'v_a', label: 'Barril -20 L', volumeMl: 20000, priceCents: 12345 },
              { code: 'v_b', label: 'Barril 7,5 L', volumeMl: 7500, priceCents: 9900 },
            ],
          },
        ],
      },
      {
        id: 'cachacas',
        name: 'Cachaças',
        items: [
          {
            id: 'cachaca-neg',
            name: 'Cachaça Neg',
            description: 'Garrafa',
            visible: true,
            variants: [
              { code: 'bottle', label: 'Garrafa -700 ml', volumeMl: 700, priceCents: 3000 },
            ],
          },
        ],
      },
    ],
  }

  async function render() {
    vi.stubEnv('VITE_WHATSAPP_NUMBER', '5500000000000')
    vi.resetModules()
    const { ExpandableCatalogView } = await import('./ExpandableCatalogView')
    return renderToStaticMarkup(
      createElement(ExpandableCatalogView, { catalog, showCompliance: false }),
    )
  }

  const messages = (html: string) =>
    [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((match) =>
      new URL(match[1].replaceAll('&amp;', '&')).searchParams.get('text'),
    )

  it('o link só carrega o volume canônico e nunca trata -20 L como 20 L', async () => {
    const html = await render()
    const found = messages(html)
    // tabela (célula) e card mobile geram a mesma mensagem
    expect(found.filter((text) => text?.includes('Chope Negativo, Barril -20 L'))).toEqual([
      `Olá! Gostaria de pedir Chope Negativo, Barril -20 L · 20 L, por R$${NBSP}123,45.`,
      `Olá! Gostaria de pedir Chope Negativo, Barril -20 L · 20 L, por R$${NBSP}123,45.`,
    ])
    // o rótulo positivo da mesma linha continua sem duplicar o volume
    expect(found).toContain(
      `Olá! Gostaria de pedir Chope Negativo, Barril 7,5 L, por R$${NBSP}99,00.`,
    )
    expect(found).toContain(
      `Olá! Gostaria de pedir uma garrafa de Cachaça Neg Garrafa -700 ml · 700 ml por R$${NBSP}30,00.`,
    )
    expect(html).toContain('Barril -20 L · 20 L')
    expect(html).not.toMatch(/Barril -20 L(?! ·)/) // nunca "Barril -20 L" sem o canônico ao lado
  })

  it('a inconsistência fica sinalizada no DOM (data-volume-issue), sem texto novo para o cliente', async () => {
    const html = await render()
    expect(html).toContain('data-volume-issue="negative"')
    expect(html).not.toContain('data-volume-issue="mismatch"')
    // o atributo é só marcação: nada de aviso visível ao cliente
    expect(html).not.toMatch(/inconsist|inv[aá]lid/i)
  })
})
