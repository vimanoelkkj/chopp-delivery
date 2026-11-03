import { describe, expect, it } from 'vitest'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import { previewFixture } from '../../../../tests/e2e-real/preview-fixture'
import {
  describeDocument,
  describeSection,
  documentNotices,
  readSiteSnapshot,
  type SiteRead,
  summarizeSections,
} from './siteModel'

const REV2 = 'c2_12345678-1234-4123-8123-123456789012'
const REV1 = 'c1_12345678-1234-4123-8123-123456789012'
const snapshot = (document: CmsDocumentV2, extra: Record<string, unknown> = {}) => ({
  schema: 2,
  draft: { revision: REV2, document },
  published: null,
  ...extra,
})
const v2 = (document: CmsDocumentV2 = previewFixture()) => {
  const read = readSiteSnapshot(snapshot(document))
  if (read.kind !== 'v2') throw new Error('esperava v2')
  return read as Extract<SiteRead, { kind: 'v2' }>
}
const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

describe('readSiteSnapshot', () => {
  it('sem documento: devolve "none" com a revisão, sem erro', () => {
    expect(
      readSiteSnapshot({
        schema: null,
        draft: { revision: REV1, document: null },
        published: null,
      }),
    ).toEqual({ kind: 'none', revision: REV1 })
  })

  it('rascunho no formato antigo: devolve "v1" sem interpretar nem converter', () => {
    const read = readSiteSnapshot({
      schema: 1,
      draft: { revision: REV1, document: { schemaVersion: 1 } },
      published: null,
    })
    expect(read).toEqual({ kind: 'v1', revision: REV1 })
  })

  it('v2 válido: documento, layout derivado e avisos do servidor', () => {
    const read = readSiteSnapshot(snapshot(previewFixture(), { warnings: ['MEDIA_NOT_READY'] }))
    expect(read.kind).toBe('v2')
    if (read.kind !== 'v2') return
    expect(read.revision).toBe(REV2)
    expect(read.document.modules).toHaveLength(10)
    expect(read.layout.sections.length).toBeGreaterThan(0)
    expect(read.warnings).toEqual(['MEDIA_NOT_READY'])
  })

  it.each([
    [
      'publicado não nulo (publicação segue desativada)',
      { ...snapshot(previewFixture()), published: { versionId: 'x' } },
    ],
    ['chave extra no envelope', { ...snapshot(previewFixture()), extra: 1 }],
    [
      'revisão inválida',
      { ...snapshot(previewFixture()), draft: { revision: 'x', document: previewFixture() } },
    ],
    [
      'v2 com revisão de v1',
      { ...snapshot(previewFixture()), draft: { revision: REV1, document: previewFixture() } },
    ],
    ['schema desconhecido', { ...snapshot(previewFixture()), schema: 3 }],
    ['avisos que não são texto', snapshot(previewFixture(), { warnings: [1] })],
    [
      'documento v2 inválido (módulo obrigatório ausente)',
      snapshot({ ...previewFixture(), modules: previewFixture().modules.slice(0, 2) }),
    ],
    ['não é objeto', null],
  ])('rejeita payload não confiável: %s', (_, value) => {
    expect(() => readSiteSnapshot(value)).toThrow('INVALID_SITE')
  })

  it('não altera o objeto recebido (entrada congelada não quebra)', () => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(snapshot(previewFixture()))))
    expect(() => readSiteSnapshot(frozen)).not.toThrow()
  })
})

describe('summarizeSections', () => {
  it('preserva ids e a ordem do documento, incluindo seções ocultas', () => {
    const document = previewFixture()
    const hiddenIndex = document.modules.findIndex((m) => m.template === 'highlight')
    document.modules[hiddenIndex] = { ...document.modules[hiddenIndex], visible: false } as never
    const read = v2(document)
    const sections = summarizeSections(read.document, read.layout)
    expect(sections.map((s) => s.id)).toEqual(document.modules.map((m) => m.id))
    expect(sections[hiddenIndex]).toMatchObject({ visible: false, position: null, number: null })
  })

  it('marca obrigatórias, âncoras por regra e posição só das visíveis', () => {
    const read = v2()
    const sections = summarizeSections(read.document, read.layout)
    const by = Object.fromEntries(sections.filter((s) => s.mandatory).map((s) => [s.template, s]))
    expect(Object.keys(by).sort()).toEqual(['catalog', 'contact', 'hero'])
    expect(by.catalog.anchor).toBe('chopes')
    expect(by.hero.id).toBe('hero')
    expect(sections.filter((s) => s.visible).map((s) => s.position)).toEqual(
      sections.filter((s) => s.visible).map((_, i) => i + 1),
    )
  })

  it('usa o título editorial e cai no nome do tipo quando não há título', () => {
    const read = v2()
    const sections = summarizeSections(read.document, read.layout)
    expect(sections.find((s) => s.template === 'hero')?.title).toBe('Rascunho privado P4')
    expect(sections.find((s) => s.template === 'ticker')?.title).toBe('Faixa de destaques')
  })
})

