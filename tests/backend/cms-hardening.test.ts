import { expect, it } from 'vitest'
import { validateCmsDocument } from '../../server/cms/validation'
import { cmsDocument } from './cms-document-fixture'

it.each(['java\nscript:alert(1)', 'da\tta:text/html,x', 'vb\rscript:x'])(
  'recusa URI ofuscada em texto multilinha: %j',
  (summary) => {
    const doc = cmsDocument()
    Object.assign(doc.modules[0].content, { summary })
    expect(validateCmsDocument(doc, 'draft').fields).toBeDefined()
  },
)
it('preserva quebras editoriais e não confunde sufixo de palavra com esquema', () => {
  const doc = cmsDocument()
  Object.assign(doc.modules[0].content, {
    heading: 'Metadata: texto editorial',
    summary: 'Horário:\n18h às 23h\tDelivery',
  })
  expect(validateCmsDocument(doc, 'draft').value).toEqual(doc)
})

it.each([
  'Horário: 18h às 23h',
  'Atendimento: segunda a sábado',
  'Delegas: delivery de chope',
  'Horário:18h',
])('aceita pontuação editorial: %s', (heading) => {
  const doc = cmsDocument()
  Object.assign(doc.modules[0].content, { heading })
  expect(validateCmsDocument(doc, 'draft').value).toEqual(doc)
})
it.each([
  'javascript: alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,x',
  'vbscript:x',
  'https: //evil.test',
  '//evil.test',
  'custom://evil.test',
  'file:/tmp/a',
  '<b>texto</b>',
  'https://evil.test',
  'java\u200bscript:alert(1)',
])('recusa conteúdo não autorizado: %s', (heading) => {
  const doc = cmsDocument()
  Object.assign(doc.modules[0].content, { heading })
  expect(validateCmsDocument(doc, 'draft').fields).toBeDefined()
})
it.each(['\n', '\r', '\t', '\u0085', '\u2028', '\u2029'])(
  'recusa quebra/controle %j em heading e alt, permite CR/LF/TAB só no corpo',
  (separator) => {
    const doc = cmsDocument()
    Object.assign(doc.modules[0].content, { heading: `A${separator}B` })
    expect(validateCmsDocument(doc, 'draft').fields).toBeDefined()
    Object.assign(doc.modules[0].content, {
      heading: 'Título',
      media: { id: 'media_12345678-1234-4123-8123-123456789abc', alt: `A${separator}B` },
    })
    expect(validateCmsDocument(doc, 'draft').fields).toBeDefined()
    Object.assign(doc.modules[0].content, { media: null, summary: 'Linha 1\nLinha 2\tFim\r\n' })
    expect(validateCmsDocument(doc, 'draft').value).toBeDefined()
  },
)
it('valida a representação materializada do getter, não uma leitura posterior', () => {
  const doc = cmsDocument()
  let reads = 0
  Object.defineProperty(doc.modules[0].content, 'heading', {
    enumerable: true,
    get() {
      return reads++ === 0 ? '<script>bad</script>' : 'Título seguro'
    },
  })
  expect(validateCmsDocument(doc, 'draft').fields).toBeDefined()
  expect(reads).toBe(1)
})
it('materializa toJSON antes de validar e retorna exatamente essa representação', () => {
  const safe = cmsDocument()
  const invalid = cmsDocument()
  invalid.commercial.fulfillmentMode = 'pickup' as 'delivery'
  expect(validateCmsDocument({ ...safe, toJSON: () => invalid }, 'draft').fields).toBeDefined()
  const result = validateCmsDocument({ toJSON: () => safe }, 'draft')
  expect(result.value).toEqual(safe)
  safe.commercial.whatsappNumber = '5511998765432'
  expect(result.value?.commercial.whatsappNumber).toBeNull()
})
it('recusa ciclos e valores sem representação JSON', () => {
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  for (const input of [cycle, undefined, () => {}, Symbol('x'), { toJSON: () => undefined }, 1n])
    expect(validateCmsDocument(input, 'draft').fields).toBeDefined()
})
