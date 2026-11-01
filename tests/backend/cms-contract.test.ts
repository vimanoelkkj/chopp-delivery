import { describe, expect, it } from 'vitest'
import {
  projectPublicCms,
  validateCmsDocument,
  validateCmsMutation,
} from '../../server/cms/validation'
import type { CmsDocument } from '../../shared/cms'

const uuid = '12345678-1234-4123-8123-123456789abc'
const revision = `c1_${uuid}`
const document = (): CmsDocument => ({
  schemaVersion: 1,
  commercial: { fulfillmentMode: 'delivery', whatsappNumber: '5511998765432' },
  modules: [
    {
      id: 'hero',
      template: 'hero',
      region: 'start',
      visible: true,
      navigation: 'none',
      content: {
        heading: 'Delegas',
        summary: 'Entrega combinada no atendimento.',
        media: { id: `media_${uuid}`, alt: 'Barris de chope' },
      },
    },
    {
      id: 'catalog',
      template: 'catalog',
      region: 'catalog',
      visible: true,
      navigation: 'primary',
      content: { heading: 'Chopes', intro: 'Consulte as opções.' },
    },
    {
      id: 'contact',
      template: 'contact',
      region: 'end',
      visible: true,
      navigation: 'cta',
      content: { heading: 'Contato', body: 'Converse com a equipe.' },
    },
  ],
})

type TestModule = { content: Record<string, unknown>; [key: string]: unknown }
type TestDocument = {
  schemaVersion: unknown
  commercial: Record<string, unknown>
  modules: TestModule[]
  [key: string]: unknown
}
// Deliberately malformed JSON fixtures use unknown fields, independently of the DTO types.
const altered = (change: (data: TestDocument) => void): TestDocument => {
  const data: TestDocument = JSON.parse(JSON.stringify(document()))
  change(data)
  return data
}

