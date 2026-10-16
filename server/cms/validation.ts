import {
  CMS_LIMITS,
  CMS_RULES,
  type CmsDocument,
  type CmsMutation,
  type CmsTemplate,
  type PublicCms,
} from '../../shared/cms'
import { containsControls, unsafeUnicode } from '../admin-catalog/validation'

type Result<T> = { value: T; fields?: never } | { fields: Record<string, string>; value?: never }
type Mode = 'draft' | 'publish'
export const cmsUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
export const cmsMediaId = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('media_') && cmsUuid(v.slice(6))
export const cmsRevision = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('c1_') && cmsUuid(v.slice(3))

function exact(v: unknown, keys: string[]): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  )
}
function text(v: unknown, max: number, required: boolean, multiline = false): boolean {
  return (
    typeof v === 'string' &&
    [...v].length <= max &&
    !unsafeUnicode(v) &&
    !containsControls(v, multiline) &&
    !(multiline ? /[\u007f-\u009f]/u : /[\p{Cc}\p{Zl}\p{Zp}]/u).test(v) &&
    !/[<>]|\b(?:https?|ftp|sftp|javascript|vbscript|data|file|blob|mailto|tel|sms|wss?):|[a-z][a-z0-9+.-]*:\s*\/\/|\/\/|www\./iu.test(
      v.replace(/[\p{Default_Ignorable_Code_Point}\t\r\n]/gu, ''),
    ) &&
    (!required ||
      /[\p{Letter}\p{Number}\p{Punctuation}\p{Symbol}]/u.test(
        v.replace(/[\p{Default_Ignorable_Code_Point}\p{White_Space}\p{Mark}\u2800]/gu, ''),
      ))
  )
}
function media(v: unknown, required: boolean, allowNull = !required): boolean {
  return (
    (v === null && allowNull) ||
    (exact(v, ['id', 'alt']) && cmsMediaId(v.id) && text(v.alt, 200, required))
  )
}
function content(template: CmsTemplate, v: unknown, required: boolean): boolean {
  const heading = (value: unknown) => text(value, CMS_LIMITS.heading, required)
  const body = (value: unknown) => text(value, CMS_LIMITS.text, required, true)
  if (template === 'hero')
    return (
      exact(v, ['heading', 'summary', 'media']) &&
      heading(v.heading) &&
      body(v.summary) &&
      media(v.media, required)
    )
  if (template === 'catalog')
    return exact(v, ['heading', 'intro']) && heading(v.heading) && body(v.intro)
  if (template === 'contact')
    return exact(v, ['heading', 'body']) && heading(v.heading) && body(v.body)
  if (['about', 'barrels', 'highlight'].includes(template))
    return (
      exact(v, ['heading', 'body', 'media']) &&
      heading(v.heading) &&
      body(v.body) &&
      media(v.media, required, true)
    )
  const key = template === 'how' ? 'steps' : 'items'
  if (!exact(v, template === 'ticker' ? [key] : ['heading', key])) return false
  if (template !== 'ticker' && !heading(v.heading)) return false
  const list = v[key]
  if (!Array.isArray(list) || list.length > CMS_LIMITS.list || (required && !list.length))
    return false
  return list.every((item) => {
    if (template === 'ticker') return heading(item)
    const keys = template === 'how' ? ['title', 'body'] : ['question', 'answer']
    return exact(item, keys) && heading(item[keys[0]]) && body(item[keys[1]])
  })
}

export const CMS_REQUEST_BYTES = CMS_LIMITS.bytes + 1024
function materialize(input: unknown, limit: number): { value: unknown } | null {
  try {
    const json = JSON.stringify(input)
    if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > limit) return null
    return { value: JSON.parse(json) }
  } catch {
    return null
  }
}
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
