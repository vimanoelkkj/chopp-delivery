import type { AuthConfig } from './http'
import { randomToken, tokenHash } from './password'

export const SESSION_SECONDS = 8 * 60 * 60
export type OwnerRow = {
  id: string
  username: string
  password_hash: string
  active: number
  auth_version: number
}
export type AdminUser = { id: string; username: string }
export type AdminPrincipal = { user: AdminUser; sessionHash: string }

export function cookieName(config: AuthConfig): string {
  return config.local ? 'delegas_admin_local_session' : '__Host-delegas_admin_session'
}

export function sessionCookie(config: AuthConfig, token: string, clear = false): string {
  return `${cookieName(config)}=${token}; Path=/; HttpOnly; SameSite=Strict${config.local ? '' : '; Secure'}; Max-Age=${clear ? 0 : SESSION_SECONDS}${clear ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : ''}`
}

export function requestToken(request: Request, config: AuthConfig): string | null {
  const header = request.headers.get('cookie') ?? ''
  if (header.length > 8192) return null
  const prefix = `${cookieName(config)}=`
  const matching = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix))
  if (matching.length !== 1) return null
  const token = matching[0].slice(prefix.length)
  return /^[a-f0-9]{64}$/.test(token) ? token : null
}

export async function createSession(
  db: D1Database,
  owner: OwnerRow,
  config: AuthConfig,
): Promise<string | null> {
  const token = randomToken()
  const hash = await tokenHash(token)
  const now = Date.now()
  const [, inserted] = await db.batch([
    db
      .prepare(
        'DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)',
      )
      .bind(now),
    db
      .prepare(`INSERT INTO admin_sessions (token_hash, user_id, auth_version, origin, created_at, expires_at)
      SELECT ?, id, auth_version, ?, ?, ? FROM admin_users
      WHERE id = ? AND active = 1 AND password_hash = ? AND auth_version = ?`)
      .bind(
        hash,
        config.origin,
        now,
        now + SESSION_SECONDS * 1000,
        owner.id,
        owner.password_hash,
        owner.auth_version,
      ),
  ])
  return inserted.meta.changes === 1 ? sessionCookie(config, token) : null
}

/** Também pode compor o WHERE das futuras escritas: a autorização é reavaliada pelo D1. */
export const ADMIN_WRITE_PREDICATE = `EXISTS (
  SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND u.id = ? AND u.active = 1
    AND s.auth_version = u.auth_version AND s.origin = ?
    AND s.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
)`

export function adminWriteProof(principal: AdminPrincipal, config: AuthConfig) {
  return {
    sql: ADMIN_WRITE_PREDICATE,
    values: [principal.sessionHash, principal.user.id, config.origin] as const,
  }
}

export async function currentAdmin(
  db: D1Database,
  request: Request,
  config: AuthConfig,
): Promise<AdminPrincipal | null> {
  const token = requestToken(request, config)
  if (!token) return null
  const hash = await tokenHash(token)
  const user = await db
    .prepare(`SELECT u.id, u.username FROM admin_sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1 AND s.auth_version = u.auth_version
      AND s.origin = ? AND s.expires_at > ?`)
    .bind(hash, config.origin, Date.now())
    .first<AdminUser>()
  return user ? { user, sessionHash: hash } : null
}

export async function revokeSession(
  db: D1Database,
  request: Request,
  config: AuthConfig,
): Promise<string> {
  const token = requestToken(request, config)
  if (token)
    await db
      .prepare('DELETE FROM admin_sessions WHERE token_hash = ? AND origin = ?')
      .bind(await tokenHash(token), config.origin)
      .run()
  return sessionCookie(config, '', true)
}
