import { requireAdmin } from '../auth/guard'
import { authJson, wrongMethod } from '../auth/http'
import { adminWriteProof } from '../auth/session'
import { type CmsMediaState, MEDIA_PROFILES } from './media-contract'
import { readVerifiedMediaObjects } from './media-integrity'
import { type LocalMediaEnv, localMediaEnabled } from './media-library'
import { cmsMediaId, cmsUuid } from './validation'

// Legacy fallback until the complete 0010 capacity projection is installed.
const MEDIA_LIMIT = 100
const error = (code: string, status: number) => authJson({ error: { code } }, status)
type Row = {
  media_id: string
  state: CmsMediaState
  revision: string
  created_at: number
  derivatives_json: string | null
}

async function access(request: Request, env: LocalMediaEnv) {
  if (!localMediaEnabled(request, env)) return { error: error('NOT_FOUND', 404) }
  const auth = await requireAdmin(request, env)
  if (auth.error) return { error: auth.error }
  if (request.method !== 'GET') return { error: wrongMethod(request, 'GET') }
  return {
    principal: auth.principal,
    bucket: env.CMS_MEDIA_BUCKET,
    proof: adminWriteProof(auth.principal, auth.config),
  }
}

/** Metadata snapshot only. A ready state is not a promise of current object integrity. */
export async function handleMediaList(request: Request, env: LocalMediaEnv): Promise<Response> {
  const auth = await access(request, env)
  if (auth.error) return auth.error
  const query = new URL(request.url).searchParams
  if (
    [...query.keys()].some((key) => !['limit', 'cursor'].includes(key)) ||
    query.getAll('limit').length > 1 ||
    query.getAll('cursor').length > 1
  )
    return error('INVALID_REQUEST', 400)
  const rawLimit = query.get('limit') ?? '20'
  if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 25) return error('INVALID_REQUEST', 400)
  const limit = Number(rawLimit),
    cursor = query.get('cursor')
  let after: { time: number; id: string } | null = null
  if (cursor !== null) {
    if (cursor.length > 80) return error('INVALID_REQUEST', 400)
    const parts = cursor.split(':')
    if (
      parts.length !== 2 ||
      !/^[1-9]\d{0,15}$/.test(parts[0]) ||
      !cmsMediaId(parts[1]) ||
      !Number.isSafeInteger(Number(parts[0]))
    )
      return error('INVALID_REQUEST', 400)
    after = { time: Number(parts[0]), id: parts[1] }
  }
  try {
    const reusable = Boolean(
      await env.DELEGAS_DB.prepare(
        "SELECT 1 FROM sqlite_schema WHERE type='view' AND name='cms_media_capacity'",
      ).first(),
    )
    const capacitySql = reusable
      ? `SELECT capacity_limit,consumed,includes_tombstones FROM cms_media_capacity WHERE ${auth.proof.sql}`
      : `SELECT ${MEDIA_LIMIT} capacity_limit,count(*) consumed,1 includes_tombstones FROM cms_media WHERE ${auth.proof.sql}`
    const statements = [
      env.DELEGAS_DB.prepare(`SELECT 1 ok WHERE ${auth.proof.sql}`).bind(...auth.proof.values),
      env.DELEGAS_DB.prepare(capacitySql).bind(...auth.proof.values),
      env.DELEGAS_DB.prepare(`SELECT media_id,state,revision,created_at FROM cms_media WHERE ${auth.proof.sql}
        ${after ? 'AND (created_at<? OR (created_at=? AND media_id<?))' : ''}
        ORDER BY created_at DESC,media_id DESC LIMIT ?`).bind(
        ...auth.proof.values,
        ...(after ? [after.time, after.time, after.id] : []),
        limit + 1,
      ),
    ]
    const result = await env.DELEGAS_DB.batch(statements)
    if (!result[0].results.length) return error('UNAUTHENTICATED', 401)
    const rows = result[2].results as unknown as Row[]
    const page = rows.slice(0, limit),
      last = page[page.length - 1]
    const capacity = result[1].results[0] as {
      capacity_limit: number
      consumed: number
      includes_tombstones: number
    }
    const consumed = Number(capacity.consumed),
      limitCapacity = Number(capacity.capacity_limit)
    return authJson({
      media: page.map((row) => ({
        id: row.media_id,
        state: row.state,
        revision: row.revision,
        profiles: row.state === 'ready' ? Object.keys(MEDIA_PROFILES) : [],
        integrity: row.state === 'ready' ? 'not_checked' : 'unavailable',
      })),
      nextCursor: rows.length > limit && last ? `${last.created_at}:${last.media_id}` : null,
      capacity: {
        limit: limitCapacity,
        consumed,
        remaining: Math.max(0, limitCapacity - consumed),
        includesTombstones: Boolean(capacity.includes_tombstones),
      },
    })
  } catch {
    return error('MEDIA_UNAVAILABLE', 503)
  }
}