describe('CMS v1: documento e publicação', () => {
  it('aceita documento publicável e rascunho incompleto', () => {
    expect(validateCmsDocument(document(), 'publish').value).toEqual(document())
    const draft = altered((d) => {
      d.commercial.whatsappNumber = null
      d.modules[0].content.heading = ''
      d.modules[0].content.media = null
    })
    expect(validateCmsDocument(draft, 'draft').value).toEqual(draft)
    expect(validateCmsDocument(draft, 'publish').fields).toBeDefined()
  })
  const cases: [string, (d: TestDocument) => void][] = [
    [
      'versão futura',
      (d) => {
        d.schemaVersion = 2
      },
    ],
    [
      'campo raiz',
      (d) => {
        d.html = '<script>'
      },
    ],
    [
      'retirada',
      (d) => {
        d.commercial.fulfillmentMode = 'pickup'
      },
    ],
    [
      'configuração de retirada',
      (d) => {
        d.commercial.pickup = false
      },
    ],
    [
      'número formatado',
      (d) => {
        d.commercial.whatsappNumber = '+55 (11) 99876-5432'
      },
    ],
    [
      'número curto',
      (d) => {
        d.commercial.whatsappNumber = '123'
      },
    ],
    [
      'país zero',
      (d) => {
        d.commercial.whatsappNumber = '01234567890'
      },
    ],
    [
      'telefone legado',
      (d) => {
        d.commercial.whatsappNumber = '[NÚMERO]'
      },
    ],
    [
      'módulo obrigatório ausente',
      (d) => {
        d.modules.splice(1, 1)
      },
    ],
    [
      'módulo obrigatório oculto',
      (d) => {
        d.modules[0].visible = false
      },
    ],
    [
      'singleton duplicado',
      (d) => {
        d.modules.splice(1, 0, d.modules[0])
      },
    ],
    [
      'ID obrigatório alterado',
      (d) => {
        d.modules[0].id = `module_${uuid}`
      },
    ],
    [
      'ordem do hero',
      (d) => {
        d.modules.reverse()
      },
    ],
    [
      'região inválida',
      (d) => {
        d.modules[1].region = 'intro'
      },
    ],
    [
      'âncora arbitrária',
      (d) => {
        d.modules[1].anchor = 'admin'
      },
    ],
    [
      'navegação protegida',
      (d) => {
        d.modules[1].navigation = 'none'
      },
    ],
    [
      'visibilidade inválida',
      (d) => {
        d.modules[0].visible = 1
      },
    ],
    [
      'template arbitrário',
      (d) => {
        d.modules[0].template = '__proto__'
      },
    ],
    [
      'preço no editorial',
      (d) => {
        d.modules[1].content.priceCents = 100
      },
    ],
    [
      'URL na mídia',
      (d) => {
        Object.assign(d.modules[0].content.media as object, { id: 'https://evil.test/a.png' })
      },
    ],
    [
      'URL na mídia extra',
      (d) => {
        Object.assign(d.modules[0].content.media as object, { url: 'https://evil.test' })
      },
    ],
    [
      'alt ausente',
      (d) => {
        delete (d.modules[0].content.media as Record<string, unknown>).alt
      },
    ],
    [
      'HTML',
      (d) => {
        d.modules[0].content.heading = '<b>Delegas</b>'
      },
    ],
    [
      'URL',
      (d) => {
        d.modules[0].content.summary = 'https://evil.test'
      },
    ],
    [
      'URL relativa',
      (d) => {
        d.modules[0].content.summary = '//evil.test'
      },
    ],
    [
      'javascript',
      (d) => {
        d.modules[0].content.summary = 'javascript:alert(1)'
      },
    ],
    [
      'CSS',
      (d) => {
        d.modules[0].content.css = 'display:none'
      },
    ],
    [
      'aviso legal editável',
      (d) => {
        d.commercial.ageNotice = false
      },
    ],
    [
      'controle bidi',
      (d) => {
        d.modules[0].content.heading = '\u202eABC'
      },
    ],
    [
      'surrogate isolado',
      (d) => {
        d.modules[0].content.heading = '\ud800'
      },
    ],
    [
      'título excessivo',
      (d) => {
        d.modules[0].content.heading = 'x'.repeat(121)
      },
    ],
    [
      'texto excessivo',
      (d) => {
        d.modules[0].content.summary = 'x'.repeat(2001)
      },
    ],
    [
      'objeto aninhado',
      (d) => {
        d.modules[0].content.heading = { text: 'A' }
      },
    ],
    [
      'lista excessiva',
      (d) => {
        d.modules = Array.from({ length: 25 }, () => d.modules[0])
      },
    ],
  ]
  it.each(cases)('rejeita %s também no rascunho', (_name, change) => {
    expect(validateCmsDocument(altered(change), 'draft').fields).toBeDefined()
  })
  it.each([null, [], {}, 'text', 1])('rejeita entrada sem formato: %j', (data) => {
    expect(validateCmsDocument(data, 'draft').fields).toBeDefined()
  })
  it('rejeita texto invisível na publicação', () => {
    expect(
      validateCmsDocument(
        altered((d) => {
          d.modules[0].content.heading = '\u200b'
        }),
        'publish',
      ).fields,
    ).toBeDefined()
  })
  it('devolve cópia independente da entrada', () => {
    const input = document()
    const value = validateCmsDocument(input, 'publish').value
    input.commercial.whatsappNumber = null
    expect(value?.commercial.whatsappNumber).toBe('5511998765432')
  })
  it('limita bytes UTF-8 reais', () => {
    const huge = altered((d) => {
      d.modules[0].content.summary = '😀'.repeat(20000)
    })
    expect(validateCmsDocument(huge, 'draft').fields).toBeDefined()
  })
  it('não depende de bloqueio de palavras para validar semântica comercial', () => {
    const input = altered((d) => {
      d.modules[0].content.summary = 'Texto exige revisão humana antes de publicar.'
    })
    expect(validateCmsDocument(input, 'publish').value).toBeDefined()
  })
})

