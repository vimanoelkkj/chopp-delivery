import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authJson, wrongMethod } from '../auth/http'
import { adminWriteProof } from '../auth/session'
import { inspectImage, mediaHash, readMediaBytes } from './media-bytes'
import { type CmsDerivative, MEDIA_LIMITS, MEDIA_PROFILES } from './media-contract'
import { cmsMediaId, cmsUuid } from './validation'

// Optional capabilities exist only in the disposable runtime, not in wrangler.jsonc.
export type MediaBucket = {
  put(
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    options?: { onlyIf?: { etagDoesNotMatch: string }; httpMetadata?: { contentType: string } },
  ): Promise<unknown>
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>
  list(options: {
    prefix: string
    cursor?: string
    limit?: number
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>
  delete(key: string): Promise<void>
}
export type LocalMediaEnv = AuthEnv & {
  CMS_MEDIA_LOCAL?: string
  CMS_MEDIA_BUCKET?: MediaBucket
  CMS_MEDIA_PROCESSOR?: Pick<Fetcher, 'fetch'>
}
type MediaRow = {
  media_id: string
  state: string
  revision: string
  derivatives_json: string | null
}
type Job = {
  operation_id: string
  action: string
  media_id: string | null
  actor_id: string
  request_hash: string
  expected_revision: string | null
  status: string
}
const nowSql = "CAST(unixepoch('subsec') * 1000 AS INTEGER)"
const error = (code: string, status: number) => authJson({ error: { code } }, status)

export async function handleLocalMedia(
  request: Request,
  env: LocalMediaEnv,
  id?: string,
  reconcile = false,
): Promise<Response> {
  // A production origin or a missing capability fails closed even if a flag is copied.
  const url = new URL(request.url)
  if (
    env.CMS_MEDIA_LOCAL !== 'disposable-v1' ||
    env.ADMIN_ALLOW_INSECURE_LOCAL !== '1' ||
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !env.CMS_MEDIA_BUCKET ||
    !env.CMS_MEDIA_PROCESSOR
  )
    return error('NOT_FOUND', 404)
  const allowed = reconcile ? 'POST' : id ? 'GET, DELETE' : 'POST'
  if (!(reconcile ? ['POST'] : id ? ['GET', 'DELETE'] : ['POST']).includes(request.method))
    return wrongMethod(request, allowed)
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  if (id && !cmsMediaId(id)) return error('INVALID_REQUEST', 400)
  const db = env.DELEGAS_DB,
    bucket = env.CMS_MEDIA_BUCKET,
    processor = env.CMS_MEDIA_PROCESSOR
  const proof = adminWriteProof(auth.principal, auth.config)
  const sql = (query: string, values: unknown[] = []) =>
    db.prepare(query).bind(...values, ...proof.values)
  const authorized = async () => {
    if (!(await sql(`SELECT 1 AS ok WHERE ${proof.sql}`).first()))
      throw new Error('MEDIA_UNAUTHORIZED')
  }
  const row = () =>
    sql(
      `SELECT media_id,state,revision,derivatives_json FROM cms_media WHERE media_id=? AND ${proof.sql}`,
      [id],
    ).first<MediaRow>()
  const present = (record: MediaRow | null, job?: Job) =>
    record
      ? authJson(
          {
            media: {
              id: record.media_id,
              state: record.state,
              revision: record.revision,
              // Internal manifests/object keys are never returned to the browser.
              profiles: record.state === 'ready' ? Object.keys(MEDIA_PROFILES) : [],
            },
            ...(job ? { operation: { id: job.operation_id, status: job.status } } : {}),
          },
          200,
          { ETag: `"${record.revision}"` },
        )
      : error('MEDIA_NOT_FOUND', 404)
  let job: Job | null = null
  let token = ''
  let intake = ''
  try {
    if (request.method === 'GET') {
      await authorized()
      return present(await row())
    }
    token = request.headers.get('x-operation-id') ?? ''
    if (!cmsUuid(token)) return error('INVALID_OPERATION', 400)
    const action = reconcile ? 'reconcile' : id ? 'delete' : 'upload'
    const precondition = request.headers.get(action === 'upload' ? 'if-none-match' : 'if-match')
    if (precondition === null) return error('PRECONDITION_REQUIRED', 428)
    if (
      action === 'upload'
        ? precondition !== '*'
        : action === 'reconcile'
          ? precondition !== '"local-media-v1"'
          : !/^"(?:m0|[0-9a-f-]{36})"$/.test(precondition)
    )
      return error('INVALID_PRECONDITION', 400)
    let input: Uint8Array<ArrayBuffer> | undefined
    const mime = request.headers.get('content-type') ?? ''
    // Claim the global slot before reading the body: concurrent requests cannot buffer images.
    const existing = await sql(
      `SELECT * FROM cms_media_jobs WHERE operation_id=? AND ${proof.sql}`,
      [token],
    ).first<Job>()
    const target = action === 'upload' ? `media_${token}` : (id ?? null)
    if (
      existing &&
      (existing.expected_revision !== precondition.slice(1, -1) ||
        existing.action !== action ||
        existing.media_id !== target ||
        existing.actor_id !== auth.principal.user.id)
    )
      throw new Error('MEDIA_CONFLICT')
    if (action === 'upload') {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || !request.body)
        return error('MEDIA_INVALID', 400)
      const length = request.headers.get('content-length')
      if (length && (!/^\d+$/.test(length) || Number(length) > MEDIA_LIMITS.inputBytes))
        return error('MEDIA_BYTES', 413)
    }
    if (existing?.status === 'running') return error('MEDIA_BUSY', 409)
    if (action === 'upload') {
      intake = crypto.randomUUID()
      const claimed = await sql(
        `INSERT INTO cms_media_intake(singleton,owner,expires_at)
        SELECT 1,?,${nowSql}+20000 WHERE ${proof.sql}
        ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
          WHERE cms_media_intake.expires_at<=${nowSql}`,
        [intake],
      ).run()
      if (claimed.meta.changes !== 1) throw new Error('MEDIA_BUSY')
    }
    if (!existing) {
      if (action === 'reconcile') {
        // Fence expired operations first. Late R2 effects stay private and are scanned again.
        await sql(
          `UPDATE cms_media_jobs SET status='failed' WHERE status='running' AND expires_at<=${nowSql} AND ${proof.sql}`,
        ).run()
      }
      await sql(
        `INSERT INTO cms_media_jobs(operation_id,action,media_id,actor_id,request_hash,expected_revision,status,expires_at,created_at)
        SELECT ?,?,?,?,'',?,'running',${nowSql}+60000,${nowSql} WHERE ${proof.sql}`,
        [token, action, target, auth.principal.user.id, precondition.slice(1, -1)],
      ).run()
      job = await sql(`SELECT * FROM cms_media_jobs WHERE operation_id=? AND ${proof.sql}`, [
        token,
      ]).first<Job>()
      if (!job) throw new Error('MEDIA_UNAUTHORIZED')
    } else job = existing
    const active = async () => {
      await authorized()
      if (
        intake &&
        !(await sql(
          `SELECT 1 FROM cms_media_intake WHERE owner=? AND expires_at>${nowSql} AND ${proof.sql}`,
          [intake],
        ).first())
      )
        throw new Error('MEDIA_LEASE')
      if (
        action !== 'reconcile' &&
        !(await sql(
          `SELECT 1 FROM cms_media WHERE media_id=? AND (lease_token=? OR (revision=? AND state IN ('ready','deleted'))) AND ${proof.sql}`,
          [target, token, token],
        ).first())
      )
        throw new Error('MEDIA_LEASE')
      if (
        !(await sql(
          `SELECT 1 FROM cms_media_jobs WHERE operation_id=? AND status='running' AND expires_at>${nowSql} AND ${proof.sql}`,
          [token],
        ).first())
      )
        throw new Error('MEDIA_LEASE')
    }
    const change = async (state: string, manifest: string | null = null) => {
      await active()
      const result = await sql(
        `UPDATE cms_media SET state=?,derivatives_json=?,revision=?,lease_token=NULL,lease_expires_at=NULL
        WHERE media_id=? AND EXISTS(SELECT 1 FROM cms_media_jobs WHERE operation_id=? AND status='running' AND expires_at>${nowSql}) AND ${proof.sql}`,
        [state, manifest, token, target, token],
      ).run()
      if (result.meta.changes !== 1) throw new Error('MEDIA_LEASE')
    }
    if (action === 'upload') {
      input = await readMediaBytes(request.body as ReadableStream<Uint8Array>)
      inspectImage(input, mime)
      const hash = await mediaHash(
        new TextEncoder().encode(`${mime}:${precondition}:${await mediaHash(input)}`),
      )
      if (existing) {
        if (existing.request_hash !== hash) throw new Error('MEDIA_CONFLICT')
        id = target ?? undefined
        return present(await row(), existing)
      }
      await active()
      await sql(
        `UPDATE cms_media_jobs SET request_hash=? WHERE operation_id=? AND status='running' AND ${proof.sql}`,
        [hash, token],
      ).run()
      await sql(
        `UPDATE cms_media SET state='processing' WHERE media_id=? AND lease_token=? AND ${proof.sql}`,
        [target, token],
      ).run()
      const derivatives = {} as Record<keyof typeof MEDIA_PROFILES, CmsDerivative>
      const controller = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('MEDIA_PROCESSING_TIMEOUT'))
        }, MEDIA_LIMITS.processingMs)
      })
      try {
        for (const profile of Object.keys(MEDIA_PROFILES) as (keyof typeof MEDIA_PROFILES)[]) {
          await active()
          const data = await Promise.race([
            (async () => {
              const response = await processor.fetch(`http://media.internal/${profile}`, {
                method: 'POST',
                body: input,
                headers: { 'Content-Type': mime },
                signal: controller.signal,
              })
              if (
                !response.ok ||
                response.headers.get('content-type')?.split(';')[0] !== 'image/webp' ||
                !response.body
              )
                throw new Error('MEDIA_PROCESSOR')
              return readMediaBytes(
                response.body,
                MEDIA_LIMITS.outputBytes,
                MEDIA_LIMITS.processingMs,
              )
            })(),
            deadline,
          ])
          const info = inspectImage(data, 'image/webp', true),
            bounds = MEDIA_PROFILES[profile]
          if (info.width > bounds.width || info.height > bounds.height)
            throw new Error('MEDIA_PROCESSOR')
          const sha256 = await mediaHash(data),
            objectKey = `cms/derived/${target}/${sha256}/${profile}.webp`
          await active()
          // A conditionally created content-addressed object is never overwritten.
          const written = await Promise.race([
            bucket.put(objectKey, data, {
              onlyIf: { etagDoesNotMatch: '*' },
              httpMetadata: { contentType: 'image/webp' },
            }),
            deadline,
          ])
          if (!written) throw new Error('MEDIA_OBJECT_CONFLICT')
          const stored = await Promise.race([bucket.get(objectKey), deadline])
          if (
            !stored ||
            stored.size !== data.length ||
            (await Promise.race([
              stored.arrayBuffer().then((bytes) => mediaHash(new Uint8Array(bytes))),
              deadline,
            ])) !== sha256
          )
            throw new Error('MEDIA_OBJECT_INTEGRITY')
          derivatives[profile] = {
            objectKey,
            sha256,
            contentType: 'image/webp',
            width: info.width,
            height: info.height,
            bytes: data.length,
          }
        }
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
      await change('ready', JSON.stringify(derivatives))
    } else if (action === 'delete') {
      if (existing) {
        id = target ?? undefined
        return present(await row(), existing)
      }
      let cursor: string | undefined
      do {
        await active()
        const objects = await bucket.list({ prefix: `cms/derived/${target}/`, cursor, limit: 100 })
        for (const object of objects.objects) {
          await active()
          await bucket.delete(object.key)
        }
        cursor = objects.truncated ? objects.cursor : undefined
      } while (cursor)
      await change('deleted')
    } else {
      if (existing) return authJson({ operation: { id: token, status: existing.status } })
      await active()
      await sql(
        `UPDATE cms_media SET state='rejected',revision=?,lease_token=NULL,lease_expires_at=NULL
        WHERE state IN ('quarantined','processing') AND lease_expires_at<=${nowSql} AND ${proof.sql}`,
        [token],
      ).run()
      let cursor: string | undefined
      do {
        await active()
        const objects = await bucket.list({ prefix: 'cms/derived/', cursor, limit: 100 })
        for (const object of objects.objects) {
          await active()
          const owner = await sql(
            `SELECT m.state,m.derivatives_json FROM cms_media m WHERE m.media_id=? AND ${proof.sql}`,
            [object.key.split('/')[2]],
          ).first<MediaRow>()
          const keep =
            owner?.state === 'ready' &&
            Object.values(
              JSON.parse(owner.derivatives_json ?? '{}') as Record<string, CmsDerivative>,
            ).some((d) => d.objectKey === object.key)
          if (!keep) await bucket.delete(object.key)
        }
        cursor = objects.truncated ? objects.cursor : undefined
      } while (cursor)
      await sql(
        `UPDATE cms_media SET state='deleted',revision=?,lease_token=NULL,lease_expires_at=NULL
        WHERE state='deleting' AND ${proof.sql}`,
        [token],
      ).run()
    }
    await active()
    await sql(
      `UPDATE cms_media_jobs SET status='done' WHERE operation_id=? AND status='running' AND ${proof.sql}`,
      [token],
    ).run()
    if (action === 'reconcile') return authJson({ operation: { id: token, status: 'done' } })
    id = target ?? undefined
    return present(await row(), { ...job, status: 'done' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    // Compensation is best-effort. A D1 outage leaves the lease and private objects for reconciliation.
    if (job?.status === 'running') {
      try {
        await sql(
          `UPDATE cms_media SET state='rejected',lease_token=NULL,lease_expires_at=NULL
          WHERE media_id=? AND state IN ('quarantined','processing') AND lease_token=? AND ${proof.sql}`,
          [job.media_id, token],
        ).run()
        await sql(
          `UPDATE cms_media_jobs SET status='failed' WHERE operation_id=? AND status='running' AND ${proof.sql}`,
          [token],
        ).run()
      } catch {
        console.error('CMS_MEDIA_RECOVERY_REQUIRED')
      }
    }
    if (/UNAUTHORIZED/.test(message)) return error('UNAUTHENTICATED', 401)
    if (/PRECONDITION/.test(message)) return error('MEDIA_PRECONDITION', 412)
    if (/REFERENCED/.test(message)) return error('MEDIA_REFERENCED', 409)
    if (/BUSY|CONFLICT|UNIQUE constraint|LEASE/.test(message))
      return error('MEDIA_BUSY_OR_CONFLICT', 409)
    if (/QUOTA/.test(message)) return error('MEDIA_QUOTA', 429)
    if (/MEDIA_BYTES/.test(message)) return error('MEDIA_BYTES', 413)
    if (/TIMEOUT/.test(message)) return error('MEDIA_TIMEOUT', 408)
    if (/MEDIA_INVALID/.test(message)) return error('MEDIA_INVALID', 400)
    console.error('CMS_MEDIA_UNAVAILABLE')
    return error('MEDIA_UNAVAILABLE', 503)
  } finally {
    if (intake) {
      try {
        await sql(`DELETE FROM cms_media_intake WHERE owner=? AND ${proof.sql}`, [intake]).run()
      } catch {
        console.error('CMS_MEDIA_INTAKE_RECOVERY_REQUIRED')
      }
    }
  }
}
