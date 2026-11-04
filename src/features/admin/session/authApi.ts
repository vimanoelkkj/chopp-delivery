import type { AdminUser } from '../catalog/types'
import { requireApiJson, requireF2SessionError } from '../httpResponse'

/**
 * Cliente das rotas reais da F2 (`/api/auth/*`). O cookie de sessão é HttpOnly e gerenciado
 * pelo navegador; o token nunca passa por JavaScript. As escritas só funcionam na origem
 * configurada em ADMIN_ORIGIN (o Origin é enviado pelo navegador).
 */
export type LoginFailure =
  | { ok: false; reason: 'invalid-credentials' }
  | { ok: false; reason: 'rate-limited'; retryAfterSeconds: number | null }
  | { ok: false; reason: 'bad-origin' | 'bad-request' | 'unavailable' }

export type LoginResult = { ok: true; user: AdminUser } | LoginFailure

function readUser(value: unknown): AdminUser | null {
  if (typeof value !== 'object' || value === null) return null
  const user = (value as { user?: unknown }).user
  if (typeof user !== 'object' || user === null) return null
  const { id, username } = user as Record<string, unknown>
  return typeof id === 'string' && typeof username === 'string' ? { id, username } : null
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function login(
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<LoginResult> {
  let response: Response
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal,
      redirect: 'error',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return { ok: false, reason: 'unavailable' }
  }
  try {
    requireApiJson(response)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (response.status === 200) {
    const user = readUser(await json(response))
    return user ? { ok: true, user } : { ok: false, reason: 'unavailable' }
  }
  if (response.status === 401) return { ok: false, reason: 'invalid-credentials' }
  if (response.status === 403) return { ok: false, reason: 'bad-origin' }
  if (response.status === 400) return { ok: false, reason: 'bad-request' }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'))
    return {
      ok: false,
      reason: 'rate-limited',
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    }
  }
  return { ok: false, reason: 'unavailable' }
}

/** `null` = sem sessão válida (401). Qualquer outra falha lança e vira "indisponível". */
export async function fetchSession(signal?: AbortSignal): Promise<AdminUser | null> {
  const response = await fetch('/api/auth/me', { signal, redirect: 'error', cache: 'no-store' })
  requireApiJson(response)
  const body = await json(response)
  requireF2SessionError(response.status, body)
  if (response.status === 401) return null
  const user = response.ok ? readUser(body) : null
  if (!user) throw new Error('Sessão indisponível')
  return user
}

/** Só o recibo JSON exato da F2 confirma revogação; falhas preservam a sessão local. */
export async function logout(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
    })
    requireApiJson(response)
    const body = await json(response)
    return (
      response.status === 200 &&
      typeof body === 'object' &&
      body !== null &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      'ok' in body &&
      body.ok === true
    )
  } catch {
    return false
  }
}
