import type { CmsNavigation } from './common'
import { CMS_RULES_V2, type CmsDocumentV2, type CmsTemplateV2 } from './v2'

/** Compatibility with the approved public wrapper; CMS documents keep inicio. */
export const CMS_LAYOUT_HOME_ANCHOR = { cms: CMS_RULES_V2.hero.anchor, public: 'topo' } as const

export type CmsLayoutDiagnostic = {
  severity: 'error' | 'warning'
  code:
    | 'INVALID_DOCUMENT'
    | 'UNKNOWN_TEMPLATE'
    | 'INVALID_MODULE_ID'
    | 'DUPLICATE_MODULE_ID'
    | 'INVALID_MODULE'
    | 'INVALID_NAVIGATION'
    | 'ORPHAN_NAVIGATION'
    | 'MANDATORY_SECTION_HIDDEN'
    | 'TEMPLATE_CARDINALITY'
    | 'INSTITUTIONAL_LIMIT'
    | 'INVALID_SLOT_ORDER'
    | 'MISSING_REQUIRED_MODULE'
    | 'INVALID_CAROUSEL_CONTENT'
    | 'DUPLICATE_ANCHOR'
    | 'COMPOSITION_WITHOUT_CAROUSEL'
    | 'CAROUSEL_HIDDEN'
    | 'CAROUSEL_EMPTY'
  index?: number
}
export type DerivedCmsSection = {
  id: string
  template: CmsTemplateV2
  anchor: string | null
  navigation: CmsNavigation
  position: number
  number: string | null
}
export type DerivedCmsLayout = {
  sections: DerivedCmsSection[]
  navigation: {
    moduleId: string
    template: CmsTemplateV2
    href: string
    kind: Exclude<CmsNavigation, 'none'>
  }[]
  homeHref: string | null
  heroCarouselHref: string | null
  diagnostics: CmsLayoutDiagnostic[]
}
const required = ['hero', 'catalog', 'contact'] as const
// Matches the current numbered sections; promotional highlights stay unnumbered.
const numbered = new Set<CmsTemplateV2>(['carousel', 'catalog', 'how', 'about', 'faq'])
const optionalId = /^module_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
// Never invoke an accessor while inspecting structural metadata.
function field(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

/** Validated CMS v2 JSON in; fresh layout metadata out. Not a document validator or renderer. */
export function deriveLayout(doc: CmsDocumentV2): DerivedCmsLayout {
  const diagnostics: CmsLayoutDiagnostic[] = []
  const empty = (): DerivedCmsLayout => ({
    sections: [],
    navigation: [],
    homeHref: null,
    heroCarouselHref: null,
    diagnostics,
  })
  const error = (code: CmsLayoutDiagnostic['code'], index?: number) =>
    diagnostics.push({ severity: 'error', code, ...(index === undefined ? {} : { index }) })
  const modules = field(doc, 'modules')
  if (
    field(doc, 'schemaVersion') !== 2 ||
    !Array.isArray(modules) ||
    modules.length < 3 ||
    modules.length > 11
  ) {
    error('INVALID_DOCUMENT')
    return empty()
  }
  const ids = new Set<string>(),
    counts = new Map<CmsTemplateV2, number>()
  const candidates: (Omit<DerivedCmsSection, 'position' | 'number'> & {
    index: number
    visible: boolean
    entries?: number
  })[] = []
  let rank = -1,
    institutions = 0
  for (let index = 0; index < modules.length; index++) {
    const m = field(modules, index),
      template = field(m, 'template')
    if (typeof template !== 'string' || !Object.hasOwn(CMS_RULES_V2, template)) {
      error('UNKNOWN_TEMPLATE', index)
      continue
    }
    const t = template as CmsTemplateV2,
      rule = CMS_RULES_V2[t],
      mandatory = required.some((v) => v === t)
    const id = field(m, 'id'),
      visible = field(m, 'visible'),
      navigation = field(m, 'navigation')
    if (typeof id !== 'string' || (mandatory ? id !== t : !optionalId.test(id)))
      error('INVALID_MODULE_ID', index)
    if (typeof id === 'string') {
      if (ids.has(id)) error('DUPLICATE_MODULE_ID', index)
      ids.add(id)
    }
    if (typeof visible !== 'boolean') error('INVALID_MODULE', index)
    if (mandatory && visible !== true) error('MANDATORY_SECTION_HIDDEN', index)
    if (
      (navigation !== 'none' && navigation !== rule.navigation) ||
      (mandatory && navigation !== rule.navigation)
    )
      error('INVALID_NAVIGATION', index)
    if (rule.anchor === null && navigation !== 'none') error('ORPHAN_NAVIGATION', index)
    const count = (counts.get(t) ?? 0) + 1
    counts.set(t, count)
    if (count > rule.max) error('TEMPLATE_CARDINALITY', index)
    if (rule.rank === 4 && ++institutions > 6) error('INSTITUTIONAL_LIMIT', index)
    if (rule.rank < rank) error('INVALID_SLOT_ORDER', index)
    rank = Math.max(rank, rule.rank)
    let entries: number | undefined
    if (t === 'carousel') {
      const list = field(field(m, 'content'), 'entries')
      if (!Array.isArray(list) || list.length > 12) error('INVALID_CAROUSEL_CONTENT', index)
      else entries = list.length
    }
    if (
      typeof id === 'string' &&
      typeof visible === 'boolean' &&
      (navigation === 'none' || navigation === 'primary' || navigation === 'cta')
    )
      candidates.push({
        id,
        template: t,
        visible,
        navigation,
        anchor: t === 'hero' ? CMS_LAYOUT_HOME_ANCHOR.public : rule.anchor,
        index,
        entries,
      })
  }
  for (const t of required) if (!counts.has(t)) error('MISSING_REQUIRED_MODULE')
  if (diagnostics.length) return empty()
  const carousel = candidates.find((m) => m.template === 'carousel')
  if (!carousel) diagnostics.push({ severity: 'warning', code: 'COMPOSITION_WITHOUT_CAROUSEL' })
  else {
    if (!carousel.visible)
      diagnostics.push({ severity: 'warning', code: 'CAROUSEL_HIDDEN', index: carousel.index })
    if (carousel.entries === 0)
      diagnostics.push({ severity: 'warning', code: 'CAROUSEL_EMPTY', index: carousel.index })
  }
  const sections: DerivedCmsSection[] = [],
    anchors = new Set<string>()
  let number = 0
  for (const m of candidates) {
    if (!m.visible) continue
    if (m.anchor !== null) {
      if (anchors.has(m.anchor)) error('DUPLICATE_ANCHOR', m.index)
      anchors.add(m.anchor)
    }
    sections.push({
      id: m.id,
      template: m.template,
      anchor: m.anchor,
      navigation: m.navigation,
      position: sections.length + 1,
      number: numbered.has(m.template) ? String(++number).padStart(2, '0') : null,
    })
  }
  if (diagnostics.some((d) => d.severity === 'error')) return empty()
  return {
    sections,
    navigation: sections.flatMap((m) =>
      m.navigation === 'none' || m.anchor === null
        ? []
        : [{ moduleId: m.id, template: m.template, href: `#${m.anchor}`, kind: m.navigation }],
    ),
    homeHref: '#topo',
    heroCarouselHref: carousel?.visible && carousel.anchor ? `#${carousel.anchor}` : null,
    diagnostics,
  }
}
