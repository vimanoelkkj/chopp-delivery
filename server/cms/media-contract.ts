import type { CmsDocument } from '../../shared/cms'
import { cmsMediaId } from './validation'

export type CmsMediaState =
  | 'quarantined'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'deleting'
  | 'deleted'
export type CmsDerivative = {
  objectKey: string
  sha256: string
  contentType: 'image/webp'
  width: number
  height: number
  bytes: number
}
export type CmsMediaRecord = {
  id: string
  state: CmsMediaState
  derivatives: { hero: CmsDerivative; section: CmsDerivative } | null
}
export const MEDIA_LIMITS = {
  inputBytes: 5 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024,
  dimension: 6000,
  pixels: 12_000_000,
  readMs: 5000,
  processingMs: 5000,
} as const
export const MEDIA_PROFILES = {
  hero: { width: 1920, height: 1080 },
  section: { width: 1200, height: 900 },
} as const

export function cmsMediaIds(document: CmsDocument): string[] {
  const ids = new Set<string>()
  for (const m of document.modules) {
    if ('media' in m.content && m.content.media) ids.add(m.content.media.id)
  }
  return [...ids].sort()
}

/** Integrity precondition only. SQL must repeat it atomically with publication/ref insertion. */
export function publicationMediaErrors(
  document: CmsDocument,
  inventory: ReadonlyMap<string, CmsMediaRecord>,
): string[] {
  return cmsMediaIds(document).filter((id) => {
    const record = inventory.get(id)
    if (!cmsMediaId(id) || record?.id !== id || record.state !== 'ready' || !record.derivatives)
      return true
    return (Object.keys(MEDIA_PROFILES) as (keyof typeof MEDIA_PROFILES)[]).some((profile) => {
      const d = record.derivatives?.[profile]
      const bounds = MEDIA_PROFILES[profile]
      return (
        !d ||
        !/^[0-9a-f]{64}$/.test(d.sha256) ||
        d.objectKey !== `cms/derived/${id}/${d.sha256}/${profile}.webp` ||
        d.contentType !== 'image/webp' ||
        !Number.isSafeInteger(d.bytes) ||
        d.bytes < 1 ||
        d.bytes > MEDIA_LIMITS.outputBytes ||
        !Number.isSafeInteger(d.width) ||
        !Number.isSafeInteger(d.height) ||
        d.width < 1 ||
        d.height < 1 ||
        d.width > bounds.width ||
        d.height > bounds.height
      )
    })
  })
}