describe('composição opcional', () => {
  const optional = (
    template = 'highlight',
    id = `module_${uuid}`,
    region = 'details',
    content: Record<string, unknown> = { heading: 'Título', body: 'Texto', media: null },
  ) => ({ id, template, region, visible: true, navigation: 'none', content })
  it.each([
    ['about', { heading: 'Sobre', body: 'Texto', media: null }],
    ['barrels', { heading: 'Barris', body: 'Texto', media: null }],
    ['highlight', { heading: 'Destaque', body: 'Texto', media: null }],
    [
      'how',
      { heading: 'Como funciona', steps: [{ title: 'Atendimento', body: 'Combine a entrega.' }] },
    ],
    [
      'faq',
      { heading: 'Dúvidas', items: [{ question: 'Como pedir?', answer: 'No atendimento.' }] },
    ],
    ['ticker', { items: ['Delivery', 'Delegas'] }],
  ])('aceita template %s', (template, content) => {
    const input = altered((d) => {
      d.modules.splice(
        2,
        0,
        optional(template, undefined, template === 'ticker' ? 'intro' : 'details', content),
      )
      if (template === 'ticker') [d.modules[1], d.modules[2]] = [d.modules[2], d.modules[1]]
    })
    expect(validateCmsDocument(input, 'publish').value).toBeDefined()
  })
  it('permite reordenar opcionais dentro da região', () => {
    const input = altered((d) => {
      d.modules.splice(2, 0, optional(), optional('about', `module_${uuid.replace('abc', 'abd')}`))
    })
    expect(validateCmsDocument(input, 'publish').value).toBeDefined()
    ;[input.modules[2], input.modules[3]] = [input.modules[3], input.modules[2]]
    expect(validateCmsDocument(input, 'publish').value).toBeDefined()
  })
  it.each(['repetição', 'ID duplicado', 'região', 'âncora', 'lista', 'campo interno'])(
    'rejeita %s inválida',
    (scenario) => {
      const input = altered((d) => {
        d.modules.splice(
          2,
          0,
          optional('faq', undefined, 'details', {
            heading: 'Dúvidas',
            items: [{ question: 'A?', answer: 'B' }],
          }),
        )
        if (scenario === 'repetição')
          d.modules.splice(
            2,
            0,
            optional(
              'faq',
              `module_${uuid.replace('abc', 'abd')}`,
              'details',
              d.modules[2].content,
            ),
          )
        if (scenario === 'ID duplicado') d.modules.splice(2, 0, optional())
        if (scenario === 'região') d.modules[2].region = 'intro'
        if (scenario === 'âncora') d.modules[2].anchor = 'chopes'
        if (scenario === 'lista')
          d.modules[2].content.items = Array(13).fill({ question: 'A?', answer: 'B' })
        if (scenario === 'campo interno')
          (d.modules[2].content.items as Record<string, unknown>[])[0].url = '/admin'
      })
      expect(validateCmsDocument(input, 'publish').fields).toBeDefined()
    },
  )
  it('limita destaques a três mesmo ocultos', () => {
    const input = altered((d) => {
      for (let i = 0; i < 4; i++)
        d.modules.splice(2, 0, {
          ...optional('highlight', `module_${uuid.slice(0, -1)}${i}`),
          visible: false,
        })
    })
    expect(validateCmsDocument(input, 'draft').fields).toBeDefined()
  })
})

describe('concorrência, idempotência e projeção', () => {
  it('valida envelope e revisão opaca sem interpretar contador', () => {
    const input = {
      action: 'publish',
      expectedRevision: revision,
      operationId: uuid,
      document: document(),
    }
    expect(validateCmsMutation(input).value).toEqual(input)
    for (const patch of [
      { expectedRevision: 'r1' },
      { expectedRevision: `W/"${revision}"` },
      { operationId: '*' },
      { action: 'delete' },
      { sessionHash: 'secret' },
    ])
      expect(validateCmsMutation({ ...input, ...patch }).fields).toBeDefined()
  })
  it('projeção contém somente dados publicáveis e módulos visíveis', () => {
    const input = altered((d) => {
      d.modules.splice(2, 0, {
        id: `module_${uuid}`,
        template: 'highlight',
        region: 'details',
        visible: false,
        navigation: 'none',
        content: { heading: '', body: '', media: null },
      })
    })
    const published = projectPublicCms(input)
    expect(Object.keys(published)).toEqual(['schemaVersion', 'commercial', 'modules'])
    expect(published.modules).toHaveLength(3)
    expect(published.modules[1].anchor).toBe('chopes')
    expect(published.modules[2].anchor).toBe('contato')
    expect(JSON.stringify(published)).not.toMatch(
      /revision|operationId|sessionHash|objectKey|createdBy|visible/,
    )
    expect(() => projectPublicCms({ ...input, revision })).toThrow()
    expect(() =>
      projectPublicCms(
        altered((d) => {
          d.commercial.whatsappNumber = null
        }),
      ),
    ).toThrow()
  })
})
