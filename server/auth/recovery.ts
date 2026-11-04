import { validateOwnerCredentials } from './bootstrap'
import { hashPassword } from './password'

export type OwnerRecovery = {
  ownerId: string
  username: string
  expectedAuthVersion: number
  password: string
}

/**
 * Trusted control-plane primitive, NOT an HTTP handler or an authorization mechanism.
 * A future caller must authorize the operator independently before invoking this core.
 * No caller is wired in M3C. The existing F2 trigger revokes sessions in this statement.
 */
export async function recoverOwnerCredentials(
  db: D1Database,
  input: OwnerRecovery,
  pepper: string,
): Promise<boolean> {
  validateOwnerCredentials(input.username, input.password)
  if (
    typeof input.ownerId !== 'string' ||
    input.ownerId.length < 1 ||
    input.ownerId.length > 128 ||
    !Number.isSafeInteger(input.expectedAuthVersion) ||
    input.expectedAuthVersion < 1 ||
    input.expectedAuthVersion >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('Invalid owner recovery command')
  const hash = await hashPassword(input.password, pepper)
  const changed = await db
    .prepare(`UPDATE admin_users SET password_hash = ?
    WHERE id = ? AND username = ? AND active = 1 AND auth_version = ?
    RETURNING id`)
    .bind(hash, input.ownerId, input.username, input.expectedAuthVersion)
    .first<{ id: string }>()
  return changed?.id === input.ownerId
}
