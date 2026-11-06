import { inspectImage, mediaHash } from './media-bytes'
import {
  type CmsDerivative,
  isValidDerivative,
  MEDIA_LIMITS,
  MEDIA_PROFILES,
} from './media-contract'
import type { MediaBucket } from './media-library'
import { cmsMediaId } from './primitives'
import { requirePublicationSchema } from './repository'

export type PublicMediaEnv = { DELEGAS_DB: D1Database; CMS_MEDIA_BUCKET?: MediaBucket }
type Profile = keyof typeof MEDIA_PROFILES

const BASE = {
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; sandbox",
} as const
// Errors are never cacheable: a 404 before publication must not outlive the publication.
const NO_STORE = { ...BASE, 'Cache-Control': 'no-store' } as const

const notFound = (head: boolean) =>
  new Response(
    head
      ? null
      : JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Mídia não encontrada.' } }),
    { status: 404, headers: { ...NO_STORE, 'Content-Type': 'application/json' } },
  )
const unavailable = (head: boolean) =>
  new Response(
    head
      ? null
      : JSON.stringify({ error: { code: 'MEDIA_UNAVAILABLE', message: 'Mídia indisponível.' } }),
    { status: 503, headers: { ...NO_STORE, 'Content-Type': 'application/json' } },
  )

/** Strong ETag match for the current derivative; `*` and weak validators are accepted per RFC 9110. */
function etagMatches(header: string | null, etag: string) {
  if (!header) return false
  return header
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === '*' || v === etag)
}

/**
 * Public, read-only delivery of ONE derivative of media referenced by the CURRENTLY published CMS
 * version. Authorization is re-evaluated against D1 on every request (no-cache + ETag revalidation),
 * so replacing or revoking a publication takes effect immediately. Never returns keys or manifests.
 */
export async function handlePublicMedia(
  request: Request,
  env: PublicMediaEnv,
  id: unknown,
  profile: unknown,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: 'GET, HEAD' } })
  const head = request.method === 'HEAD'
  if (
    typeof id !== 'string' ||
    !cmsMediaId(id) ||
    typeof profile !== 'string' ||
    !Object.hasOwn(MEDIA_PROFILES, profile)
  )
    return notFound(head)
  const bucket = env.CMS_MEDIA_BUCKET
  if (!bucket) return notFound(head)
  try {
    await requirePublicationSchema(env.DELEGAS_DB)
    // Only the published pointer authorizes delivery; drafts and orphan objects never match.
    const row = await env.DELEGAS_DB.prepare(
      `SELECT m.derivatives_json FROM cms_v2_state s
       JOIN cms_v2_versions v ON v.version_id=s.published_version_id AND v.kind='published'
       JOIN cms_v2_media_refs r ON r.version_id=v.version_id AND r.media_id=?
       JOIN cms_media m ON m.media_id=r.media_id AND m.state='ready'
       WHERE s.singleton=1`,
    )
      .bind(id)
      .first<{ derivatives_json: string | null }>()
    if (!row?.derivatives_json) return notFound(head)
    const manifest: unknown = JSON.parse(row.derivatives_json)
    const derivative =
      manifest && typeof manifest === 'object' && !Array.isArray(manifest)
        ? (manifest as Record<string, CmsDerivative | undefined>)[profile]
        : undefined
    if (!isValidDerivative(id, profile as Profile, derivative)) return notFound(head)
    const etag = `"${derivative.sha256}"`
    const headers = {
      ...BASE,
      'Content-Type': derivative.contentType,
      'Content-Length': String(derivative.bytes),
      'Content-Disposition': 'inline',
      // Revalidate on every use: a 304 still passes through the D1 authorization above.
      'Cache-Control': 'public, no-cache',
      ETag: etag,
    }
    if (etagMatches(request.headers.get('If-None-Match'), etag)) {
      const { 'Content-Length': _length, ...notModified } = headers
      return new Response(null, { status: 304, headers: notModified })
    }
    if (head) return new Response(null, { status: 200, headers })
    let timer: ReturnType<typeof setTimeout> | undefined
    let bytes: Uint8Array<ArrayBuffer> | null
    try {
      bytes = await Promise.race([
        (async () => {
          const object = await bucket.get(derivative.objectKey)
          if (
            !object ||
            object.key !== derivative.objectKey ||
            object.size !== derivative.bytes ||
            object.httpMetadata?.contentType !== derivative.contentType
          )
            return null
          return new Uint8Array(await object.arrayBuffer())
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MEDIA_TIMEOUT')), MEDIA_LIMITS.readMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    if (
      !bytes ||
      bytes.length !== derivative.bytes ||
      (await mediaHash(bytes)) !== derivative.sha256
    )
      return notFound(head)
    try {
      const info = inspectImage(bytes, derivative.contentType, true)
      if (info.width !== derivative.width || info.height !== derivative.height)
        return notFound(head)
    } catch {
      return notFound(head)
    }
    return new Response(bytes, { status: 200, headers })
  } catch {
    // D1/R2 failures: retryable by the client, details never serialized.
    return unavailable(head)
  }
}
