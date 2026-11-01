import { expect, it } from 'vitest'
import { validateCmsDocument } from '../../server/cms/validation'
import {
  carousel,
  institutional,
  media,
  mutation,
  parse,
  project,
  uuid,
  v2,
} from './cms-v2-fixture'

it('v1 stays strict while the versioned parser accepts v2', () => {
  const doc = v2()
  expect(validateCmsDocument(doc, 'draft').fields).toBeDefined()
  expect(parse(doc).value).toEqual(doc)
})
for (const version of [3, 0, -1, 2.5, '2', '1', true, null, [2], {}, undefined])
  it(`rejects unsupported schema ${JSON.stringify(version)}`, () => {
    const doc: Record<string, unknown> = { ...v2(), schemaVersion: version }
    if (version === undefined) delete doc.schemaVersion
    expect(parse(doc).code).toBe('CMS_SCHEMA_UNSUPPORTED')
  })
it('rejects __proto__ instead of a version and accepts numeric 2.0/2e0 canonically', () => {
  expect(parse(JSON.parse('{"__proto__":{"schemaVersion":2}}')).code).toBe('CMS_SCHEMA_UNSUPPORTED')
  for (const lexical of ['2.0', '2e0']) {
    const doc = JSON.parse(
      JSON.stringify(v2()).replace('"schemaVersion":2', `"schemaVersion":${lexical}`),
    )
    expect(parse(doc).value).toEqual(v2())
    expect(JSON.stringify(parse(doc).value)).toContain('"schemaVersion":2,')
  }
})
const permutations = <T>(values: T[]): T[][] =>
  values.length
    ? values.flatMap((v, i) =>
        permutations(values.filter((_, j) => j !== i)).map((rest) => [v, ...rest]),
      )
    : [[]]
it('accepts all720 institutional permutations with highlight interleaving', () => {
  const blocks = ['how', 'about', 'faq', 'highlight', 'highlight', 'highlight'].map((t, i) =>
    institutional(t as 'how', i + 10),
  )
  for (const order of permutations(blocks)) {
    const doc = v2()
    doc.modules.splice(doc.modules.length - 1, 0, ...(order as typeof doc.modules))
    expect(parse(doc).value).toEqual(doc)
  }
})
it('rejects every crossing of fixed slots', () => {
  const original = v2()
  original.modules.splice(2, 0, {
    id: `module_${uuid(50)}`,
    template: 'ticker',
    visible: true,
    navigation: 'none',
    content: { items: ['Delivery'] },
  })
  for (let i = 0; i < original.modules.length; i++)
    for (let j = i + 1; j < original.modules.length; j++) {
      const doc = structuredClone(original)
      ;[doc.modules[i], doc.modules[j]] = [doc.modules[j], doc.modules[i]]
      expect(parse(doc).fields).toBeDefined()
    }
})
for (const name of ['how', 'about', 'faq', 'highlight'] as const)
  it(`enforces ${name} cardinality`, () => {
    const doc = v2()
    const count = name === 'highlight' ? 4 : 2
    doc.modules.splice(
      doc.modules.length - 1,
      0,
      ...(Array.from({ length: count }, (_, i) =>
        institutional(name, i + 20),
      ) as typeof doc.modules),
    )
    expect(parse(doc).fields).toBeDefined()
  })
