import { hashPassword } from './password.ts'
import { passwordPolicyIssue } from './password-policy.ts'

export function validateOwnerCredentials(username: string, password: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) || passwordPolicyIssue(username, password)) {
    throw new Error('Credenciais de bootstrap inválidas')
  }
}

export type BootstrapStage =
  | 'credentials_validation'
  | 'password_hash'
  | 'owner_id'
  | 'd1_write'
  | 'd1_result'

/** Só cria o primeiro proprietário; não redefine credenciais existentes. */
export async function bootstrapOwner(
  db: D1Database,
  username: string,
  password: string,
  pepper: string,
  onStage?: (stage: BootstrapStage) => void,
): Promise<boolean> {
  onStage?.('credentials_validation')
  validateOwnerCredentials(username, password)
  onStage?.('password_hash')
  const hash = await hashPassword(password, pepper)
  onStage?.('owner_id')
  const ownerId = crypto.randomUUID()
  onStage?.('d1_write')
  const result = await db
    .prepare(`INSERT INTO admin_users (id, username, password_hash)
    SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_users)`)
    .bind(ownerId, username, hash)
    .run()
  onStage?.('d1_result')
  return result.meta.changes === 1
}
