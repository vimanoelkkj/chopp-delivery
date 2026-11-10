import type { Readable } from 'node:stream'
import { build } from 'esbuild'
import { Log, LogLevel, Miniflare } from 'miniflare'
import { describe, expect, it } from 'vitest'
import { applyTestMigration, TEST_PASSWORD, TEST_PEPPER } from './auth-fixture'

const id = '12345678-1234-4123-8123-123456789012'

// Real scheduled handler, F2 crypto and disposable D1; no mocked bootstrap or remote bindings.
async function fixture(password = TEST_PASSWORD, pepper = TEST_PEPPER, schema = true) {
  const bundle = await build({
    entryPoints: ['server/auth/maintenance-worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  })
  let logs = ''
  const runtime = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-06',
    d1Databases: { DELEGAS_DB: crypto.randomUUID() },
    d1Persist: false,
    log: new Log(LogLevel.NONE),
    handleRuntimeStdio(stdout: Readable, stderr: Readable) {
      for (const stream of [stdout, stderr])
        stream.on('data', (chunk: Buffer | string) => {
          logs += chunk.toString()
        })
    },
    bindings: {
      MAINTENANCE_ENVIRONMENT: 'homologation',
      MAINTENANCE_ENABLED: 'armed-v1',
      ADMIN_ORIGIN: 'https://homologation.example',
      ADMIN_PASSWORD_PEPPER: pepper,
      MAINTENANCE_PASSWORD: password,
      MAINTENANCE_COMMAND: JSON.stringify({
        commandId: id,
        environment: 'homologation',
        action: 'bootstrap',
        username: 'admin',
        expectedAuthVersion: 0,
      }),
    },
  })
  try {
    const db = await runtime.getD1Database('DELEGAS_DB')
    if (schema) await applyTestMigration(db, '0003_admin_auth.sql')
    return { runtime, db, logs: () => logs }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

describe('H2C.3 real maintenance bootstrap and safe diagnostics', () => {
  it('creates one owner in workerd; replay does not replace the persisted account', async () => {
    const f = await fixture()
    try {
      const worker = await f.runtime.getWorker()
      await worker.scheduled({ cron: '* * * * *' })
      const owner = await f.db
        .prepare('SELECT id,username,active,auth_version FROM admin_users')
        .all()
      expect(owner.results).toEqual([
        { id: expect.any(String), username: 'admin', active: 1, auth_version: 1 },
      ])
      await worker.scheduled({ cron: '* * * * *' })
      expect(
        (await f.db.prepare('SELECT id,username,active,auth_version FROM admin_users').all())
          .results,
      ).toEqual(owner.results)
      expect(f.logs()).toContain('APPLIED')
      expect(f.logs()).toContain('NOT_APPLIED')
      expect(f.logs()).not.toContain(TEST_PASSWORD)
      expect(f.logs()).not.toContain(TEST_PEPPER)
    } finally {
      await f.runtime.dispose()
    }
  })

  it('diagnoses a failing D1 trigger without exposing its sensitive exception', async () => {
    const f = await fixture()
    try {
      await f.db
        .prepare(`CREATE TRIGGER reject_owner BEFORE INSERT ON admin_users
        BEGIN SELECT RAISE(ABORT,'SENSITIVE_SQL_SENTINEL'); END`)
        .run()
      await (await f.runtime.getWorker()).scheduled({ cron: '* * * * *' })
      expect(f.logs()).toContain('UNCONFIRMED')
      expect(f.logs()).toContain('d1_write')
      expect(f.logs()).not.toContain('SENSITIVE_SQL_SENTINEL')
      expect(f.logs()).not.toContain(TEST_PASSWORD)
      expect(f.logs()).not.toContain(TEST_PEPPER)
      expect(await f.db.prepare('SELECT count(*) AS n FROM admin_users').first('n')).toBe(0)
    } finally {
      await f.runtime.dispose()
    }
  })

  it.each([
    ['short password', 'aB3$eF7', TEST_PEPPER, true, 'credentials_validation'],
    ['malformed pepper', TEST_PASSWORD, 'INVALID-PEPPER-SENTINEL', true, 'auth_config'],
    ['missing schema', TEST_PASSWORD, TEST_PEPPER, false, 'd1_write'],
  ] as const)(
    'classifies %s without logging secret values or SQL',
    async (_, password, pepper, schema, stage) => {
      const f = await fixture(password, pepper, schema)
      try {
        await (await f.runtime.getWorker()).scheduled({ cron: '* * * * *' })
        expect(f.logs()).toContain('UNCONFIRMED')
        expect(f.logs()).toContain(stage)
        expect(f.logs()).not.toContain(password)
        expect(f.logs()).not.toContain(pepper)
        expect(f.logs()).not.toContain('INSERT INTO')
        expect(f.logs()).not.toContain('password_hash')
        if (schema)
          expect(await f.db.prepare('SELECT count(*) AS n FROM admin_users').first('n')).toBe(0)
      } finally {
        await f.runtime.dispose()
      }
    },
  )
})
