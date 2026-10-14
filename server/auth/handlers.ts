import { requireAdmin } from './guard'
import {
  type AuthEnv,
  authConfig,
  authError,
  authJson,
  readLogin,
  validWriteOrigin,
  wrongMethod,
} from './http'
import { verifyPassword } from './password'
import { clientBucket, reserveLoginAttempt } from './rate-limit'
import { createSession, type OwnerRow, revokeSession } from './session'

export async function handleLogin(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== 'POST') return wrongMethod(request, 'POST')
  try {
    const config = authConfig(request, env)
    if (!validWriteOrigin(request, config)) return authError('INVALID_ORIGIN', 403)
    const credentials = await readLogin(request)
    const limit = await reserveLoginAttempt(
      env.DELEGAS_DB,
      config,
      clientBucket(request, config),
      credentials?.username,
    )
    if (limit) return authError('RATE_LIMITED', 429, { 'Retry-After': String(limit) })
    if (!credentials) return authError('INVALID_REQUEST', 400)
    const owner = await env.DELEGAS_DB.prepare(
      'SELECT id, username, password_hash, active, auth_version FROM admin_users WHERE username = ?',
    )
      .bind(credentials.username)
      .first<OwnerRow>()
    const valid = await verifyPassword(
      credentials.password,
      owner?.active === 1 ? owner.password_hash : null,
      config.pepper,
    )
    if (owner?.active !== 1 || !valid) return authError('INVALID_CREDENTIALS', 401)
    const cookie = await createSession(env.DELEGAS_DB, owner, config)
    if (!cookie) return authError('INVALID_CREDENTIALS', 401)
    return authJson(
      { authenticated: true, user: { id: owner.id, username: owner.username } },
      200,
      { 'Set-Cookie': cookie },
    )
  } catch {
    console.error('AUTH_UNAVAILABLE')
    return authError('AUTH_UNAVAILABLE', 503)
  }
}

export async function handleMe(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== 'GET') return wrongMethod(request, 'GET')
  const authorization = await requireAdmin(request, env)
  if (authorization.error) return authorization.error
  return authJson({ authenticated: true, user: authorization.principal.user })
}

export async function handleLogout(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== 'POST') return wrongMethod(request, 'POST')
  try {
    const config = authConfig(request, env)
    if (!validWriteOrigin(request, config)) return authError('INVALID_ORIGIN', 403)
    return authJson({ ok: true }, 200, {
      'Set-Cookie': await revokeSession(env.DELEGAS_DB, request, config),
    })
  } catch {
    console.error('AUTH_UNAVAILABLE')
    return authError('AUTH_UNAVAILABLE', 503)
  }
}
