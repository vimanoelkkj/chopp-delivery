import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import type { AuthEnv } from '../../server/auth/http'
import { hashPassword } from '../../server/auth/password'

export const TEST_ORIGIN = 'http://127.0.0.1:8788'
export const TEST_PASSWORD = 'Uma frase longa apenas para testes'
export const TEST_PEPPER = 'ab'.repeat(32)

export async function applyTestMigration(db: D1Database, file: string) {
  const sql = readFileSync(`migrations/${file}`, 'utf8').replace(/^--.*$/gm, '')
  const [ordinary, ...triggers] = sql.split(/(?=^CREATE TRIGGER)/m)
  await db.batch(
    ordinary
      .split(';')
      .filter((part) => part.trim())
      .map((part) => db.prepare(part)),
  )
  for (const trigger of triggers) await db.prepare(trigger).run()
}

export async function authFixture(includeCatalogRevision = true) {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("test") } }',
    compatibilityDate: '2026-08-06',
    d1Databases: { DELEGAS_DB: 'delegas-auth-test' },
    d1Persist: false,
  })
  const db = await runtime.getD1Database('DELEGAS_DB')
  for (const file of [
    '0001_catalog.sql',
    '0002_catalog_seed.sql',
    '0003_admin_auth.sql',
    ...(includeCatalogRevision ? ['0004_catalog_revision.sql'] : []),
  ]) {
    await applyTestMigration(db, file)
  }
  const env: AuthEnv = {
    DELEGAS_DB: db,
    ADMIN_ORIGIN: TEST_ORIGIN,
    ADMIN_PASSWORD_PEPPER: TEST_PEPPER,
    ADMIN_ALLOW_INSECURE_LOCAL: '1',
  }
  return { runtime, db, env }
}

export async function seedOwner(db: D1Database) {
  const passwordHash = await hashPassword(TEST_PASSWORD, TEST_PEPPER)
  await db
    .prepare('INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)')
    .bind('owner-test', 'owner', passwordHash)
    .run()
}

export function authRequest(
  path: string,
  options: {
    method?: string
    body?: string
    cookie?: string
    origin?: string | null
    headers?: Record<string, string>
    urlOrigin?: string
  } = {},
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json', ...options.headers })
  if (options.origin !== null) headers.set('Origin', options.origin ?? TEST_ORIGIN)
  if (options.cookie) headers.set('Cookie', options.cookie)
  return new Request(`${options.urlOrigin ?? TEST_ORIGIN}/api/auth/${path}`, {
    method: options.method ?? 'POST',
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  })
}

export const loginBody = (username = 'owner', password = TEST_PASSWORD) =>
  JSON.stringify({ username, password })
