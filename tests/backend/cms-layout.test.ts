import { existsSync, readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { expect, it, vi } from 'vitest'
import { parseCmsDocument } from '../../server/cms/validation-v2'
import * as cms from '../../shared/cms'
import type { DerivedCmsLayout } from '../../shared/cms/layout'
import { CMS_RULES_V2, type CmsDocumentV2, type CmsModuleV2 } from '../../shared/cms/v2'
import { institutional, uuid, v2 } from './cms-v2-fixture'

// The existing facade makes the red phase behavioral, without a missing runtime import.
const derive = (doc: CmsDocumentV2): DerivedCmsLayout => {
  const fn = (cms as unknown as { deriveLayout?: (d: CmsDocumentV2) => DerivedCmsLayout })
    .deriveLayout
  return fn
    ? fn(doc)
    : { sections: [], navigation: [], homeHref: null, heroCarouselHref: null, diagnostics: [] }
}
function valid(input: unknown): CmsDocumentV2 {
  const result = parseCmsDocument(input)
  if (result.value?.schemaVersion !== 2)
    throw Error('Invalid test document: ' + JSON.stringify(result.fields))
  return result.value
}
function complete() {
  const doc = v2()
  doc.modules.splice(2, 0, {
    id: `module_${uuid(2)}`,
    template: 'ticker',
    visible: true,
    navigation: 'none',
    content: { items: ['Delivery'] },
  })
  const institutions = ['how', 'about', 'faq', 'highlight', 'highlight', 'highlight'].map(
    (t, i) => {
      const m = institutional(t as 'how', i + 10)
      m.navigation = CMS_RULES_V2[t as 'how'].navigation
      return m
    },
  )
  doc.modules.splice(4, 0, ...(institutions as CmsModuleV2[]))
  return valid(doc)
}
const numbered = new Set(['carousel', 'catalog', 'how', 'about', 'faq'])
function assertVisibleOrder(doc: CmsDocumentV2, layout: DerivedCmsLayout) {
  const visible = doc.modules.filter((m) => m.visible)
  expect(layout.sections.map((m) => m.id)).toEqual(visible.map((m) => m.id))
  expect(layout.sections.map((m) => m.template)).toEqual(visible.map((m) => m.template))
  expect(layout.sections.map((m) => m.position)).toEqual(visible.map((_, i) => i + 1))
  let n = 0
  expect(layout.sections.map((m) => m.number)).toEqual(
    visible.map((m) => (numbered.has(m.template) ? String(++n).padStart(2, '0') : null)),
  )
  const anchors = new Set(layout.sections.map((m) => m.anchor).filter(Boolean))
  expect(layout.navigation.map((m) => m.moduleId)).toEqual(
    visible.filter((m) => m.navigation !== 'none').map((m) => m.id),
  )
  for (const link of layout.navigation) {
    expect(anchors.has(link.href.slice(1))).toBe(true)
    expect(
      layout.sections.some((m) => m.id === link.moduleId && '#' + m.anchor === link.href),
    ).toBe(true)
  }
}
it('exports a shared pure layout, preserves approved numbering and maps inicio to public topo', () => {
  expect(typeof (cms as unknown as Record<string, unknown>).deriveLayout).toBe('function')
  const doc = complete(),
    before = JSON.stringify(doc),
    layout = derive(doc)
  assertVisibleOrder(doc, layout)
  expect(layout.homeHref).toBe('#topo')
  expect(layout.sections[0].anchor).toBe('topo')
  expect(CMS_RULES_V2.hero.anchor).toBe('inicio')
  expect(layout.heroCarouselHref).toBe('#barris')
  expect(layout.navigation.map((n) => [n.href, n.kind])).toEqual([
    ['#barris', 'primary'],
    ['#chopes', 'primary'],
    ['#como', 'primary'],
    ['#faq', 'primary'],
    ['#contato', 'cta'],
  ])
  expect(layout.sections.filter((m) => m.template === 'highlight').map((m) => m.number)).toEqual([
    null,
    null,
    null,
  ])
  expect(layout.diagnostics).toEqual([])
  expect(JSON.stringify(doc)).toBe(before)
})
function* permutations<T>(values: T[]): Generator<T[]> {
  if (!values.length) {
    yield []
    return
  }
  for (let i = 0; i < values.length; i++)
    for (const rest of permutations(values.filter((_, j) => j !== i))) yield [values[i], ...rest]
}
it('all 720 institutional permutations retain editorial order, numbering and valid navigation', () => {
  const source = complete(),
    institutions = source.modules.slice(4, -1)
  let count = 0
  for (const order of permutations(institutions)) {
    const doc = valid({
      ...source,
      modules: [...source.modules.slice(0, 4), ...order, source.modules.at(-1)],
    })
    const layout = derive(doc)
    assertVisibleOrder(doc, layout)
    expect(layout.diagnostics).toEqual([])
    count++
  }
  expect(count).toBe(720)
})
it('every absent/hidden optional-module combination has no orphan link or numbering gap', () => {
  const source = complete(),
    optional = source.modules.filter((m) => !['hero', 'catalog', 'contact'].includes(m.template))
  expect(optional).toHaveLength(8)
  for (let mask = 0; mask < 256; mask++) {
    for (const mode of ['hidden', 'absent']) {
      const modules = source.modules.flatMap((m) => {
        const i = optional.findIndex((o) => o.id === m.id)
        if (i < 0 || !(mask & (1 << i))) return [m]
        return mode === 'hidden' ? [{ ...m, visible: false }] : []
      })
      const doc = valid({ ...source, modules }),
        layout = derive(doc)
      assertVisibleOrder(doc, layout)
      const carousel = doc.modules.find((m) => m.template === 'carousel')
      expect(layout.heroCarouselHref).toBe(carousel?.visible ? '#barris' : null)
      expect(layout.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      if (!carousel)
        expect(layout.diagnostics.map((d) => d.code)).toContain('COMPOSITION_WITHOUT_CAROUSEL')
      else if (!carousel.visible)
        expect(layout.diagnostics.map((d) => d.code)).toContain('CAROUSEL_HIDDEN')
    }
  }
})
it('empty carousel remains an explicit destination, with a diagnostic and no invented entries/media', () => {
  const doc = v2(),
    c = doc.modules.find((m) => m.template === 'carousel')!
  if (c.template !== 'carousel') throw Error('fixture')
  c.content.entries = []
  const layout = derive(valid(doc))
  expect(layout.heroCarouselHref).toBe('#barris')
  expect(layout.diagnostics.map((d) => d.code)).toContain('CAROUSEL_EMPTY')
  expect(layout.sections.map((s) => s.template)).toEqual(doc.modules.map((m) => m.template))
  expect(JSON.stringify(layout)).not.toMatch(/entries|media|price|volume|whatsappNumber/)
  expect(c.content.entries).toEqual([])
})
const corruptions: [string, (doc: CmsDocumentV2) => void, string][] = [
  [
    'duplicate ID, even hidden',
    (d) => {
      d.modules[1].id = d.modules[4].id
      d.modules[1].visible = false
    },
    'DUPLICATE_MODULE_ID',
  ],
  [
    'missing hero',
    (d) => {
      d.modules.shift()
    },
    'MISSING_REQUIRED_MODULE',
  ],
  [
    'hidden catalog',
    (d) => {
      d.modules.find((m) => m.template === 'catalog')!.visible = false
    },
    'MANDATORY_SECTION_HIDDEN',
  ],
  [
    'crossed slots',
    (d) => {
      ;[d.modules[1], d.modules[3]] = [d.modules[3], d.modules[1]]
    },
    'INVALID_SLOT_ORDER',
  ],
  [
    'unknown template',
    (d) => {
      Object.assign(d.modules[1], { template: '<script>' })
    },
    'UNKNOWN_TEMPLATE',
  ],
  [
    'duplicate singleton template',
    (d) => {
      Object.assign(d.modules[2], {
        template: 'carousel',
        content: d.modules[1].content,
        navigation: 'primary',
      })
    },
    'TEMPLATE_CARDINALITY',
  ],
  [
    'orphan navigation',
    (d) => {
      d.modules[2].navigation = 'primary'
    },
    'ORPHAN_NAVIGATION',
  ],
  [
    'invalid ID',
    (d) => {
      d.modules[1].id = 'javascript:alert(1)'
    },
    'INVALID_MODULE_ID',
  ],
  [
    'wrong identity',
    (d) => {
      d.modules[0].id = 'module_' + uuid(99)
    },
    'INVALID_MODULE_ID',
  ],
]
for (const [name, mutate, code] of corruptions)
  it(`fails closed for ${name}, with diagnostics instead of partial links`, () => {
    const doc = complete()
    mutate(doc)
    const layout = derive(doc)
    expect(layout.sections).toEqual([])
    expect(layout.navigation).toEqual([])
    expect(layout.homeHref).toBeNull()
    expect(layout.heroCarouselHref).toBeNull()
    expect(layout.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, severity: 'error' })]),
    )
  })