it('enforces identity, navigation, mandatory visibility, exact fields and carousel bounds', () => {
  const changes: ((doc: any) => void)[] = [
    (d) => (d.modules[1].id = 'hero'),
    (d) => (d.modules[1].region = 'intro'),
    (d) => (d.modules[0].visible = false),
    (d) => (d.modules[0].id = 'other'),
    (d) => (d.modules[1].navigation = 'cta'),
    (d) => d.modules[1].content.entries.push(d.modules[1].content.entries[0]),
    (d) =>
      (d.modules[1].content.entries = Array.from({ length: 13 }, (_, i) => ({
        itemId: `item-${i}`,
        media: null,
      }))),
    (d) => (d.modules[1].content.entries[0].itemId = '../escape'),
    (d) => (d.modules[1].content.entries[0].itemId = 'a'.repeat(129)),
  ]
  for (const change of changes) {
    const doc = v2()
    change(doc)
    expect(parse(doc).fields).toBeDefined()
  }
  const doc = v2()
  doc.modules[1] = carousel()
  doc.modules[1].content.entries = [{ itemId: 'a'.repeat(128), media: null }]
  expect(parse(doc).value).toEqual(doc)
})
for (const field of [
  'price',
  'priceCents',
  'volume',
  'volumeMl',
  'variant',
  'variants',
  'name',
  'description',
])
  it(`rejects commercial field ${field} at every editable nesting`, () => {
    for (const at of ['root', 'carousel', 'entry', 'media']) {
      const doc: any = v2()
      const c = doc.modules[1].content
      if (at === 'media') c.media = media()
      const target =
        at === 'root' ? doc : at === 'carousel' ? c : at === 'entry' ? c.entries[0] : c.media
      target[field] = 123
      expect(parse(doc).fields).toBeDefined()
    }
  })
it('start requires visible carousel; publish requires entries and alt if media exists', () => {
  const doc: any = v2()
  expect(parse(doc, 'start').value).toEqual(doc)
  doc.modules[1].visible = false
  expect(parse(doc, 'start').fields).toBeDefined()
  doc.modules.splice(1, 1)
  expect(parse(doc, 'start').fields).toBeDefined()
  expect(parse(doc).value).toEqual(doc)
  const pub: any = v2()
  pub.commercial.whatsappNumber = '5511998765432'
  Object.assign(pub.modules[0].content, { heading: 'Hero', summary: 'Summary', media: media(1) })
  Object.assign(pub.modules[2].content, { heading: 'Catalog', intro: 'Intro' })
  Object.assign(pub.modules[3].content, { heading: 'Contact', body: 'Body' })
  pub.modules[1].content.media = media(2)
  pub.modules[1].content.entries[0].media = media(3)
  expect(parse(pub, 'publish').value).toEqual(pub)
  pub.modules[1].content.entries[0].media.alt = ''
  expect(parse(pub, 'publish').fields).toBeDefined()
  pub.modules[1].content.entries = []
  expect(parse(pub, 'publish').fields).toBeDefined()
})
it('rejects unsafe content and enforces text, byte and list limits', () => {
  for (const bad of [
    '<script>x</script>',
    'https://evil.test',
    'java\nscript:evil',
    '\u202eunsafe',
    '\ud800',
  ]) {
    const doc: any = v2()
    doc.modules[1].content.lead = bad
    expect(parse(doc).fields).toBeDefined()
  }
  for (const [field, length] of [
    ['heading', 121],
    ['lead', 2001],
  ] as const) {
    const doc: any = v2()
    doc.modules[1].content[field] = 'x'.repeat(length)
    expect(parse(doc).fields).toBeDefined()
  }
  const large: any = v2()
  large.modules[1].content.entries[0].itemId = 'x'.repeat(70000)
  expect(parse(large).fields).toBeDefined()
  const doc: any = v2()
  doc.modules[1].content.heading = 'Horário:18h'
  doc.modules[1].content.lead = 'Linha 1\nLinha 2\tDelivery'
  expect(parse(doc).value).toEqual(doc)
})
it('materializes once and returns independent validated JSON', () => {
  let reads = 0
  const doc: any = v2()
  Object.defineProperty(doc.modules[1].content, 'heading', {
    enumerable: true,
    get() {
      return reads++ === 0 ? '<script>' : 'safe'
    },
  })
  expect(parse(doc).fields).toBeDefined()
  expect(reads).toBe(1)
  const safe = v2(),
    result = parse({ toJSON: () => safe })
  expect(result.value).toEqual(safe)
  safe.commercial.whatsappNumber = '5511998765432'
  expect(result.value?.commercial.whatsappNumber).toBeNull()
  const cycle: any = {}
  cycle.self = cycle
  expect(parse(cycle).fields).toBeDefined()
})
it('versioned mutation dispatch validates document and revision epoch', () => {
  const input = {
    action: 'saveDraft',
    expectedRevision: `c2_${uuid()}`,
    operationId: uuid(2),
    document: v2(),
  }
  expect(mutation(input).value).toEqual(input)
  expect(mutation({ ...input, extra: true }).fields).toBeDefined()
  expect(mutation({ ...input, expectedRevision: 'r0' }).fields).toBeDefined()
  expect(mutation({ ...input, document: { ...v2(), schemaVersion: 3 } }).code).toBe(
    'CMS_SCHEMA_UNSUPPORTED',
  )
})
it('public projection is allowlisted, omits hidden modules and never mutates its source', () => {
  const doc: any = v2()
  doc.commercial.whatsappNumber = '5511998765432'
  Object.assign(doc.modules[0].content, { heading: 'H', summary: 'S', media: media() })
  Object.assign(doc.modules[2].content, { heading: 'C', intro: 'I' })
  Object.assign(doc.modules[3].content, { heading: 'End', body: 'Contact' })
  doc.modules[1].content.media = media(2)
  const before = JSON.stringify(doc),
    result = project(doc)
  expect(Object.keys(result)).toEqual(['schemaVersion', 'commercial', 'modules'])
  expect(result.modules[1].anchor).toBe('barris')
  expect(result.modules[1].content.media).toEqual(media(2))
  expect(result.modules.every((m: any) => !('visible' in m) && !('region' in m))).toBe(true)
  expect(JSON.stringify(doc)).toBe(before)
  doc.modules[1].visible = false
  expect(project(doc).modules.map((m: any) => m.template)).not.toContain('carousel')
})

