import { CMS_LIMITS, type CmsTemplate } from '../cms'
import { containsControls, unsafeUnicode } from '../unicode-policy'
export const cmsUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
export const cmsMediaId = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('media_') && cmsUuid(v.slice(6))
export const cmsRevisionV1 = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('c1_') && cmsUuid(v.slice(3))

export function exact(v: unknown, keys: string[]): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  )
}
export function text(v: unknown, max: number, required: boolean, multiline = false): boolean {
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
export function media(v: unknown, required: boolean, allowNull = !required): boolean {
  return (
    (v === null && allowNull) ||
    (exact(v, ['id', 'alt']) && cmsMediaId(v.id) && text(v.alt, 200, required))
  )
}
export function content(template: CmsTemplate, v: unknown, required: boolean): boolean {
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

export function materialize(input: unknown, limit: number): { value: unknown } | null {
  try {
    const json = JSON.stringify(input)
    if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > limit) return null
    return { value: JSON.parse(json) }
  } catch {
    return null
  }
}

export const cmsRevision = (v: unknown): v is string =>
  cmsRevisionV1(v) || (typeof v === 'string' && v.startsWith('c2_') && cmsUuid(v.slice(3)))
