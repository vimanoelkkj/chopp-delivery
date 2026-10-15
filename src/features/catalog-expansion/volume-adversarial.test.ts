import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCachacaWhatsAppMessage } from './CachacasShowcase'
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
 * Auditoria F3C.5 (2ª rodada): a regex anterior enumerava alguns invisíveis entre o sinal e o número
 * e foi contornada por U+2063 (separador invisível), U+200E/U+200F (marcas de direção) e outros
 * caracteres de formato. O reconhecimento agora é uma GRAMÁTICA ESTRITA de allowlist: uma quantidade
 * só vale se o que a precede é "limpo"; qualquer outra coisa (sinal, invisível, marca, símbolo) a
 * torna não reconhecida, e o volume canônico (`volumeMl`) aparece ao lado. Nada é removido nem
 * "normalizado" para transformar um rótulo negativo em positivo.
 */
const NBSP = ' '
const INVISIBLE_SEPARATOR = '⁣'
const LRM = '‎'
const RLM = '‏'

describe('contraexemplos do auditor: invisíveis entre o sinal e o número', () => {
  it.each([
    [`Barril -${INVISIBLE_SEPARATOR} 20 L`],
    [`Barril -${INVISIBLE_SEPARATOR}20 L`],
    [`Barril -${LRM}20 L`],
    [`Barril -${LRM} 20 L`],
    [`Barril -${RLM}20 L`],
    [`Barril -${RLM} 20 L`],
    [`Barril -${INVISIBLE_SEPARATOR}${LRM}${RLM} 20 L`],
    [`Barril -${LRM}${INVISIBLE_SEPARATOR}${RLM}20 L`],
    [`Barril −${INVISIBLE_SEPARATOR} 20 L`], // menos matemático
    [`Barril –${LRM}20 L`], // en dash
    [`Barril —${RLM}20 L`], // em dash
    [`Barril ${LRM}-20 L`], // marca ANTES do sinal
    [`Barril ${RLM}-${INVISIBLE_SEPARATOR}20 L`],
    ['Barril -\u115F 20 L'], // letras Hangul invisíveis (Default_Ignorable_Code_Point)
    ['Barril -\u1160 20 L'],
    ['Barril -\u3164 20 L'],
    ['Barril -\uFFA0 20 L'],
    ['Barril -­20 L'], // hífen opcional (soft hyphen)
    ['Barril -᠎20 L'], // separador mongol de vogal
    ['Barril -⁠ 20 L'], // word joiner
    ['Barril -﻿20 L'], // BOM / ZWNBSP
    ['Barril - 20 L'], // NBSP estreito
    ['Barril -  20 L'], // em space
    ['Barril -　 20 L'], // espaço ideográfico
    ['Barril -\u0085 20 L'], // NEL
    ['Barril -  20 L'], // separador de linha
    ['Barril -́ 20 L'], // acento combinante após o sinal
    ['Barril -\u0000 20 L'], // NUL
    ['Barril -\u001F20 L'], // controle
    ['Barril -️ 20 L'], // seletor de variação
    [`Barril -${String.fromCodePoint(0xe0001)} 20 L`], // caractere de etiqueta (plano 14)
    [`Barril -${String.fromCodePoint(0x1d173)}20 L`], // formato musical (plano 1)
    ['Barril －​20 L'], // menos de largura total + ZWSP
    ['Barril ﹣‌20 L'], // hífen pequeno + ZWNJ
  ])('%j nunca equivale a 20 L', (label) => {
    expect(volumesInLabel(label)).toEqual([])
    expect(labelStatesVolume(label, 20000)).toBe(false)
    expect(formatPresentation({ label, volumeMl: 20000 }, 'L')).toBe(`${label} · 20 L`)
    expect(volumeLabelIssue({ label, volumeMl: 20000 })).toBe('negative')
  })

  it('nada é removido para "consertar" o rótulo: o literal permanece e o canônico vem ao lado', () => {
    const label = `Barril -${INVISIBLE_SEPARATOR} 20 L`
    expect(formatVariantLabel({ label, volumeMl: 20000 }, 'L')).toBe(`${label} · 20 L`)
    expect(
      buildCatalogWhatsAppMessage(
        'Chope X',
        { code: 'v', label, volumeMl: 20000, priceCents: 12345 },
        'L',
      ),
    ).toBe(`Olá! Gostaria de pedir Chope X, ${label} · 20 L, por R$${NBSP}123,45.`)
  })
})