/** Existing immutable receipts, never a new operation or an automatic upload replay. */
export async function handleMediaCommand(
  request: Request,
  env: LocalMediaEnv,
  operationId: string,
): Promise<Response> {
  const auth = await access(request, env)
  if (auth.error) return auth.error
  if (!cmsUuid(operationId)) return error('INVALID_OPERATION', 400)
  try {
    const result = await env.DELEGAS_DB.batch([
      env.DELEGAS_DB.prepare(`SELECT 1 ok WHERE ${auth.proof.sql}`).bind(...auth.proof.values),
      env.DELEGAS_DB.prepare(`SELECT j.status,j.expires_at,r.result_json FROM cms_media_jobs j
        LEFT JOIN cms_media_receipts r USING(operation_id)
        WHERE j.operation_id=? AND j.actor_id=? AND ${auth.proof.sql}`).bind(
        operationId,
        auth.principal.user.id,
        ...auth.proof.values,
      ),
    ])
    if (!result[0].results.length) return error('UNAUTHENTICATED', 401)
    const row = result[1].results[0] as
      | { status: string; expires_at: number; result_json: string | null }
      | undefined
    if (!row)
      return authJson({ error: { code: 'MEDIA_OPERATION_NOT_FOUND' }, outcome: 'unknown' }, 404)
    if (row.status === 'running')
      return authJson(
        {
          operation: {
            id: operationId,
            status: 'running',
            reconciliationRequired: row.expires_at <= Date.now(),
          },
          outcome: 'unknown',
        },
        202,
      )
    if (!row.result_json) return error('MEDIA_UNAVAILABLE', 503)
    const receipt = JSON.parse(row.result_json) as { media?: { revision: string } }
    return authJson(
      receipt,
      200,
      receipt.media ? { ETag: `"${receipt.media.revision}"` } : undefined,
    )
  } catch {
    return error('MEDIA_UNAVAILABLE', 503)
  }
}

/** Send the buffer that was verified, not a second read vulnerable to object replacement. */
export async function handleMediaBytes(
  request: Request,
  env: LocalMediaEnv,
  id: string,
  profile: string,
): Promise<Response> {
  const auth = await access(request, env)
  if (auth.error) return auth.error
  if (!cmsMediaId(id) || !Object.hasOwn(MEDIA_PROFILES, profile))
    return error('INVALID_REQUEST', 400)
  try {
    const row = await env.DELEGAS_DB.prepare(
      'SELECT media_id,state,revision,derivatives_json FROM cms_media WHERE media_id=?',
    )
      .bind(id)
      .first<Row>()
    if (row?.state !== 'ready') return error('MEDIA_NOT_AVAILABLE', 404)
    const verified = await readVerifiedMediaObjects(
      env.DELEGAS_DB,
      auth.bucket,
      id,
      row.derivatives_json ?? '',
    )
    // One final D1 snapshot: current authorization, unchanged ready manifest and completed upload.
    const result = await env.DELEGAS_DB.batch([
      env.DELEGAS_DB.prepare(`SELECT 1 ok WHERE ${auth.proof.sql}`).bind(...auth.proof.values),
      env.DELEGAS_DB.prepare(`SELECT 1 ok FROM cms_media m JOIN cms_media_jobs j ON j.operation_id=m.revision
        JOIN cms_media_receipts r ON r.operation_id=j.operation_id
        WHERE m.media_id=? AND m.state='ready' AND m.revision=? AND m.derivatives_json=?
        AND j.media_id=m.media_id AND j.action='upload' AND j.status='done' AND ${auth.proof.sql}`).bind(
        id,
        row.revision,
        row.derivatives_json,
        ...auth.proof.values,
      ),
    ])
    if (!result[0].results.length) return error('UNAUTHENTICATED', 401)
    if (!result[1].results.length) return error('MEDIA_NOT_AVAILABLE', 404)
    const bytes = verified.objects.get(profile as keyof typeof MEDIA_PROFILES)
    if (!bytes) return error('MEDIA_UNAVAILABLE', 503)
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Length': String(bytes.length),
      },
    })
  } catch {
    return error('MEDIA_UNAVAILABLE', 503)
  }
}
