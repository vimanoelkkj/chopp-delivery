import { expect, it } from 'vitest'
import { validateCmsDocument } from '../../server/cms/validation'
import { cmsDocument } from './cms-document-fixture'
import { convert, institutional, media, parse, uuid } from './cms-v2-fixture'

it('converts500 deterministic valid v1 documents without losses, IDs or editorial-order changes', () => {
  let seed = 0xc015face
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  let withBarrels = 0,
    withoutBarrels = 0
  for (let n = 0; n < 500; n++) {
    const doc = cmsDocument()
    const blocks: any[] = []
    for (const [i, t] of ['how', 'about', 'faq', 'highlight', 'highlight', 'highlight'].entries())
      if (next() % 3) {
        const m = institutional(t as 'how', i + 10)
        blocks.push({ ...m, region: 'details', visible: Boolean(next() % 2) })
      }
    if (next() % 3) {
      blocks.push({
        id: `module_${uuid(30)}`,
        template: 'barrels',
        region: 'details',
        visible: Boolean(next() % 2),
        navigation: 'primary',
        content: {
          heading: `Barrels ${n}`,
          body: `Editorial ${n}`,
          media: next() % 2 ? media(n + 100) : null,
        },
      })
      withBarrels++
    } else withoutBarrels++
    for (let i = blocks.length - 1; i > 0; i--) {
      const j = next() % (i + 1)
      ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    }
    doc.modules.splice(2, 0, ...blocks)
    if (next() % 2)
      doc.modules.splice(1, 0, {
        id: `module_${uuid(31)}`,
        template: 'ticker',
        region: 'intro',
        visible: true,
        navigation: 'none',
        content: { items: [`Ticker ${n}`] },
      })
    expect(validateCmsDocument(doc, 'draft').value).toEqual(doc)
    const before = JSON.stringify(doc),
      result = convert(doc)
    expect(result.document.schemaVersion).toBe(2)
    expect(result.losses).toEqual([])
    expect(parse(result.document).value).toEqual(result.document)
    expect(JSON.stringify(doc)).toBe(before)
    const oldInst = doc.modules.filter(
      (m) => !['hero', 'catalog', 'contact', 'ticker', 'barrels'].includes(m.template),
    )
    const newInst = result.document.modules.filter(
      (m: any) => !['hero', 'catalog', 'contact', 'ticker', 'carousel'].includes(m.template),
    )
    expect(newInst.map((m: any) => m.id)).toEqual(oldInst.map((m) => m.id))
    expect(result.document.modules.map((m: any) => m.id).sort()).toEqual(
      doc.modules.map((m) => m.id).sort(),
    )
    for (const old of doc.modules) {
      const current = result.document.modules.find((m: any) => m.id === old.id)
      expect(current.visible).toBe(old.visible)
      expect(current.navigation).toBe(old.navigation)
      if (old.template === 'barrels') {
        expect(current.template).toBe('carousel')
        expect(current.content).toEqual({
          heading: old.content.heading,
          lead: old.content.body,
          media: old.content.media,
          entries: [],
        })
        expect(result.warnings).toContain('CAROUSEL_EMPTY')
        if (!old.visible) expect(result.warnings).toContain('CAROUSEL_HIDDEN')
      } else expect(current.content).toEqual(old.content)
    }
    const ids = (modules: any[]) =>
      modules.flatMap((m) => (m.content.media ? [m.content.media.id] : [])).sort()
    expect(ids(result.document.modules)).toEqual(ids(doc.modules))
    if (!doc.modules.some((m) => m.template === 'barrels'))
      expect(result.warnings).toContain('COMPOSITION_WITHOUT_CAROUSEL')
  }
  expect(withBarrels).toBeGreaterThan(0)
  expect(withoutBarrels).toBeGreaterThan(0)
})
it('conversion mapping records preserved identity and template change and rejects malformed v1', () => {
  const doc = cmsDocument()
  doc.modules.splice(2, 0, {
    id: `module_${uuid()}`,
    template: 'barrels',
    region: 'details',
    visible: true,
    navigation: 'primary',
    content: { heading: 'B', body: 'Text', media: media() },
  })
  const result = convert(doc)
  expect(result.mapping).toContainEqual({
    from: { id: `module_${uuid()}`, template: 'barrels' },
    to: { id: `module_${uuid()}`, template: 'carousel' },
  })
  expect(() => convert({ ...doc, schemaVersion: 3 } as never)).toThrow(/CMS_CONVERSION_INVALID/)
})
