import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { Miniflare } from 'miniflare'
import { expect, it } from 'vitest'
import { bootstrapOwner } from '../../server/auth/bootstrap'
import { TEST_PASSWORD, TEST_PEPPER } from './auth-fixture'

async function cleanupOwned(scratch: string, marker: string, ownership: string) {
  const root = await realpath(tmpdir())
  const target = await realpath(scratch)
  if (
    !target.startsWith(`${root}${sep}`) ||
    !basename(target).startsWith('delegas-auth-migrations-') ||
    (await readFile(marker, 'utf8')) !== ownership
  ) {
    throw new Error('Diretório temporário não pertence ao teste')
  }
  await rm(target, { recursive: true, force: true })
}

it('Wrangler reaplica a inicialização local sem perder catálogo, proprietário ou versões', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'delegas-auth-migrations-'))
  const ownership = crypto.randomUUID()
  const marker = join(scratch, 'delegas-test-owner.txt')
  await writeFile(marker, ownership)
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'd1',
        'migrations',
        'apply',
        'DELEGAS_DB',
        '--local',
        '--persist-to',
        scratch,
      ],
      { encoding: 'utf8', stdio: 'pipe', windowsHide: true },
    )
  let runtime: Miniflare | undefined
  const open = () =>
    new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: '2026-08-06',
      d1Databases: { DELEGAS_DB: 'DELEGAS_DB' },
      d1Persist: join(scratch, 'v3', 'd1'),
    })
  try {
    migrate()
    runtime = open()
    let db = await runtime.getD1Database('DELEGAS_DB')
    await bootstrapOwner(db, 'owner', TEST_PASSWORD, TEST_PEPPER)
    await db
      .prepare('UPDATE products SET price_30_cents = ? WHERE id = ?')
      .bind(12345, 'dronken')
      .run()
    await db.prepare('UPDATE admin_users SET active = 0').run()
    const revision = await db
      .prepare('SELECT revision FROM catalog_meta WHERE singleton = 1')
      .first('revision')
    expect(revision).toBe(1)
    await runtime.dispose()
    runtime = undefined
    expect(migrate()).toContain('No migrations to apply')
    runtime = open()
    db = await runtime.getD1Database('DELEGAS_DB')
    expect(await db.prepare('SELECT COUNT(*) FROM products').first('COUNT(*)')).toBe(8)
    expect(
      await db
        .prepare('SELECT price_30_cents FROM products WHERE id = ?')
        .bind('dronken')
        .first('price_30_cents'),
    ).toBe(12345)
    expect(
      await db.prepare('SELECT username, active, auth_version FROM admin_users').first(),
    ).toEqual({ username: 'owner', active: 0, auth_version: 2 })
    expect(
      await db.prepare('SELECT revision FROM catalog_meta WHERE singleton = 1').first('revision'),
    ).toBe(revision)
  } finally {
    await runtime?.dispose()
    await cleanupOwned(scratch, marker, ownership)
  }
}, 30_000)
