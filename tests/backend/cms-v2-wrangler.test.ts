import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Miniflare } from 'miniflare'
import { expect, it } from 'vitest'
import { childEnv } from '../../scripts/clean-env.mts'
import { requireAdmin } from '../../server/auth/guard'
import { handleLogin } from '../../server/auth/handlers'
import { convertCmsV1ToV2 } from '../../server/cms/convert'
import { cmsRepository } from '../../server/cms/repository'
import { authRequest, loginBody, seedOwner, TEST_ORIGIN, TEST_PEPPER } from './auth-fixture'
import { cmsDocument } from './cms-document-fixture'
import { history, ready, splitSql, sql9 } from './cms-v2-sql-fixture'

it('Wrangler real: full upgrade, injected F1-F4, managed/unmanaged F5, preservation and publication guards', async () => {
  const parts = splitSql(sql9()),
    all = []
  const stage1 = parts.findIndex((p) => p.includes('CREATE TRIGGER cms_v2_guard_authorize'))
  const stage3 = parts.findIndex((p) =>
    p.includes('CREATE TRIGGER cms_versions_v2_namespace_supersession'),
  )
  const stage4 = parts.findIndex((p) => p.includes('CREATE VIEW cms_v2_write'))
  const cases = [
    { name: 'full', cut: parts.length },
    { name: 'F1', cut: stage1 },
    { name: 'F2', cut: stage1 + 3 },
    { name: 'F3', cut: stage4 },
    { name: 'F4', cut: parts.length - 1 },
    { name: 'F5', cut: parts.length },
  ]
  expect(stage1).toBeGreaterThan(0)
  expect(stage3).toBeGreaterThan(stage1)
  expect(stage4).toBeGreaterThan(stage3)
  for (const test of cases) {
    const directory = mkdtempSync(join(tmpdir(), 'chopp-cp2-wrangler-')),
      marker = crypto.randomUUID()
    writeFileSync(join(directory, '.owner'), marker)
    const migrations = join(directory, 'migrations')
    mkdirSync(migrations)
    const names = [
      '0001_catalog.sql',
      '0002_catalog_seed.sql',
      '0003_admin_auth.sql',
      '0004_catalog_revision.sql',
      '0005_catalog_expansion.sql',
      '0006_cms_foundation.sql',
      '0007_cms_media_local.sql',
      '0008_cms_media_atomic.sql',
    ]
    for (const name of names) copyFileSync(join('migrations', name), join(migrations, name))
    const id = crypto.randomUUID(),
      config = join(directory, 'wrangler.json'),
      persist = join(directory, 'state')
    writeFileSync(
      config,
      JSON.stringify({
        name: 'chopp-cp2-disposable',
        compatibility_date: '2026-08-06',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'chopp-cp2-disposable',
            database_id: id,
            migrations_dir: migrations,
          },
        ],
      }),
    )
    const command = (args: string[], fail = false) => {
      if (readFileSync(join(directory, '.owner'), 'utf8') !== marker)
        throw Error('Disposable ownership changed')
      try {
        const output = execFileSync(
          process.execPath,
          [
            resolve('node_modules/wrangler/bin/wrangler.js'),
            'd1',
            ...args,
            'DB',
            '--local',
            '--config',
            config,
            '--persist-to',
            persist,
          ],
          {
            cwd: process.cwd(),
            env: childEnv({ WRANGLER_SEND_METRICS: 'false', CI: 'true' }),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        )
        if (fail) throw Error('Injected failure unexpectedly succeeded')
        return { code: 0, output }
      } catch (error) {
        if (!fail) throw error
        const e = error as { status?: number; stdout?: string; stderr?: string }
        if (!e.status) throw error
        return { code: e.status, output: String(e.stdout) + String(e.stderr) }
      }
    }
    // Wrangler subcommand arguments must precede the binding and options.
    const migrate = (fail = false) => command(['migrations', 'apply'], fail)
    migrate()
    const connect = async () => {
      const runtime = new Miniflare({
        modules: true,
        script: 'export default {fetch(){return new Response(null)}}',
        compatibilityDate: '2026-08-06',
        d1Databases: { DB: id },
        d1Persist: join(persist, 'v3', 'd1'),
      })
      return { runtime, db: await runtime.getD1Database('DB') }
    }
    let connection = await connect()
    let cookie = '',
      first: ReturnType<typeof cmsDocument> | undefined
    const env = () => ({
      DELEGAS_DB: connection.db,
      ADMIN_ORIGIN: TEST_ORIGIN,
      ADMIN_PASSWORD_PEPPER: TEST_PEPPER,
      ADMIN_ALLOW_INSECURE_LOCAL: '1',
    })
    const request = () =>
      new Request(`${TEST_ORIGIN}/api/admin/site`, {
        headers: { Origin: TEST_ORIGIN, Cookie: cookie },
      })
    const repository = async () => {
      const auth = await requireAdmin(request(), env())
      if (auth.error) throw Error('Local session invalid')
      return { repo: cmsRepository(connection.db, auth), auth }
    }
    let original = '',
      oldReceipt: unknown,
      operation = '',
      lastRevision = '',
      lastVersion = ''
    try {
      await seedOwner(connection.db)
      cookie =
        (await handleLogin(authRequest('login', { body: loginBody() }), env())).headers.get(
          'set-cookie',
        ) ?? ''
      await connection.db.prepare('CREATE TABLE cp2_disposable_owner(id TEXT PRIMARY KEY)').run()
      await connection.db.prepare('INSERT INTO cp2_disposable_owner VALUES(?)').bind(marker).run()
      const media = `media_${crypto.randomUUID()}`
      await connection.db
        .prepare('INSERT INTO cms_media(media_id,state,created_at) VALUES(?,?,?)')
        .bind(media, 'quarantined', Date.now())
        .run()
      const { repo } = await repository()
      const state = await repo.load()
      first = cmsDocument()
      Object.assign(first.modules[0].content, { media: { id: media, alt: 'Local upgrade' } })
      operation = crypto.randomUUID()
      const result = await repo.save({
        action: 'saveDraft',
        operationId: operation,
        expectedRevision: state.draft.revision,
        document: first,
      })
      oldReceipt = await repo.command(operation)
      lastRevision = result.command.revision
      lastVersion = result.command.versionId
      original = await history(connection.db)
      expect(
        await connection.db
          .prepare("SELECT json_type(?,'$.schemaVersion') t")
          .bind('{"schemaVersion":2.0}')
          .first('t'),
      ).toBe('real')
    } finally {
      await connection.runtime.dispose()
    }
    const broken = test.name.startsWith('F') && test.name !== 'F5'
    const migration =
      parts.slice(0, test.cut).join('') +
      (broken ? '\nSELECT * FROM cp2_injected_failure;\n' : '') +
      parts.slice(test.cut).join('')
    writeFileSync(join(migrations, '0009_cms_v2.sql'), migration)
    const applied = migrate(broken)
    writeFileSync(join(directory, 'apply.log'), applied.output)
    if (test.name === 'F5') {
      const again = migrate()
      expect(again.code).toBe(0)
      writeFileSync(join(directory, 'reapply.log'), again.output)
      const raw = join(directory, 'reapply.sql')
      writeFileSync(raw, sql9())
      const duplicate = command(['execute', '--file', raw], true)
      expect(duplicate.code).not.toBe(0)
      writeFileSync(join(directory, 'raw-reapply.log'), duplicate.output)
    }
    connection = await connect()
    try {
      expect(await history(connection.db)).toBe(original)
      const { repo, auth } = await repository()
      expect(await repo.command(operation)).toEqual(oldReceipt)
      const state = await repo.load(),
        next = {
          action: 'saveDraft' as const,
          operationId: crypto.randomUUID(),
          expectedRevision: state.draft.revision,
          document: first!,
        }
      const saved = await repo.save(next)
      expect(await repo.save(next)).toEqual(saved)
      expect(await repo.command(next.operationId)).toEqual(saved)
      const old = await connection.db
        .prepare('SELECT document_json FROM cms_versions WHERE version_id=?')
        .bind(lastVersion)
        .first('document_json')
      expect(old).toBe(JSON.parse(original)[0][0].document_json)
      const isReady = await ready(connection.db),
        objects = (
          await connection.db
            .prepare(
              "SELECT name FROM sqlite_schema WHERE name LIKE 'cms_v2_%' OR name IN ('cms_ready_v2','cms_versions_v2_namespace_supersession','cms_state_v2_supersession','cms_media_v2_referenced_guard') ORDER BY name",
            )
            .all()
        ).results
      if (broken) expect(isReady).toBe(false)
      else expect(isReady).toBe(true)
      if (isReady) {
        const version = `version_${crypto.randomUUID()}`,
          rev = `c2_${crypto.randomUUID()}`,
          op = crypto.randomUUID(),
          doc = convertCmsV1ToV2(first!).document
        await connection.db
          .prepare(
            'UPDATE cms_v2_write SET version_id=?,operation_id=?,expected_revision=?,resulting_revision=?,document_json=?,command_hash=?,actor_id=?,session_hash=?,origin=?,origin_kind=?,source_version_id=? WHERE singleton=1',
          )
          .bind(
            version,
            op,
            saved.command.revision,
            rev,
            JSON.stringify(doc),
            'a'.repeat(64),
            auth.principal.user.id,
            auth.principal.sessionHash,
            auth.config.origin,
            'convert',
            saved.command.versionId,
          )
          .run()
        await expect(
          repo.save({
            ...next,
            operationId: crypto.randomUUID(),
            expectedRevision: saved.command.revision,
          }),
        ).rejects.toThrow('CMS_SCHEMA_SUPERSEDED')
        expect(await repo.command(operation)).toEqual(oldReceipt)
        for (const table of ['cms_state', 'cms_v2_state'])
          await expect(
            connection.db
              .prepare(
                `UPDATE ${table} SET published_version_id=draft_version_id,published_revision=draft_revision`,
              )
              .run(),
          ).rejects.toThrow()
        for (const table of ['cms_versions', 'cms_v2_versions']) {
          const extra = table === 'cms_versions' ? '' : ',origin_kind,source_version_id',
            values = table === 'cms_versions' ? '' : ",'save',NULL"
          await expect(
            connection.db
              .prepare(
                `INSERT INTO ${table}(version_id,kind,operation_id,expected_revision,resulting_revision,document_json,command_hash,actor_id,created_at${extra}) SELECT 'version_'||?,'published',?,?,document_json,command_hash,actor_id,created_at${values} FROM ${table} LIMIT 1`,
              )
              .bind(
                crypto.randomUUID(),
                crypto.randomUUID(),
                lastRevision,
                `${table === 'cms_versions' ? 'c1' : 'c2'}_${crypto.randomUUID()}`,
              )
              .run(),
          ).rejects.toThrow()
        }
      }
      const result = {
        case: test.name,
        directory,
        wranglerExit: applied.code,
        objectsRetained: objects.length,
        v2Ready: isReady,
        legacyBytesSha256: createHash('sha256').update(original).digest('hex'),
        legacyDocumentsSha256: createHash('sha256')
          .update(
            JSON.stringify(
              JSON.parse(original)[0].map((row: { document_json: string }) => row.document_json),
            ),
          )
          .digest('hex'),
        legacyRefsSha256: createHash('sha256')
          .update(JSON.stringify(JSON.parse(original)[1]))
          .digest('hex'),
        legacyReceiptSha256: createHash('sha256').update(JSON.stringify(oldReceipt)).digest('hex'),
        v1Save: true,
        v1Replay: true,
        oldReceipt: true,
        partialMigrationAtomic: broken ? objects.length === 0 : null,
      }
      all.push(result)
      writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2))
    } finally {
      await connection.runtime.dispose()
    }
  }
  const evidence = mkdtempSync(join(tmpdir(), 'chopp-cp2-wrangler-evidence-'))
  writeFileSync(join(evidence, '.owner'), 'cp2-wrangler-evidence')
  writeFileSync(join(evidence, 'results.json'), JSON.stringify(all, null, 2))
  console.log('CP2 Wrangler evidence', evidence, all)
}, 300000)
