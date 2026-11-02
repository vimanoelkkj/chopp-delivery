import { CMS_LIMITS, type CmsConversionRequest } from '../../shared/cms'
import { cmsRevision, cmsUuid, materialize, text } from './primitives'
import { parseCmsDocument } from './validation-v2'
export function parseCmsConversion(
  input: unknown,
):
  | { value: CmsConversionRequest; fields?: never; code?: never }
  | { fields: Record<string, string>; code?: string; value?: never } {
  const parsed = materialize(input, CMS_LIMITS.bytes + 1024),
    m = parsed?.value
  const fail = () => ({ fields: { conversion: 'Invalid conversion command.' } })
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return fail()
  const c = m as Record<string, unknown>,
    required = ['action', 'expectedRevision', 'operationId'],
    allowed = [...required, 'acknowledge', ...(c.action === 'startV2' ? ['document'] : [])]
  if (
    !required.every((k) => Object.hasOwn(c, k)) ||
    Object.keys(c).some((k) => !allowed.includes(k)) ||
    !['previewConversion', 'convertToV2', 'startV2'].includes(c.action as string) ||
    !cmsRevision(c.expectedRevision) ||
    !cmsUuid(c.operationId)
  )
    return fail()
  let acknowledge: string[] | undefined
  if (Object.hasOwn(c, 'acknowledge')) {
    if (
      !Array.isArray(c.acknowledge) ||
      c.acknowledge.length > 24 ||
      !c.acknowledge.every((a) => typeof a === 'string' && text(a, 120, true)) ||
      new Set(c.acknowledge).size !== c.acknowledge.length
    )
      return fail()
    acknowledge = [...c.acknowledge].sort() as string[]
  }
  const base = {
    expectedRevision: c.expectedRevision,
    operationId: c.operationId,
    ...(acknowledge ? { acknowledge } : {}),
  }
  if (c.action === 'startV2') {
    const document = parseCmsDocument(c.document, 'start')
    if (!document.value) return document
    if (document.value.schemaVersion !== 2) return fail()
    return { value: { ...base, action: 'startV2', document: document.value } }
  }
  return { value: { ...base, action: c.action as 'previewConversion' | 'convertToV2' } }
}