it('rejects a prototype key even alongside a supported schema', () => {
  const doc = JSON.parse(
    JSON.stringify(v2()).replace('"schemaVersion":2', '"schemaVersion":2,"__proto__":{}'),
  )
  expect(parse(doc).code).toBe('CMS_SCHEMA_UNSUPPORTED')
})
it('accepts exactly 65536 UTF-8 bytes and rejects the next byte', () => {
  const doc: any = v2()
  const how = institutional('how', 70),
    faq = institutional('faq', 71)
  doc.modules.splice(3, 0, how, faq)
  how.content = {
    heading: 'Como',
    steps: Array.from({ length: 12 }, () => ({ title: 'P', body: '' })),
  }
  faq.content = {
    heading: 'FAQ',
    items: Array.from({ length: 12 }, () => ({ question: 'Q', answer: '' })),
  }
  const fields = [
    ...(how.content as any).steps.map((o: any) => [o, 'body']),
    ...(faq.content as any).items.map((o: any) => [o, 'answer']),
  ]
  let last: any
  for (const [obj, key] of fields) {
    const remaining = 65536 - new TextEncoder().encode(JSON.stringify(doc)).length
    obj[key] = '界'.repeat(Math.min(2000, Math.floor(remaining / 3)))
    const rest = 65536 - new TextEncoder().encode(JSON.stringify(doc)).length
    obj[key] += 'x'.repeat(Math.min(rest, 2000 - obj[key].length))
    last = [obj, key]
    if (new TextEncoder().encode(JSON.stringify(doc)).length === 65536) break
  }
  expect(new TextEncoder().encode(JSON.stringify(doc))).toHaveLength(65536)
  expect(parse(doc).value).toEqual(doc)
  last[0][last[1]] += 'x'
  expect(parse(doc).fields).toEqual({ 'document.bytes': expect.any(String) })
})
for (const template of ['ticker', 'how', 'faq'] as const)
  it(`enforces the 12-entry list boundary for ${template}`, () => {
    const doc: any = v2(),
      block: any =
        template === 'ticker'
          ? {
              id: `module_${uuid(90)}`,
              template,
              visible: true,
              navigation: 'none',
              content: { items: [] },
            }
          : institutional(template, 90)
    const key = template === 'how' ? 'steps' : 'items'
    const item =
      template === 'ticker'
        ? 'Delivery'
        : template === 'how'
          ? { title: 'P', body: 'B' }
          : { question: 'Q', answer: 'A' }
    block.content[key] = Array.from({ length: 12 }, () => structuredClone(item))
    doc.modules.splice(template === 'ticker' ? 2 : 3, 0, block)
    expect(parse(doc).value).toEqual(doc)
    block.content[key].push(structuredClone(item))
    expect(parse(doc).fields).toBeDefined()
  })
