import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExpandableCatalogView } from '@/features/catalog-expansion/ExpandableCatalogView'
import type { PublicCatalogV2 } from '@/features/catalog-expansion/types'
import { LandingPage } from '@/pages/landing/LandingPage'

/**
 * Regra comercial confirmada pelo proprietário: o Chopp Delivery só faz ENTREGA. Não existe
 * retirada no estabelecimento. Nenhuma superfície pública (texto fixo, metadados, mensagens do
 * WhatsApp, itens de demonstração, valores iniciais do futuro CMS) pode oferecê-la.
 */
const PICKUP =
  /retirad[ao]s?|\bretira(r|m|mos)?\b|\bretire\b|busc(ar|amos|a)\b[^.]{0,24}pedido|pick-?up|take-?away|no balc[aã]o|loja f[ií]sica/i

const root = process.cwd()
const PUBLIC_DIRS = [
  'src/app',
  'src/pages/landing',
  'src/shared',
  'src/features/catalog',
  'src/features/catalog-expansion',
  'src/features/compliance',
  'src/features/contact',
  'src/features/faq',
  'src/features/motion',
]
const files = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    return statSync(join(root, path)).isDirectory() ? files(path) : [path]
  })

const catalog: PublicCatalogV2 = {
  revision: 'r1',
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
      ],
    },
    {
      id: 'cachacas',
      name: 'Cachaças',
      items: [
        {
          id: 'cachaca',
          name: 'Cachaça',
          description: 'Garrafa',
          visible: true,
          variants: [{ code: 'bottle', label: 'Garrafa', volumeMl: 700, priceCents: 3000 }],
        },
      ],
    },
  ],
}

describe('operação exclusivamente por delivery', () => {
  it('o detector reconhece as formas de oferecer retirada (e não acusa entrega)', () => {
    for (const text of [
      'Delivery e Retirada',
      'A gente entrega ou você retira.',
      'retire no local',
      'Retirada disponível',
      'buscar o pedido na loja',
      'pickup',
      'Retirada',
    ])
      expect(text).toMatch(PICKUP)
    for (const text of [
      'Delivery',
      'A gente entrega.',
      'Vocês entregam no meu bairro?',
      'Consulte condições para seu endereço.',
      'Avise se há escadas no local e se a tomada é 110 V ou 220 V.',
    ])
      expect(text).not.toMatch(PICKUP)
  })

  it('nenhum arquivo de código público (nem index.html) oferece retirada', () => {
    const sources = [
      'index.html',
      ...PUBLIC_DIRS.flatMap(files).filter(
        (path) => /\.(ts|tsx|css)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path),
      ),
    ]
    const offenders = sources.filter((path) => PICKUP.test(readFileSync(join(root, path), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('a landing renderizada (Hero, Ticker, catálogo, barris, FAQ, contato) não oferece retirada', () => {
    const html = renderToStaticMarkup(createElement(LandingPage))
    expect(html).toContain('Delivery')
    expect(html).not.toMatch(PICKUP)
  })

  it('o bloco informativo do catálogo diz apenas "Delivery" e que a gente entrega', () => {
    const html = renderToStaticMarkup(
      createElement(ExpandableCatalogView, { catalog, showCompliance: false }),
    )
    expect(html).toContain('data-testid="delivery-notice"')
    expect(html).toMatch(/>Delivery<\/span>/)
    expect(html).toContain('A gente entrega.')
    expect(html).not.toMatch(PICKUP)
  })

  it('o aviso 18+ e o texto de entrega do rodapé continuam presentes (nada legítimo foi removido)', () => {
    const html = renderToStaticMarkup(createElement(LandingPage))
    expect(html).toContain('Venda proibida para menores de 18 anos')
    expect(html).toContain('Vocês entregam no meu bairro?')
  })
})
