import {
  CMS_LIMITS,
  CMS_RULES,
  type CmsDocument,
  type CmsMutation,
  type CmsTemplate,
  type PublicCms,
} from '../cms'
import { cmsRevisionV1 as cmsRevision, cmsUuid, content, exact, materialize } from './primitives'

export { cmsMediaId, cmsRevisionV1 as cmsRevision, cmsUuid } from './primitives'

type Result<T> = { value: T; fields?: never } | { fields: Record<string, string>; value?: never }
type Mode = 'draft' | 'publish'
export const CMS_REQUEST_BYTES = CMS_LIMITS.bytes + 1024
/** Validate the same materialized JSON returned for persistence. HTTP limits precede this. */
export function validateCmsDocument(input: unknown, mode: Mode): Result<CmsDocument> {
  const fail = (path: string): Result<CmsDocument> => ({
    fields: { [path]: 'Contrato CMS inválido ou incompleto.' },
  })
  const parsed = materialize(input, CMS_LIMITS.bytes)
  if (!parsed) return fail('document.bytes')
  input = parsed.value
  if (!exact(input, ['schemaVersion', 'commercial', 'modules']) || input.schemaVersion !== 1)
    return fail('document')
  const { commercial, modules } = input
  if (
    !exact(commercial, ['fulfillmentMode', 'whatsappNumber']) ||
    commercial.fulfillmentMode !== 'delivery' ||
    (!(commercial.whatsappNumber === null && mode === 'draft') &&
      !(
        typeof commercial.whatsappNumber === 'string' &&
        /^[1-9][0-9]{7,14}$/.test(commercial.whatsappNumber)
      ))
  )
    return fail('commercial')
  if (!Array.isArray(modules) || modules.length < 3 || modules.length > CMS_LIMITS.modules)
    return fail('modules')
  const ids = new Set<string>()
  const counts = new Map<CmsTemplate, number>()
  const regions = ['start', 'intro', 'catalog', 'details', 'end']
  let position = -1
  for (const [index, m] of modules.entries()) {
    const path = `modules.${index}`
    if (
      !exact(m, ['id', 'template', 'region', 'visible', 'navigation', 'content']) ||
      typeof m.template !== 'string' ||
      !Object.hasOwn(CMS_RULES, m.template)
    )
      return fail(path)
    const template = m.template as CmsTemplate
    const rule = CMS_RULES[template]
    const mandatory = ['hero', 'catalog', 'contact'].includes(template)
    if (
      typeof m.id !== 'string' ||
      ids.has(m.id) ||
      (mandatory ? m.id !== template : !m.id.startsWith('module_') || !cmsUuid(m.id.slice(7)))
    )
      return fail(`${path}.id`)
    ids.add(m.id)
    const count = (counts.get(template) ?? 0) + 1
    counts.set(template, count)
    if (
      count > rule.max ||
      m.region !== rule.region ||
      typeof m.visible !== 'boolean' ||
      (mandatory && !m.visible) ||
      (m.navigation !== rule.navigation && (mandatory || m.navigation !== 'none'))
    )
      return fail(path)
    const nextPosition = regions.indexOf(rule.region)
    if (nextPosition < position) return fail(`${path}.region`)
    position = nextPosition
    if (!content(template, m.content, mode === 'publish' && m.visible))
      return fail(`${path}.content`)
  }
  if (!['hero', 'catalog', 'contact'].every((t) => counts.get(t as CmsTemplate) === 1))
    return fail('modules.required')
  return { value: input as CmsDocument }
}

export function validateCmsMutation(input: unknown): Result<CmsMutation> {
  input = materialize(input, CMS_REQUEST_BYTES)?.value
  if (
    !exact(input, ['action', 'expectedRevision', 'operationId', 'document']) ||
    !['saveDraft', 'publish'].includes(input.action as string) ||
    !cmsRevision(input.expectedRevision) ||
    !cmsUuid(input.operationId)
  )
    return { fields: { mutation: 'Ação, revisão ou operationId inválido.' } }
  const result = validateCmsDocument(
    input.document,
    input.action === 'publish' ? 'publish' : 'draft',
  )
  return result.value
    ? {
        value: {
          action: input.action as CmsMutation['action'],
          expectedRevision: input.expectedRevision,
          operationId: input.operationId,
          document: result.value,
        },
      }
    : { fields: result.fields }
}

/** Allowlisted projection. Call only for a persisted published version, never for the draft pointer. */
export function projectPublicCms(input: unknown): PublicCms {
  const result = validateCmsDocument(input, 'publish')
  if (!result.value?.commercial.whatsappNumber) throw new Error('CMS_NOT_PUBLISHABLE')
  const { modules } = result.value
  return {
    schemaVersion: 1,
    commercial: {
      fulfillmentMode: 'delivery',
      whatsappNumber: result.value.commercial.whatsappNumber,
    },
    modules: modules
      .filter((m) => m.visible)
      .map((m) => ({
        id: m.id,
        template: m.template,
        region: m.region,
        navigation: m.navigation,
        anchor: CMS_RULES[m.template].anchor,
        content: m.content,
      })),
  }
}
