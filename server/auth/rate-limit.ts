import type { AuthConfig } from './http'
import { keyedHash } from './password'

export const LOGIN_WINDOW_MS = 15 * 60 * 1000

type LimitRow = { key: string; attempts: number; expires_at: number }

/** Todos os limites são reservados juntos, antes de qualquer derivação de senha. */
export async function reserveLoginAttempt(
  db: D1Database,
  config: AuthConfig,
  ip: string,
  username?: string,
): Promise<number> {
  const buckets = [
    { name: 'global', max: 100 },
    { name: `ip:${ip}`, max: 20 },
    ...(username === undefined
      ? []
      : [{ name: `username-ip:${JSON.stringify([username, ip])}`, max: 10 }]),
  ]
  const keys = await Promise.all(
    buckets.map((bucket) => keyedHash(`delegas-login:${bucket.name}`, config.pepper)),
  )
  const parameters = buckets.flatMap((bucket, index) => [keys[index], bucket.max])
  // Somente a quantidade de placeholders varia; chaves, limites e prazos usam bind.
  const requested = `WITH requested(key, maximum) AS (VALUES ${buckets.map(() => '(?, ?)').join(', ')})`
  const blockedAt = (now: number) =>
    db
      .prepare(`${requested}
      SELECT l.key, l.attempts, l.expires_at FROM requested r
      JOIN admin_login_limits l ON l.key = r.key
      WHERE l.expires_at > ? AND l.attempts >= r.maximum`)
      .bind(...parameters, now)
  const retryAfter = (rows: LimitRow[], now: number) =>
    rows.reduce((retry, row) => Math.max(retry, Math.ceil((row.expires_at - now) / 1000)), 0)

  // Caminho saturado só lê: não cria buckets, não incrementa nem limpa registros.
  const preflight = await blockedAt(Date.now()).all<LimitRow>()
  const now = Date.now()
  const retry = retryAfter(preflight.results, now)
  if (retry > 0) return retry
  const blocked = blockedAt(now)

  const [reserved, rejected] = await db.batch<LimitRow>([
    db
      .prepare(`${requested}, admission AS MATERIALIZED (
        SELECT NOT EXISTS (
          SELECT 1 FROM requested r JOIN admin_login_limits l ON l.key = r.key
          WHERE l.expires_at > ? AND l.attempts >= r.maximum
        ) AS allowed
      )
      INSERT INTO admin_login_limits (key, attempts, expires_at)
      SELECT r.key, 1, ? FROM requested r CROSS JOIN admission a WHERE a.allowed
      ON CONFLICT(key) DO UPDATE SET
        attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
      RETURNING key, attempts, expires_at`)
      .bind(...parameters, now, now + LOGIN_WINDOW_MS, now, now),
    blocked,
  ])
  // MATERIALIZED fixa a decisão antes de alterar qualquer contador. A leitura da
  // recusa fica na mesma transação D1, sem corrida com expiração/limpeza posterior.
  if (reserved.results.length === 0) {
    const remaining = retryAfter(rejected.results, now)
    if (remaining > 0) return remaining
    throw new Error('Reserva de rate limit indisponível')
  }
  if (
    reserved.results.length !== keys.length ||
    !keys.every((key, index) =>
      reserved.results.some(
        (row) =>
          row.key === key &&
          Number.isInteger(row.attempts) &&
          row.attempts >= 1 &&
          row.attempts <= buckets[index].max &&
          row.expires_at > now,
      ),
    )
  )
    throw new Error('Reserva de rate limit inválida')

  // Limpeza limitada somente após admissão; uma falha também impede o KDF/login.
  await db
    .prepare(
      'DELETE FROM admin_login_limits WHERE key IN (SELECT key FROM admin_login_limits WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)',
    )
    .bind(now)
    .run()
  return 0
}

export function clientBucket(request: Request, config: AuthConfig): string {
  // O cabeçalho é fornecido pela borda Cloudflare; no loopback nunca se confia no cliente.
  return config.local
    ? 'loopback'
    : (request.headers.get('cf-connecting-ip') ?? 'unknown').slice(0, 64)
}
