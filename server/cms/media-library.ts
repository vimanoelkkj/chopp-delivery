import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authJson, wrongMethod } from '../auth/http'
import { adminWriteProof } from '../auth/session'
import { inspectImage, mediaHash, readMediaBytes } from './media-bytes'
import { type CmsDerivative, MEDIA_LIMITS, MEDIA_PROFILES } from './media-contract'
import { verifyMediaObjects } from './media-integrity'
import { cmsMediaId, cmsUuid } from './validation'

// Optional media capabilities remain absent from normal/public runtime configuration.
export type MediaBucket = {
  put(
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    options?: { onlyIf?: { etagDoesNotMatch: string }; httpMetadata?: { contentType: string } },
  ): Promise<unknown>
  get(key: string): Promise<{
    key: string
    size: number
    httpMetadata?: { contentType?: string }
    arrayBuffer(): Promise<ArrayBuffer>
  } | null>
  list(options: {
    prefix: string
    cursor?: string
    limit?: number
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>
  delete(key: string): Promise<void>
}
export type LocalMediaEnv = AuthEnv & {
  CMS_MEDIA_LOCAL?: string
  CMS_MEDIA_ENVIRONMENT?: string
  CMS_MEDIA_ENABLED?: string
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

/** Shared capability gate. Legacy name retained; remote use requires an isolated opt-in. */
export function localMediaEnabled(
  request: Request,
  env: LocalMediaEnv,
): env is LocalMediaEnv & {
  CMS_MEDIA_BUCKET: MediaBucket
  CMS_MEDIA_PROCESSOR: Pick<Fetcher, 'fetch'>
} {
  const url = new URL(request.url)
  const homologationOrigin = 'https://chopp-delivery-homolog.pages.dev'
  const homologation =
    env.CMS_MEDIA_ENVIRONMENT === 'homologation' &&
    env.CMS_MEDIA_ENABLED === 'enabled' &&
    env.ADMIN_ORIGIN === homologationOrigin &&
    url.origin === homologationOrigin &&
    !env.ADMIN_ALLOW_INSECURE_LOCAL &&
    !env.CMS_MEDIA_LOCAL
  return (
    (homologation ||
      (env.CMS_MEDIA_LOCAL === 'disposable-v1' &&
        env.ADMIN_ALLOW_INSECURE_LOCAL === '1' &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname))) &&
    Boolean(env.CMS_MEDIA_BUCKET && env.CMS_MEDIA_PROCESSOR)
  )
}

export async function handleLocalMedia(
  request: Request,
  env: LocalMediaEnv,
  id?: string,
  reconcile = false,
): Promise<Response> {
  if (!localMediaEnabled(request, env)) return error('NOT_FOUND', 404)
  const allowed = reconcile ? 'POST' : id ? 'GET, DELETE' : 'GET, POST'
  if (!(reconcile ? ['POST'] : id ? ['GET', 'DELETE'] : ['POST']).includes(request.method))
    return wrongMethod(request, allowed)
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  if (id && !cmsMediaId(id)) return error('INVALID_REQUEST', 400)
  const started = Date.now()
  let stage = 'handler.start',
    stageStarted = started,
    currentProfile: keyof typeof MEDIA_PROFILES | null = null
  const at = (next: string) => {
    stage = next
    stageStarted = Date.now()
  }
  const report = (cause: unknown, event = 'CMS_MEDIA_FAILURE') => {
    // Only fixed codes/context leave this handler. Never log the error, SQL, keys or request.
    try {
      const message = cause instanceof Error ? cause.message : ''
      const source = stage.split('.')[0]
      let code =
        message.match(
          /\b(MEDIA_LEASE|MEDIA_BUSY|MEDIA_OBJECT_CONFLICT|MEDIA_CONFLICT|MEDIA_DIVERGENCE_OR_LEASE|MEDIA_PROCESSING_TIMEOUT|MEDIA_TIMEOUT|MEDIA_UNAUTHORIZED|MEDIA_PRECONDITION|MEDIA_OBJECT_INTEGRITY|MEDIA_PROCESSOR|MEDIA_INVALID|MEDIA_BYTES|MEDIA_QUOTA)\b/,
        )?.[1] ?? 'UNCLASSIFIED'
      // verification.objects mixes D1 and R2; these SQLite-only messages still identify D1.
      const sqlStage = source === 'd1' || source === 'verification'
      if (sqlStage && /\bSQLITE_(?:BUSY|LOCKED)(?:_[A-Z]+)?\b/.test(message)) code = 'D1_CONTENTION'
      else if (sqlStage && /UNIQUE constraint/.test(message)) code = 'D1_UNIQUE_CONSTRAINT'
      else if (message === 'MEDIA_LEASE' && stage === 'd1.intake_check') code = 'MEDIA_INTAKE_LEASE'
      else if (message === 'MEDIA_LEASE' && stage === 'd1.job_check') code = 'MEDIA_JOB_LEASE'
      else if (message === 'MEDIA_BUSY' && stage === 'd1.intake_claim') code = 'MEDIA_INTAKE_BUSY'
      else if (message === 'MEDIA_BUSY' && stage === 'handler.identity') code = 'MEDIA_JOB_RUNNING'
      const now = Date.now()
      console.error(event, {
        source,
        stage,
        code,
        profile: currentProfile,
        elapsedMs: Math.max(0, now - started),
        stageMs: Math.max(0, now - stageStarted),
      })
    } catch {
      // Telemetry must never affect receipts, recovery or the public response.
    }
  }
  const db = env.DELEGAS_DB,
    bucket = env.CMS_MEDIA_BUCKET,
    processor = env.CMS_MEDIA_PROCESSOR
  const proof = adminWriteProof(auth.principal, auth.config)
  const sql = (query: string, values: unknown[] = []) =>
    db.prepare(query).bind(...values, ...proof.values)
  const authorized = async () => {
    at('d1.authorize')
    if (!(await sql(`SELECT 1 AS ok WHERE ${proof.sql}`).first()))
      throw new Error('MEDIA_UNAUTHORIZED')
  }
  const row = () => {
    at('d1.media_read')
    return sql(
      `SELECT media_id,state,revision,derivatives_json FROM cms_media WHERE media_id=? AND ${proof.sql}`,
      [id],
    ).first<MediaRow>()
  }
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
  const command = async (
    operation: string,
    transition: string,
    manifest: string | null = null,
    check: string | null = null,
    hash: string | null = null,
    mediaId: string | null = null,
  ) => {
    at(`d1.command_${transition}`)
    await db
      .prepare(
        `UPDATE cms_media_command SET transition=?,manifest_json=?,check_id=?,request_hash=?,actor_id=?,session_hash=?,origin=?,media_id=COALESCE(?,media_id) WHERE operation_id=?`,
      )
      .bind(
        transition,
        manifest,
        check,
        hash,
        auth.principal.user.id,
        auth.principal.sessionHash,
        auth.config.origin,
        mediaId,
        operation,
      )
      .run()
  }
  const observe = async (record: MediaRow) => {
    at('verification.objects')
    await verifyMediaObjects(db, bucket, record.media_id, record.derivatives_json ?? '')
    at('d1.completed_check')
    const completed = await sql(
      `SELECT 1 FROM cms_media_jobs j JOIN cms_media_receipts r USING(operation_id)
      WHERE j.media_id=? AND j.operation_id=? AND j.action='upload' AND j.status='done' AND ${proof.sql}`,
      [record.media_id, record.revision],
    ).first()
    if (!completed) throw new Error('MEDIA_DIVERGENCE')
  }
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MEDIA_TIMEOUT')), MEDIA_LIMITS.processingMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const receipt = async (operation: string) => {
    await authorized()
    at('d1.receipt')
    const result = await sql(
      `SELECT r.result_json FROM cms_media_receipts r JOIN cms_media_jobs j USING(operation_id) WHERE operation_id=? AND j.actor_id=? AND ${proof.sql}`,
      [operation, auth.principal.user.id],
    ).first<string>('result_json')
    if (!result) throw new Error('MEDIA_WRITE_INCOMPLETE')
    const value = JSON.parse(result) as { media?: { revision: string } }
    return authJson(value, 200, value.media ? { ETag: `"${value.media.revision}"` } : undefined)
  }
  let job: Job | null = null
  let token = '',
    intake = ''
  try {
    if (request.method === 'GET') {
      await authorized()
      const record = await row()
      if (record?.state === 'ready') await observe(record)
      return present(record)
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
    const target = action === 'upload' ? `media_${token}` : (id ?? null)
    at('d1.job_lookup')
    const existing = await sql(
      `SELECT * FROM cms_media_jobs WHERE operation_id=? AND ${proof.sql}`,
      [token],
    ).first<Job>()
    at('handler.identity')
    if (
      existing &&
      (existing.expected_revision !== precondition.slice(1, -1) ||
        existing.action !== action ||
        existing.media_id !== target ||
        existing.actor_id !== auth.principal.user.id)
    )
      throw new Error('MEDIA_CONFLICT')
    if (existing?.status === 'running') {
      report(new Error('MEDIA_BUSY'))
      return error('MEDIA_BUSY', 409)
    }
    const mime = request.headers.get('content-type') ?? ''
    if (action === 'upload') {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || !request.body)
        return error('MEDIA_INVALID', 400)
      const length = request.headers.get('content-length')
      if (length && (!/^\d+$/.test(length) || Number(length) > MEDIA_LIMITS.inputBytes))
        return error('MEDIA_BYTES', 413)
      intake = crypto.randomUUID()
      at('d1.intake_claim')
      const claimed = await sql(
        `INSERT INTO cms_media_intake(singleton,owner,expires_at) SELECT 1,?,${nowSql}+20000 WHERE ${proof.sql}
        ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE cms_media_intake.expires_at<=${nowSql}`,
        [intake],
      ).run()
      if (claimed.meta.changes !== 1) throw new Error('MEDIA_BUSY')
    }
    if (!existing) {
      if (action === 'reconcile') {
        at('d1.expired_jobs')
        const expired = await sql(
          `SELECT * FROM cms_media_jobs WHERE status='running' AND expires_at<=${nowSql} AND ${proof.sql}`,
        ).all<Job>()
        for (const stale of expired.results) await command(stale.operation_id, 'expire')
      }
      at('d1.job_start')
      await db
        .prepare(
          `UPDATE cms_media_start SET operation_id=?,action=?,media_id=?,actor_id=?,session_hash=?,origin=?,expected_revision=? WHERE singleton=1`,
        )
        .bind(
          token,
          action,
          target,
          auth.principal.user.id,
          auth.principal.sessionHash,
          auth.config.origin,
          precondition.slice(1, -1),
        )
        .run()
      at('d1.job_read')
      job = await sql(`SELECT * FROM cms_media_jobs WHERE operation_id=? AND ${proof.sql}`, [
        token,
      ]).first<Job>()
      if (!job) throw new Error('MEDIA_UNAUTHORIZED')
    } else job = existing
    const active = async () => {
      await authorized()
      at('d1.intake_check')
      if (
        intake &&
        !(await sql(
          `SELECT 1 FROM cms_media_intake WHERE owner=? AND expires_at>${nowSql} AND ${proof.sql}`,
          [intake],
        ).first())
      )
        throw new Error('MEDIA_LEASE')
      at('d1.job_check')
      if (
        !(await sql(
          `SELECT 1 FROM cms_media_jobs WHERE operation_id=? AND status='running' AND expires_at>${nowSql} AND ${proof.sql}`,
          [token],
        ).first())
      )
        throw new Error('MEDIA_LEASE')
    }
    if (action === 'upload') {
      at('input.read')
      const input = await readMediaBytes(request.body as ReadableStream<Uint8Array>)
      at('input.hash')
      const hash = await mediaHash(
        new TextEncoder().encode(`${mime}:${precondition}:${await mediaHash(input)}`),
      )
      if (existing) {
        at('handler.replay')
        if (existing.status !== 'done' || existing.request_hash !== hash)
          throw new Error('MEDIA_CONFLICT')
        id = target ?? undefined
        const current = await row()
        if (current?.state === 'ready') await observe(current)
        return await receipt(token)
      }
      at('input.inspect')
      inspectImage(input, mime)
      await active()
      await command(token, 'process', null, null, hash)
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
          currentProfile = profile
          await active()
          at('processor.transform')
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
          at('input.derivative_inspect')
          const info = inspectImage(data, 'image/webp', true),
            bounds = MEDIA_PROFILES[profile]
          if (info.width > bounds.width || info.height > bounds.height)
            throw new Error('MEDIA_PROCESSOR')
          const sha256 = await mediaHash(data),
            objectKey = `cms/derived/${target}/${sha256}/${profile}.webp`
          await active()
          at('r2.put')
          // A conditionally created content-addressed object is never overwritten.
          const written = await Promise.race([
            bucket.put(objectKey, data, {
              onlyIf: { etagDoesNotMatch: '*' },
              httpMetadata: { contentType: 'image/webp' },
            }),
            deadline,
          ])
          if (!written) throw new Error('MEDIA_OBJECT_CONFLICT')
          at('r2.verify_read')
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
      currentProfile = null
      await active()
      const manifest = JSON.stringify(derivatives)
      at('verification.objects')
      const check = await verifyMediaObjects(db, bucket, target as string, manifest)
      await command(token, 'finish', manifest, check)
    } else if (action === 'delete') {
      if (existing) {
        if (existing.status !== 'done') throw new Error('MEDIA_CONFLICT')
        return await receipt(token)
      }
      let cursor: string | undefined
      do {
        await active()
        at('r2.list')
        const objects = await bounded(() =>
          bucket.list({ prefix: `cms/derived/${target}/`, cursor, limit: 100 }),
        )
        for (const object of objects.objects) {
          await active()
          at('r2.delete')
          await bounded(() => bucket.delete(object.key))
        }
        cursor = objects.truncated ? objects.cursor : undefined
      } while (cursor)
      await command(token, 'finish')
    } else {
      if (existing) {
        if (existing.status !== 'done') throw new Error('MEDIA_CONFLICT')
        return await receipt(token)
      }
      await active()
      at('d1.ready_media')
      const ready = await sql(
        `SELECT * FROM cms_media WHERE state='ready' AND ${proof.sql}`,
      ).all<MediaRow>()
      for (const record of ready.results) await observe(record)
      let cursor: string | undefined
      do {
        await active()
        at('r2.list')
        const objects = await bounded(() =>
          bucket.list({ prefix: 'cms/derived/', cursor, limit: 100 }),
        )
        for (const object of objects.objects) {
          await active()
          at('d1.object_owner')
          const owner = await sql(
            `SELECT state,derivatives_json FROM cms_media WHERE media_id=? AND ${proof.sql}`,
            [object.key.split('/')[2]],
          ).first<MediaRow>()
          const keep =
            owner?.state === 'ready' &&
            Object.values(
              JSON.parse(owner.derivatives_json ?? '{}') as Record<string, CmsDerivative>,
            ).some((d) => d.objectKey === object.key)
          if (!keep) {
            at('r2.delete')
            await bounded(() => bucket.delete(object.key))
          }
        }
        cursor = objects.truncated ? objects.cursor : undefined
      } while (cursor)
      at('d1.deleting_media')
      const deleting = await sql(
        `SELECT * FROM cms_media WHERE state='deleting' AND ${proof.sql}`,
      ).all<MediaRow>()
      for (const record of deleting.results)
        await command(token, 'recover', null, null, null, record.media_id)
      await command(token, 'finish')
    }
    return await receipt(token)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    report(cause)
    if (job?.status === 'running') {
      try {
        at('d1.recovery_status')
        const persisted = await sql(
          `SELECT status FROM cms_media_jobs WHERE operation_id=? AND ${proof.sql}`,
          [token],
        ).first<string>('status')
        if (persisted === 'done') return await receipt(token)
        at('d1.recovery_expiry')
        const expired = await sql(
          `SELECT 1 FROM cms_media_jobs WHERE operation_id=? AND expires_at<=${nowSql} AND ${proof.sql}`,
          [token],
        ).first()
        await command(token, expired ? 'expire' : 'fail')
      } catch (recoveryCause) {
        report(recoveryCause, 'CMS_MEDIA_RECOVERY_REQUIRED')
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
        at('d1.intake_release')
        await sql(`DELETE FROM cms_media_intake WHERE owner=? AND ${proof.sql}`, [intake]).run()
      } catch (releaseCause) {
        report(releaseCause, 'CMS_MEDIA_INTAKE_RECOVERY_REQUIRED')
      }
    }
  }
}