for (const value of [
  null,
  {},
  { schemaVersion: 1, modules: [] },
  { schemaVersion: 2, modules: [] },
])
  it(`fails closed for an invalid document envelope ${JSON.stringify(value)}`, () => {
    const layout = derive(value as unknown as CmsDocumentV2)
    expect(layout.sections).toEqual([])
    expect(layout.diagnostics.map((d) => d.code)).toContain('INVALID_DOCUMENT')
  })
it('does not evaluate editorial accessors, injected anchors, APIs, cookies or storage', () => {
  const doc = complete(),
    probe = vi.fn(() => {
      throw Error('effect')
    })
  Object.defineProperty(doc.modules[0].content, 'heading', { get: probe })
  Object.assign(doc.modules[1], { anchor: 'javascript:alert(1)' })
  vi.stubGlobal('fetch', probe)
  vi.stubGlobal('document', {
    get cookie() {
      return probe()
    },
  })
  vi.stubGlobal('localStorage', { getItem: probe })
  vi.stubGlobal('sessionStorage', { getItem: probe })
  let layout: DerivedCmsLayout
  try {
    layout = derive(doc)
  } finally {
    vi.unstubAllGlobals()
  }
  expect(layout.sections).toHaveLength(doc.modules.length)
  expect(layout.heroCarouselHref).toBe('#barris')
  expect(JSON.stringify(layout)).not.toContain('javascript:')
  expect(probe).not.toHaveBeenCalled()
})
it('is deterministic and independent of source and output mutations', () => {
  const doc = complete(),
    before = JSON.stringify(doc)
  function freeze(value: unknown) {
    if (typeof value === 'object' && value !== null) {
      for (const nested of Object.values(value)) freeze(nested)
      Object.freeze(value)
    }
  }
  freeze(doc)
  const a = derive(doc),
    b = derive(doc)
  expect(a).toEqual(b)
  expect(a.sections).toHaveLength(doc.modules.length)
  a.sections[0].id = 'changed output'
  expect(b.sections[0].id).toBe('hero')
  expect(JSON.stringify(doc)).toBe(before)
})
it('has a client-neutral bundled dependency closure without cycles or server/React imports', async () => {
  expect(existsSync('shared/cms/layout.ts')).toBe(true)
  const result = await build({
    entryPoints: ['shared/cms/layout.ts'],
    bundle: true,
    write: false,
    platform: 'neutral',
    metafile: true,
    logLevel: 'silent',
  })
  const inputs = result.metafile!.inputs
  expect(Object.keys(inputs).length).toBeGreaterThanOrEqual(2)
  for (const [file, info] of Object.entries(inputs)) {
    expect(file).toMatch(/^shared\/cms\/(layout|v2|v1|common)\.ts$/)
    expect(info.imports.filter((i) => i.external)).toEqual([])
  }
  const active = new Set<string>(),
    done = new Set<string>()
  function visit(file: string) {
    expect(active.has(file)).toBe(false)
    if (done.has(file)) return
    active.add(file)
    for (const i of inputs[file]?.imports ?? []) if (!i.external) visit(i.path)
    active.delete(file)
    done.add(file)
  }
  for (const file of Object.keys(inputs)) visit(file)
  const source = readFileSync('shared/cms/layout.ts', 'utf8')
  expect(source).not.toMatch(/\b(fetch|eval|Function|document|localStorage|sessionStorage)\s*[.(]/)
})
