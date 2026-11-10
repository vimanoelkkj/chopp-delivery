import { describe, expect, it } from 'vitest'
import { convertCmsV1ToV2 } from '../../../../server/cms/convert'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import { cmsDocument } from '../../../../tests/backend/cms-document-fixture'
import { previewFixture } from '../../../../tests/e2e-real/preview-fixture'
import {
  describeConversion,
  describeDocument,
  describeSection,
  documentNotices,
  documentSetupPending,
  publishBlockers,
  readCommandResult,
  readConversionPreview,
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
      'metadados de publicação incompletos',
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

  it('textos são editáveis, com o limite do contrato; a imagem da abertura é escolhida na biblioteca', () => {
    const hero = rows('hero')
    expect(find(hero.content, 'heading')).toMatchObject({
      status: 'editable',
      hint: 'até 120 caracteres',
    })
    expect(find(hero.content, 'summary')).toMatchObject({
      status: 'editable',
      hint: 'até 2000 caracteres',
    })
    expect(find(hero.content, 'media')).toMatchObject({ status: 'editable', value: null })
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

describe('prévia de conversão (formato real do servidor)', () => {
  const serverPreview = () => ({
    preview: {
      from: { versionId: 'version_12345678-1234-4123-8123-123456789012', revision: REV1 },
      ...convertCmsV1ToV2(cmsDocument()),
    },
  })

  // v1 com o bloco "Barris" depois do catálogo: a conversão o transforma em vitrine e o reordena.
  const withBarrels = () => {
    const document = cmsDocument()
    document.modules.splice(2, 0, {
      id: 'module_12345678-1234-4123-8123-000000000001',
      template: 'barrels',
      region: 'details',
      visible: true,
      navigation: 'primary',
      content: { heading: 'Barris', body: 'Texto dos barris', media: null },
    })
    return {
      preview: {
        from: { versionId: 'version_12345678-1234-4123-8123-123456789012', revision: REV1 },
        ...convertCmsV1ToV2(document),
      },
    }
  }

  it('aceita exatamente o que o conversor do servidor produz', () => {
    const preview = readConversionPreview(serverPreview())
    expect(preview.document.schemaVersion).toBe(2)
    expect(preview.from.revision).toBe(REV1)
    expect(preview.mapping.length).toBe(cmsDocument().modules.length)
  })

  it.each([
    ['chave extra', { preview: { ...serverPreview().preview, extra: 1 } }],
    ['documento ainda v1', { preview: { ...serverPreview().preview, document: cmsDocument() } }],
    ['perdas que não são texto', { preview: { ...serverPreview().preview, losses: [1] } }],
    [
      'mapeamento malformado',
      { preview: { ...serverPreview().preview, mapping: [{ from: 1, to: 2 }] } },
    ],
    ['sem o envelope', serverPreview().preview],
    ['não é objeto', 'x'],
  ])('rejeita prévia malformada: %s', (_, value) => {
    expect(() => readConversionPreview(value)).toThrow('INVALID_PREVIEW')
  })

  it('descreve só o que a prévia mostra: ids preservados, "Barris" vira vitrine sem barris, ordem muda', () => {
    const view = describeConversion(readConversionPreview(withBarrels()))
    expect(view.consequences).toContain(
      'Textos, visibilidade e identificadores das seções são preservados.',
    )
    expect(
      view.consequences.some((line) => /vitrine/.test(line) && /nenhum barril/.test(line)),
    ).toBe(true)
    expect(view.consequences.some((line) => /reordenadas/.test(line))).toBe(true)
    expect(view.consequences.some((line) => /deixa de receber alterações/.test(line))).toBe(true)
    expect(view.consequences).toContain('Nada é publicado e o site público não muda.')
    const carousel = view.sections.find((s) => s.kind === 'Vitrine de barris')
    expect(carousel?.wasKind).toBe('Barris')
    expect(view.sections.map((s) => s.position)).toEqual(view.sections.map((_, i) => i + 1))
    expect(view.losses).toEqual([])
    expect(view.notices.join(' ')).toMatch(/vitrine de barris não tem barris/)
  })

  it('sem bloco "Barris" no v1, não promete vitrine nem reordenação que não acontecem', () => {
    const view = describeConversion(readConversionPreview(serverPreview()))
    expect(view.consequences.some((line) => /vitrine/.test(line))).toBe(false)
    expect(view.consequences.some((line) => /reordenadas/.test(line))).toBe(false)
    expect(view.notices.join(' ')).toMatch(/não tem a vitrine de barris/)
  })

  it('não afirma que os ids foram preservados quando o mapeamento diz o contrário', () => {
    const preview = readConversionPreview(serverPreview())
    preview.mapping[0] = {
      ...preview.mapping[0],
      from: { ...preview.mapping[0].from, id: 'outro' },
    }
    expect(describeConversion(preview).consequences).not.toContain(
      'Textos, visibilidade e identificadores das seções são preservados.',
    )
  })
})

describe('readCommandResult', () => {
  const body = (revision = REV2) => ({
    command: {
      operationId: '12345678-1234-4123-8123-123456789abc',
      action: 'convertToV2',
      expectedRevision: REV1,
      revision,
      versionId: 'version_12345678-1234-4123-8123-123456789012',
    },
    site: { schema: 2, draft: { revision: REV2, document: previewFixture() }, published: null },
  })

  it('aceita o recibo coerente e entrega o documento v2 lido', () => {
    const receipt = readCommandResult(body())
    expect(receipt.read.kind).toBe('v2')
    expect(receipt.command.action).toBe('convertToV2')
  })

  it.each([
    [
      'revisão do recibo diferente da do documento',
      body('c2_99999999-9999-4999-8999-999999999999'),
    ],
    ['ação desconhecida', { ...body(), command: { ...body().command, action: 'publish' } }],
    [
      'site v1 no recibo',
      {
        ...body(),
        site: { schema: null, draft: { revision: REV1, document: null }, published: null },
      },
    ],
    ['sem site', { command: body().command }],
  ])('rejeita: %s', (_, value) => {
    expect(() => readCommandResult(value)).toThrow('INVALID_RECEIPT')
  })
})

describe('pendências do rascunho inicial', () => {
  it('identifica vitrine vazia e WhatsApp não configurado', () => {
    const document = previewFixture()
    const carousel = document.modules.find((module) => module.template === 'carousel')
    if (carousel?.template !== 'carousel') throw new Error('vitrine ausente')
    carousel.content.entries = []
    document.commercial.whatsappNumber = null
    expect(documentSetupPending(v2(document))).toEqual([
      'A vitrine ainda não tem barris selecionados.',
      'O WhatsApp do documento ainda não foi configurado.',
    ])
  })

  it('não sugere pendências desses campos quando ambos estão preenchidos', () => {
    const document = previewFixture()
    document.commercial.whatsappNumber = '5532999999999'
    expect(documentSetupPending(v2(document))).toEqual([])
  })
})

describe('publishBlockers', () => {
  const SITE = '5531984400001'
  const ready = () => {
    const document = previewFixture()
    document.commercial.whatsappNumber = SITE
    for (const module of document.modules) {
      if (module.template === 'hero')
        module.content = {
          heading: 'Conteúdo aprovado',
          summary: 'Texto editorial',
          media: { id: 'media_12345678-1234-4123-8123-123456789012', alt: 'Imagem de teste' },
          deliveryRegion: 'Região de teste',
        }
      if (module.template === 'catalog') module.content = { heading: 'Catálogo', intro: 'Opções' }
      if (module.template === 'contact') module.content = { heading: 'Contato', body: 'Converse' }
    }
    return document
  }

  it('libera um rascunho completo com o número comercial do site', () => {
    expect(publishBlockers(ready(), SITE)).toEqual([])
  })

  it('bloqueia enquanto houver imagem não pronta e libera sem o aviso do servidor', () => {
    const blocked = publishBlockers(ready(), SITE, ['MEDIA_NOT_READY'])
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toContain('não está pronta')
    expect(publishBlockers(ready(), SITE, [])).toEqual([])
    expect(publishBlockers(ready(), SITE, ['OUTRO_AVISO'])).toEqual([])
  })

  it('bloqueia WhatsApp ausente e vitrine visível sem barris', () => {
    const document = ready()
    document.commercial.whatsappNumber = null
    const carousel = document.modules.find((module) => module.template === 'carousel')
    if (carousel?.template !== 'carousel') throw new Error('vitrine ausente')
    carousel.content.entries = []
    expect(publishBlockers(document, SITE)).toEqual([
      'O WhatsApp comercial do documento ainda não foi definido.',
      'A vitrine de barris está visível e não tem barris selecionados.',
    ])
  })

  it('bloqueia número diferente do comercial, mas aceita qualquer válido quando o build não tem número', () => {
    const document = ready()
    document.commercial.whatsappNumber = '5532999999999'
    expect(publishBlockers(document, SITE)).toEqual([
      'O WhatsApp do documento difere do número comercial do site.',
    ])
    expect(publishBlockers(document, null)).toEqual([])
  })
})

describe('publishBlockers: conteúdo obrigatório', () => {
  it('explica que seções visíveis precisam de texto quando o contrato recusa', () => {
    const document = previewFixture()
    document.commercial.whatsappNumber = '5531984400001'
    const hero = document.modules.find((module) => module.template === 'hero')
    if (hero?.template !== 'hero') throw new Error('hero ausente')
    hero.content = {
      heading: '',
      summary: '',
      media: { id: 'media_12345678-1234-4123-8123-123456789012', alt: 'Imagem de teste' },
      deliveryRegion: '',
    }
    expect(publishBlockers(document, '5531984400001')).toEqual([
      'Preencha os textos obrigatórios das seções visíveis.',
    ])
  })
})

describe('publishBlockers: imagem da abertura', () => {
  it('bloqueia explicitamente quando o hero não tem imagem (exigência do contrato de publicação)', () => {
    const document = previewFixture()
    document.commercial.whatsappNumber = '5531984400001'
    const hero = document.modules.find((module) => module.template === 'hero')
    if (hero?.template !== 'hero') throw new Error('hero ausente')
    hero.content = { heading: 'A', summary: 'B', media: null, deliveryRegion: 'C' }
    expect(publishBlockers(document, '5531984400001')).toContain(
      'A imagem da abertura (hero) é obrigatória para publicar.',
    )
  })
})