describe('valores ambíguos não suprimem o volume canônico', () => {
  it.each([
    ['Barril 1.2.3,4 L', 123400],
    ['Barril 12.34,5 L', 1234500],
    ['Barril 1,2,3.4 L', 123400],
    ['Barril 1.234,5.6 L', 12345600],
  ])('numeração malformada %j não equivale a %i ml', (label, volumeMl) => {
    const variant = { code: 'v', label, volumeMl, priceCents: 12345 }
    expect(labelStatesVolume(label, volumeMl)).toBe(false)
    expect(volumeLabelIssue(variant)).toBe('ambiguous')
    expect(formatPresentation(variant, 'L')).toContain(`${label} · `)
    expect(buildCatalogWhatsAppMessage('Chope X', variant, 'L')).toContain(`${label} · `)
  })

  it.each([
    [`Barril ${INVISIBLE_SEPARATOR} 20 L`], // invisível sem sinal
    [`Barril${LRM} 20 L`],
    [`Barril ${RLM}20 L`],
    ['Barril ​20 L'],
    ['Barril ­20 L'],
    ['Barril +20 L'], // sinal explícito: também não se presume
    ['Barril ~20 L'],
    ['Barril *20 L'],
    ['Barril a20 L'], // colado a letra
    ['Barril .20 L'], // colado a ponto
    ['Barril 10-20 L'], // faixa
    ['Barril ２０ L'], // dígitos de largura total (não são ASCII)
    ['Barril ٢٠ L'], // dígitos arábico-índicos
    [`Barril 20${INVISIBLE_SEPARATOR} L`], // invisível entre número e unidade
    [`Barril 20 L${LRM}`], // marca logo após a unidade
    ['Barril 20 Ĺ'], // acento combinante colado à unidade
    ['Barril 20 LL'], // unidade colada a outra letra
    ['Barril 20 ℓ'], // símbolo de litro Unicode, não a unidade ASCII
  ])('%j não é reconhecido', (label) => {
    expect(labelStatesVolume(label, 20000)).toBe(false)
    expect(formatPresentation({ label, volumeMl: 20000 }, 'L')).toBe(`${label} · 20 L`)
  })

  it('valores positivos inequívocos continuam reconhecidos', () => {
    for (const [label, ml] of [
      ['Barril de 30 L', 30000],
      ['20 L', 20000],
      ['Barril 20 L', 20000],
      ['Barril  20  L', 20000], // espaços ASCII repetidos
      [`Barril${NBSP}20${NBSP}L`, 20000],
      ['Barril\t20 L', 20000],
      ['Barril 20L', 20000],
      ['Barril 20 l', 20000],
      ['Barril 20 LITROS', 20000],
      ['Barril 20 lts', 20000],
      ['Barril 7,5 L', 7500],
      ['Barril 7.5 L', 7500],
      ['Garrafa 1.000 ml', 1000],
      ['Garrafa 1000 mL', 1000],
      ['Garrafa 700 ML', 700],
      ['Volume: 20 L', 20000],
      ['Barril (20 L)', 20000],
      ['Barril [20 L]', 20000],
      ['Barril / 20 L', 20000],
      ['Barril | 20 L', 20000],
      ['Kit 6 x 350 ml', 350],
      ['Barril 20 L - promoção', 20000],
      ['Barril 30 L ou 20 L', 20000],
    ] as const)
      expect(labelStatesVolume(label, ml), label).toBe(true)
  })
})

