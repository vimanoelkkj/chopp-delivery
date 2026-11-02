import {
  CMS_ITEM_ID_PATTERN,
  CMS_LIMITS,
  CMS_RULES_V2,
  type CmsAnyDocument,
  type CmsDocumentV2,
  type CmsMutation,
  type CmsMutationV2,
  type CmsTemplateV2,
  type PublicCmsV2,
} from '../cms'
import { cmsRevision, cmsUuid, content, exact, materialize, media, text } from './primitives'
import { CMS_REQUEST_BYTES, validateCmsDocument } from './validation-v1'

type Mode = 'draft' | 'publish' | 'start'
type Result<T> =
  | { value: T; fields?: never; code?: never }
  | { fields: Record<string, string>; code?: string; value?: never }
const failure = (path: string): Result<never> => ({
  fields: { [path]: 'Contrato CMS inválido ou incompleto.' },
})
export function parseCmsDocument(input: unknown, mode: Mode = 'draft'): Result<CmsAnyDocument> {
  const parsed = materialize(input, CMS_LIMITS.bytes)
  if (!parsed) return failure('document.bytes')
  const doc = parsed.value
  if (
    typeof doc !== 'object' ||
    doc === null ||
    Array.isArray(doc) ||
    !('schemaVersion' in doc) ||
    !Object.hasOwn(doc, 'schemaVersion') ||
    Object.hasOwn(doc, '__proto__') ||
    (doc.schemaVersion !== 1 && doc.schemaVersion !== 2)
  )
    return {
      code: 'CMS_SCHEMA_UNSUPPORTED',
      fields: { schemaVersion: 'Versão CMS não suportada.' },
    }
  if (doc.schemaVersion === 1)
    return mode === 'start' ? failure('modules.carousel') : validateCmsDocument(doc, mode)
  if (!exact(doc, ['schemaVersion', 'commercial', 'modules'])) return failure('document')
  const { commercial, modules } = doc as Record<string, unknown>
  if (
    !exact(commercial, ['fulfillmentMode', 'whatsappNumber']) ||
    commercial.fulfillmentMode !== 'delivery' ||
    (!(commercial.whatsappNumber === null && mode !== 'publish') &&
      !(
        typeof commercial.whatsappNumber === 'string' &&
        /^[1-9][0-9]{7,14}$/.test(commercial.whatsappNumber)
      ))
  )
    return failure('commercial')
  if (!Array.isArray(modules) || modules.length < 3 || modules.length > 11)
    return failure('modules')
  const ids = new Set<string>(),
    counts = new Map<CmsTemplateV2, number>()
  let rank = -1,
    institutions = 0
  for (const [index, m] of modules.entries()) {
    const path = `modules.${index}`
    if (
      !exact(m, ['id', 'template', 'visible', 'navigation', 'content']) ||
      typeof m.template !== 'string' ||
      !Object.hasOwn(CMS_RULES_V2, m.template)
    )
      return failure(path)
    const template = m.template as CmsTemplateV2,
      rule = CMS_RULES_V2[template],
      mandatory = ['hero', 'catalog', 'contact'].includes(template)
    if (
      typeof m.id !== 'string' ||
      ids.has(m.id) ||
      (mandatory ? m.id !== template : !m.id.startsWith('module_') || !cmsUuid(m.id.slice(7)))
    )
      return failure(`${path}.id`)
    ids.add(m.id)
    const count = (counts.get(template) ?? 0) + 1
    counts.set(template, count)
    if (
      count > rule.max ||
      typeof m.visible !== 'boolean' ||
      (mandatory && !m.visible) ||
      (m.navigation !== rule.navigation && (mandatory || m.navigation !== 'none')) ||
      rule.rank < rank
    )
      return failure(path)
    rank = rule.rank
    if (rank === 4 && ++institutions > 6) return failure('modules.institutional')
    const required = mode === 'publish' && m.visible
    if (template !== 'carousel') {
      if (!content(template, m.content, required)) return failure(`${path}.content`)
      continue
    }
    const c = m.content
    if (
      !exact(c, ['heading', 'lead', 'media', 'entries']) ||
      !text(c.heading, CMS_LIMITS.heading, required) ||
      !text(c.lead, CMS_LIMITS.text, required, true) ||
      !media(c.media, required, true) ||
      !Array.isArray(c.entries) ||
      c.entries.length > 12 ||
      (required && c.entries.length === 0)
    )
      return failure(`${path}.content`)
    const itemIds = new Set<string>()
    for (const entry of c.entries) {
      if (
        !exact(entry, ['itemId', 'media']) ||
        typeof entry.itemId !== 'string' ||
        !CMS_ITEM_ID_PATTERN.test(entry.itemId) ||
        itemIds.has(entry.itemId) ||
        !media(entry.media, required, true)
      )
        return failure(`${path}.entries`)
      itemIds.add(entry.itemId)
    }
  }
  if (!['hero', 'catalog', 'contact'].every((t) => counts.get(t as CmsTemplateV2) === 1))
    return failure('modules.required')
  if (mode === 'start' && !modules.some((m) => m.template === 'carousel' && m.visible))
    return failure('modules.carousel')
  return { value: doc as CmsDocumentV2 }
}
export function parseCmsMutation(input: unknown): Result<CmsMutation | CmsMutationV2> {
  const parsed = materialize(input, CMS_REQUEST_BYTES)
  if (!parsed) return failure('mutation.bytes')
  const m = parsed.value
  if (
    !exact(m, ['action', 'expectedRevision', 'operationId', 'document']) ||
    !['saveDraft', 'publish'].includes(m.action as string) ||
    !cmsRevision(m.expectedRevision) ||
    !cmsUuid(m.operationId)
  )
    return failure('mutation')
  const document = parseCmsDocument(m.document, m.action === 'publish' ? 'publish' : 'draft')
  if (!document.value) return document
  const base = {
    action: m.action as 'saveDraft' | 'publish',
    expectedRevision: m.expectedRevision,
    operationId: m.operationId,
  }
  return document.value.schemaVersion === 1
    ? { value: { ...base, document: document.value } }
    : { value: { ...base, document: document.value } }
}
export function projectPublicCmsV2(input: unknown): PublicCmsV2 {
  const parsed = parseCmsDocument(input, 'publish'),
    doc = parsed.value
  if (doc?.schemaVersion !== 2 || !doc.commercial.whatsappNumber)
    throw new Error('CMS_NOT_PUBLISHABLE')
  return {
    schemaVersion: 2,
    commercial: { fulfillmentMode: 'delivery', whatsappNumber: doc.commercial.whatsappNumber },
    modules: doc.modules
      .filter((m) => m.visible)
      .map((m) => ({
        id: m.id,
        template: m.template,
        navigation: m.navigation,
        content: m.content,
        anchor: CMS_RULES_V2[m.template].anchor,
      })) as PublicCmsV2['modules'],
  }
}
