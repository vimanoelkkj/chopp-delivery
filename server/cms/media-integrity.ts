import { inspectImage, mediaHash } from './media-bytes'
import { type CmsDerivative, MEDIA_LIMITS, MEDIA_PROFILES } from './media-contract'
import type { MediaBucket } from './media-library'

/** Evidence of this read, never a guarantee of future object availability. No historical rewrite. */
export async function verifyMediaObjects(
  db: D1Database,
  bucket: MediaBucket,
  id: string,
  manifest: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const checkId = crypto.randomUUID()
  const verification = async () => {
    const parsed = JSON.parse(manifest) as Record<string, CmsDerivative>
    if (!parsed || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'hero,section')
      throw new Error('MEDIA_OBJECT_INTEGRITY')
    for (const profile of Object.keys(MEDIA_PROFILES) as (keyof typeof MEDIA_PROFILES)[]) {
      const d = parsed[profile],
        bounds = MEDIA_PROFILES[profile]
      if (
        !d ||
        Object.keys(d).sort().join(',') !== 'bytes,contentType,height,objectKey,sha256,width' ||
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
        throw new Error('MEDIA_OBJECT_INTEGRITY')
      const object = await bucket.get(d.objectKey)
      if (
        !object ||
        object.key !== d.objectKey ||
        object.size !== d.bytes ||
        object.httpMetadata?.contentType !== d.contentType
      )
        throw new Error('MEDIA_OBJECT_INTEGRITY')
      const bytes = new Uint8Array(await object.arrayBuffer())
      if (bytes.length !== d.bytes || (await mediaHash(bytes)) !== d.sha256)
        throw new Error('MEDIA_OBJECT_INTEGRITY')
      const info = inspectImage(bytes, 'image/webp', true)
      if (info.width !== d.width || info.height !== d.height)
        throw new Error('MEDIA_OBJECT_INTEGRITY')
    }
  }
  let valid = false
  try {
    await Promise.race([
      verification(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MEDIA_TIMEOUT')), MEDIA_LIMITS.processingMs)
      }),
    ])
    valid = true
  } finally {
    clearTimeout(timer)
    await db
      .prepare(
        'INSERT INTO cms_media_checks(check_id,media_id,manifest_json,valid) VALUES(?,?,?,?)',
      )
      .bind(checkId, id, manifest, valid ? 1 : 0)
      .run()
  }
  return checkId
}
