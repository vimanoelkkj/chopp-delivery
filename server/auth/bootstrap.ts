import { hashPassword } from './password.ts'

/** Só cria o primeiro proprietário; não redefine credenciais existentes. */
export async function bootstrapOwner(
  db: D1Database,
  username: string,
  password: string,
  pepper: string,
): Promise<boolean> {
  if (
    !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) ||
    [...password].length < 15 ||
    [...password].length > 128 ||
    new TextEncoder().encode(password).length > 512
  ) {
    throw new Error('Credenciais de bootstrap inválidas')
  }
  const hash = await hashPassword(password, pepper)
  const result = await db
    .prepare(`INSERT INTO admin_users (id, username, password_hash)
    SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_users)`)
    .bind(crypto.randomUUID(), username, hash)
    .run()
  return result.meta.changes === 1
}