describe('describeSection: situação de cada campo pelo contrato real', () => {
  const rows = (template: string) => {
    const read = v2()
    const id = read.document.modules.find((m) => m.template === template)?.id as string
    const detail = describeSection(read.document, read.layout, id)
    if (!detail) throw new Error('seção ausente')
    return detail
  }
  const find = (list: { key: string }[], key: string) =>
    list.find((r) => r.key === key) as never as {
      status: string
      value: string | null
      hint?: string
      depth?: number
    }

  it('estrutura: identificador, tipo, navegação e âncora são somente leitura', () => {
    const detail = rows('catalog')
    for (const key of ['id', 'template', 'navigation', 'anchor', 'placement'])
      expect(find(detail.structure, key).status).toBe('readonly')
    expect(find(detail.structure, 'anchor').value).toBe('#chopes')
  })

  it('visibilidade: somente leitura nas obrigatórias e editável depois nas demais', () => {
    expect(find(rows('hero').structure, 'visible').status).toBe('readonly')
    expect(find(rows('hero').structure, 'visible').hint).toMatch(/Obrigatória/)
    expect(find(rows('faq').structure, 'visible').status).toBe('editable')
  })

  it('textos são editáveis depois, com o limite do contrato; mídia fica indisponível', () => {
    const hero = rows('hero')
    expect(find(hero.content, 'heading')).toMatchObject({
      status: 'editable',
      hint: 'até 120 caracteres',
    })
    expect(find(hero.content, 'summary')).toMatchObject({
      status: 'editable',
      hint: 'até 2000 caracteres',
    })
    expect(find(hero.content, 'media')).toMatchObject({ status: 'unavailable', value: null })
  })

  it('vitrine: os barris vêm do catálogo (somente leitura) e a ordem do documento é mantida', () => {
    const carousel = rows('carousel')
    const entries = carousel.content.filter((r) => r.key.endsWith('.itemId'))
    expect(entries.map((r) => r.value)).toEqual(['dronken', 'heineken'])
    expect(entries.every((r) => r.status === 'readonly' && r.depth === 1)).toBe(true)
  })

  it('catálogo: preços e variantes não fazem parte do documento', () => {
    expect(find(rows('catalog').content, 'prices')).toMatchObject({ status: 'readonly' })
  })

  it('listas aparecem item a item (passos do "Como funciona" e perguntas do FAQ)', () => {
    const how = rows('how').content.filter((r) => /^steps\.\d+\.(title|body)$/.test(r.key))
    expect(how.map((r) => r.key)).toEqual([
      'steps.0.title',
      'steps.0.body',
      'steps.1.title',
      'steps.1.body',
    ])
    const faq = rows('faq').content.filter((r) => /^items\.\d+\.(question|answer)$/.test(r.key))
    expect(faq).toHaveLength(4)
  })

  it('seção inexistente devolve null', () => {
    const read = v2()
    expect(describeSection(read.document, read.layout, 'nao-existe')).toBeNull()
  })
})

describe('describeDocument e documentNotices', () => {
  it('publicação desativada e WhatsApp não definido aparecem como são', () => {
    const rows = describeDocument(v2())
    const by = (key: string) => rows.find((r) => r.key === key)
    expect(by('publication')?.value).toMatch(/Desativada/)
    expect(by('whatsapp')).toMatchObject({ value: null, status: 'readonly' })
    expect(by('revision')?.value).toBe(REV2)
  })

  it('traduz avisos conhecidos e mostra os desconhecidos sem esconder', () => {
    const document = previewFixture()
    const carousel = document.modules.findIndex((m) => m.template === 'carousel')
    document.modules[carousel] = { ...document.modules[carousel], visible: false } as never
    const read = readSiteSnapshot(
      snapshot(document, { warnings: ['MEDIA_NOT_READY', 'ALGO_NOVO'] }),
    )
    if (read.kind !== 'v2') throw new Error('esperava v2')
    const notices = documentNotices(read)
    expect(notices).toContain('A vitrine de barris está oculta.')
    expect(notices).toContain('Há imagem referenciada que ainda não está pronta para uso.')
    expect(notices).toContain('ALGO_NOVO')
  })
})