describe('volumeLabelIssue: sinaliza sem corrigir', () => {
  it.each([
    [`Barril -${INVISIBLE_SEPARATOR} 20 L`, 'negative'],
    [`Barril -${LRM}20 L`, 'negative'],
    ['Barril -20 L', 'negative'],
    [`Barril ${INVISIBLE_SEPARATOR} 20 L`, 'ambiguous'],
    ['Barril +20 L', 'ambiguous'],
    ['Barril 10-20 L', 'ambiguous'],
    ['Barril 30 L', 'mismatch'],
    ['Barril de 20 L', null],
    ['Barril especial', null],
  ] as const)('%j → %s', (label, issue) => {
    expect(volumeLabelIssue({ label, volumeMl: 20000 })).toBe(issue)
  })

  it('um volume negativo prevalece sobre um positivo ao lado (o rótulo continua suspeito)', () => {
    expect(volumeLabelIssue({ label: `Barril -${LRM}30 L (20 L)`, volumeMl: 20000 })).toBe(
      'negative',
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Varredura exaustiva: nenhuma classe de caractere "esquecida". Para CADA ponto de código do BMP e
// dos planos 1 e 14, o resultado é decidido pela allowlist, não por uma lista de invisíveis.
// ---------------------------------------------------------------------------------------------
const codePoints = (): string[] => {
  const out: string[] = []
  const range = (from: number, to: number) => {
    for (let code = from; code <= to; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue // surrogates soltos não são caracteres
      out.push(String.fromCodePoint(code))
    }
  }
  range(0x0000, 0xffff)
  range(0x10000, 0x1ffff)
  range(0xe0000, 0xe01ff)
  return out
}
const ALL = codePoints()
const LETTER_OR_DIGIT = /^(?!\p{Default_Ignorable_Code_Point})[\p{L}\p{N}]$/u
const SPACING = new Set([' ', '\t', NBSP])
const NEUTRAL = new Set(['(', '[', '{', ')', ']', '}', ':', ';', ',', '.', '/', '|', '·'])
// Pode vir COLADO ao número sem tornar a quantidade ambígua ('.' e ',' colados fariam parte do número).
const GLUE_OK = new Set([
  ...SPACING,
  ...[...NEUTRAL].filter((char) => char !== '.' && char !== ','),
])
const says = (label: string) => labelStatesVolume(label, 20000)

describe('varredura exaustiva de pontos de código (BMP + planos 1 e 14)', () => {
  it('cobre a faixa esperada', () => {
    expect(ALL.length).toBeGreaterThan(129000)
  })

  it('"Barril -<c>20 L": nenhum caractere entre o sinal e o número devolve um valor positivo', () => {
    const leaks = ALL.filter((c) => says(`Barril -${c}20 L`))
    expect(leaks.map((c) => c.codePointAt(0)?.toString(16))).toEqual([])
  })

  it('"Barril <c>-20 L": nenhum caractere antes do sinal ajuda', () => {
    const leaks = ALL.filter((c) => says(`Barril ${c}-20 L`))
    expect(leaks.map((c) => c.codePointAt(0)?.toString(16))).toEqual([])
  })

  it('"Barril -<c> 20 L": só letra/dígito (uma palavra "-x") deixa a quantidade valer', () => {
    const accepted = ALL.filter((c) => says(`Barril -${c} 20 L`))
    expect(accepted.every((c) => LETTER_OR_DIGIT.test(c))).toBe(true)
    // positivo de controle: a palavra "-a" não é um sinal
    expect(says('Barril -a 20 L')).toBe(true)
  })

  it('"Barril <c>20 L" (colado): só espaço comum, NBSP, tab e pontuação neutra são aceitos', () => {
    const accepted = ALL.filter((c) => says(`Barril ${c}20 L`))
    // '0' é o único dígito que mantém o valor: "020 L" é 20 L (zero à esquerda).
    expect(new Set(accepted)).toEqual(new Set([...GLUE_OK, '0']))
  })

  it('"Barril <c> 20 L": só letra, dígito, espaço e pontuação neutra são aceitos', () => {
    const accepted = ALL.filter((c) => says(`Barril ${c} 20 L`))
    const unexpected = accepted.filter(
      (c) => !(LETTER_OR_DIGIT.test(c) || SPACING.has(c) || NEUTRAL.has(c)),
    )
    expect(unexpected.map((c) => c.codePointAt(0)?.toString(16))).toEqual([])
    for (const c of ['a', '7', ' ', ':', '(']) expect(says(`Barril ${c} 20 L`)).toBe(true)
  })

  it('"Barril 20<c>L" e "Barril 20 L<c>": nada invisível cola a unidade ao número ou ao resto', () => {
    const between = ALL.filter((c) => says(`Barril 20${c}L`))
    expect(new Set(between)).toEqual(new Set([' ', '\t', NBSP]))
    const after = ALL.filter((c) => says(`Barril 20 L${c}`))
    // Depois da unidade não pode vir letra, número, marca combinante nem caractere de formato; a
    // única exceção é o 't' que completa a unidade "lt" ("20 Lt" ainda é 20 L).
    const letters = after.filter((c) => /[\p{L}\p{N}\p{M}\p{Cf}]/u.test(c))
    expect(new Set(letters)).toEqual(new Set(['t', 'T']))
  })

  it('combinações de dois caracteres de classes diferentes entre sinal e número', () => {
    const samples = [
      '-',
      '−',
      '–',
      '—',
      ' ',
      '\t',
      NBSP,
      ' ',
      '　',
      ' ',
      '\u0085',
      '⁣',
      '‎',
      '‏',
      '​',
      '‍',
      '⁠',
      '﻿',
      '­',
      '᠎',
      '́',
      '̀',
      '️',
      '\u0000',
      '\u001F',
      '\u007F',
      '(',
      '[',
      ':',
      '/',
      '|',
      '·',
      '+',
      '~',
      'a',
      '7',
    ]
    const leaks: string[] = []
    for (const first of samples)
      for (const second of samples) {
        const label = `Barril -${first}${second}20 L`
        if (says(label) && !/[a7]/.test(first + second)) leaks.push(JSON.stringify(label))
      }
    expect(leaks).toEqual([])
    // e com o sinal depois dos invisíveis
    for (const first of samples)
      for (const second of samples) {
        const label = `Barril ${first}${second}-20 L`
        expect(says(label), JSON.stringify(label)).toBe(false)
      }
  })
})

// ---------------------------------------------------------------------------------------------
// Caminho de renderização real: DOM e link do WhatsApp (o D1 → API entra no E2E real).
// ---------------------------------------------------------------------------------------------
describe('DOM e WhatsApp com rótulos adversariais', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const labels = [
    'Barril -\u3164 20 L',
    `Barril -${INVISIBLE_SEPARATOR} 20 L`,
    `Barril -${LRM}20 L`,
    `Barril -${RLM} 20 L`,
    `Barril ${INVISIBLE_SEPARATOR} 20 L`,
  ]
  const catalog: PublicCatalogV2 = {
    revision: 'r1',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: labels.map((label, index) => ({
          id: `adv${index}`,
          name: `Chope Adv ${index}`,
          description: 'Chopp',
          visible: true,
          variants: [{ code: 'v_a', label, volumeMl: 20000, priceCents: 12345 }],
        })),
      },
      {
        id: 'cachacas',
        name: 'Cachaças',
        items: [
          {
            id: 'cachaca-adv',
            name: 'Cachaça Adv',
            description: 'Garrafa',
            visible: true,
            variants: [
              {
                code: 'bottle',
                label: `Garrafa -${INVISIBLE_SEPARATOR}${LRM}700 ml`,
                volumeMl: 700,
                priceCents: 3000,
              },
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
    [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map(
      (match) => new URL(match[1].replaceAll('&amp;', '&')).searchParams.get('text') ?? '',
    )

  it('toda mensagem leva o volume canônico depois do rótulo literal; nenhuma o trata como satisfeito', async () => {
    const found = messages(await render())
    for (const [index, label] of labels.entries()) {
      const expected = `Olá! Gostaria de pedir Chope Adv ${index}, ${label} · 20 L, por R$${NBSP}123,45.`
      expect(found.filter((text) => text === expected)).toHaveLength(2) // tabela + card mobile
    }
    expect(found).toContain(
      `Olá! Gostaria de pedir uma garrafa de Cachaça Adv Garrafa -${INVISIBLE_SEPARATOR}${LRM}700 ml · 700 ml por R$${NBSP}30,00.`,
    )
    expect(
      buildCachacaWhatsAppMessage('Cachaça Adv', {
        label: `Garrafa -${LRM}700 ml`,
        volumeMl: 700,
        priceCents: 3000,
      }),
    ).toContain(`Garrafa -${LRM}700 ml · 700 ml`)
    expect(bottlePresentation({ label: `Garrafa -${RLM} 700 ml`, volumeMl: 700 })).toBe(
      `Garrafa -${RLM} 700 ml · 700 ml`,
    )
  })

  it('o DOM mostra o rótulo literal com o canônico e marca a inconsistência (data-volume-issue)', async () => {
    const html = await render()
    expect((html.match(/data-volume-issue="negative"/g) ?? []).length).toBeGreaterThanOrEqual(6)
    expect(html).toContain('data-volume-issue="ambiguous"')
    expect(html).toContain(`Barril -${INVISIBLE_SEPARATOR} 20 L · 20 L`)
    expect(html).not.toMatch(/inconsist|inv[aá]lid/i) // marcação, nunca texto novo ao cliente
  })
})

describe('normalização Unicode não abre contorno nem muda o veredito', () => {
  // A gramática NÃO normaliza: NFKC transformaria "－" (U+FF0D) em "-" e "２０" em "20", e isso
  // mudaria o que o rótulo diz. Dígitos e unidade têm de ser ASCII no texto como foi gravado.
  const forms = ['NFC', 'NFD', 'NFKC', 'NFKD'] as const
  const signedOrHidden = [
    `Barril -${INVISIBLE_SEPARATOR} 20 L`,
    `Barril -${LRM}20 L`,
    `Barril －${RLM}20 L`,
    'Barril −́ 20 L',
    'Barril ﹣​20 L',
    'Barril －20 L', // menos de largura total: NFKC o torna "-", ainda negativo
  ]
  const compatibilityForms = ['Barril ２０ L', 'Barril 20 Ｌ', 'Barril 20 ℓ', 'Barril ٢٠ L']

  it.each(signedOrHidden)('%j: em nenhuma forma de normalização vira 20 L', (label) => {
    expect(labelStatesVolume(label, 20000)).toBe(false)
    for (const form of forms)
      expect(labelStatesVolume(label.normalize(form), 20000), form).toBe(false)
  })

  it.each(compatibilityForms)(
    '%j: como foi gravado, não é 20 L (não se normaliza por conta própria)',
    (label) => {
      expect(labelStatesVolume(label, 20000)).toBe(false)
      expect(formatPresentation({ label, volumeMl: 20000 }, 'L')).toBe(`${label} · 20 L`)
    },
  )

  it('o veredito de um rótulo positivo ASCII não depende da forma de normalização', () => {
    for (const label of ['Barril 20 L', 'Garrafa 1.000 ml', 'Barril 7,5 L'])
      for (const form of forms)
        expect(volumesInLabel(label.normalize(form))).toEqual(volumesInLabel(label))
  })
})
