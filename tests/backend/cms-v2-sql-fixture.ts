import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Miniflare } from 'miniflare'
import { localImageWorker } from '../../scripts/local-image-worker.mjs'
import { requireAdmin } from '../../server/auth/guard'
import { convertCmsV1ToV2 } from '../../server/cms/convert'
import { handleCmsCommand } from '../../server/cms/handlers'
import { handleLocalMedia, type LocalMediaEnv } from '../../server/cms/media-library'
import { cmsRepository } from '../../server/cms/repository'
import type { CmsDocumentV2 } from '../../shared/cms'
import { TEST_ORIGIN } from './auth-fixture'
import { mediaFixture } from './media-stage3-fixture'

// Installed Wrangler state machine, not a new SQL tokenizer. Preserve all raw slices.
// Cache only parser functions; databases, fixtures and SQL results remain independent.
let installedParser: ReturnType<typeof vm.createContext> | undefined
function wranglerParser() {
  if (installedParser) return installedParser
  const source = readFileSync('node_modules/wrangler/wrangler-dist/cli.js', 'utf8')
  const start = source.indexOf('function splitSqlIntoStatements(sql)'),
    end = source.indexOf('var transitions;', start)
  const ts = source.indexOf('    transitions = {', end),
    te = source.indexOf('\n    };', ts) + 7
  if (start < 0 || end < 0 || ts < 0 || te < 7) throw Error('Installed Wrangler splitter changed')
  const context = vm.createContext({})
  vm.runInContext(source.slice(start, end) + '\nvar transitions;\n' + source.slice(ts, te), context)
  installedParser = context
  return context
}
export function splitSql(sql: string): string[] {
  const context = wranglerParser()
  const find = context.findCompleteStatementEnd as (
    s: string,
    at: number,
  ) => { end?: number; hasUsefulToken: boolean }
  const parts: string[] = []
  let at = 0
  while (at < sql.length) {
    const found = find(sql, at)
    if (found.end === undefined) {
      if (found.hasUsefulToken || !parts.length) parts.push(sql.slice(at))
      else parts[parts.length - 1] += sql.slice(at)
      break
    }
    parts.push(sql.slice(at, found.end))
    at = found.end
  }
  if (parts.join('') !== sql) throw Error('SQL reconstruction failed')
  return parts
}
export const sql9 = () =>
  existsSync('migrations/0009_cms_v2.sql') ? readFileSync('migrations/0009_cms_v2.sql', 'utf8') : ''
export function executableSql(raw: string): string {
  const context = wranglerParser()
  const statements = (context.splitSqlIntoStatements as (s: string) => string[])(raw)
  if (statements.length !== 1) throw Error('Expected one Wrangler SQL statement')
  return statements[0]
}
export async function applySql(db: D1Database, sql: string) {
  for (const statement of splitSql(sql))
    if (statement.trim()) await db.prepare(executableSql(statement)).run()
}
export async function ready(db: D1Database) {
  if (
    !(await db
      .prepare("SELECT 1 FROM sqlite_schema WHERE name='cms_ready_v2' AND type='view'")
      .first())
  )
    return false
  return Boolean(await db.prepare('SELECT 1 FROM cms_ready_v2').first())
}
export async function history(db: D1Database) {
  return JSON.stringify(
    (
      await db.batch([
        db.prepare('SELECT * FROM cms_versions ORDER BY version_id'),
        db.prepare('SELECT * FROM cms_media_refs ORDER BY version_id,media_id'),
      ])
    ).map((r) => r.results),
  )
}
let snapshot: ReturnType<typeof makeBaseline> | undefined
async function makeBaseline() {
  const f = await mediaFixture()
  try {
    for (const file of ['0007_cms_media_local.sql', '0008_cms_media_atomic.sql'])
      await f.db.prepare('INSERT INTO d1_migrations VALUES(?)').bind(file).run()
    const mediaId = 'media_12345678-1234-4123-8123-123456789012'
    await f.db
      .prepare('INSERT INTO cms_media(media_id,state,created_at) VALUES(?,?,?)')
      .bind(mediaId, 'quarantined', Date.now())
      .run()
    const first = f.command()
    Object.assign(first.document.modules[0].content, { media: { id: mediaId, alt: 'Baseline' } })
    const saved = await f.save(first)
    if (saved.response.status !== 200) throw Error('Baseline draft failed')
    const second = {
      ...first,
      operationId: crypto.randomUUID(),
      expectedRevision: saved.result.command.revision,
    }
    const saved2 = await f.save(second)
    if (saved2.response.status !== 200) throw Error('Baseline receipt failed')
    const schema = (
      await f.db
        .prepare(
          "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid",
        )
        .all<{ type: string; name: string; sql: string }>()
    ).results
    const tables = [] as { name: string; rows: Record<string, unknown>[] }[]
    for (const s of schema.filter((s) => s.type === 'table'))
      tables.push({
        name: s.name,
        rows: (await f.db.prepare(`SELECT * FROM "${s.name}"`).all()).results,
      })
    return {
      schema,
      tables,
      png: f.png,
      cookie: f.cookie,
      first,
      second,
      receipt: saved.result,
      last: saved2.result,
      mediaId,
      env: {
        ADMIN_ORIGIN: f.env.ADMIN_ORIGIN,
        ADMIN_PASSWORD_PEPPER: f.env.ADMIN_PASSWORD_PEPPER,
        ADMIN_ALLOW_INSECURE_LOCAL: f.env.ADMIN_ALLOW_INSECURE_LOCAL,
      },
      history: await history(f.db),
    }
  } finally {
    await f.close()
  }
}
export async function cmsV2Fixture(
  options: { prefix?: number; sql?: string; baselineOnly?: boolean; empty?: boolean } = {},
) {
  snapshot ??= makeBaseline()
  const base = await snapshot
  const instance = crypto.randomUUID()
  const runtime = new Miniflare({
    d1Persist: false,
    r2Persist: false,
    workers: [
      {
        name: 'entry',
        modules: true,
        compatibilityDate: '2026-08-06',
        script: 'export default {fetch(){return new Response(null,{status:404})}}',
        d1Databases: { DB: instance },
        r2Buckets: { BUCKET: instance },
        serviceBindings: { PROCESSOR: 'private' },
      },
      {
        name: 'private',
        modules: true,
        compatibilityDate: '2026-08-06',
        images: { binding: 'IMAGES' },
        script: localImageWorker,
      },
    ],
  })
  try {
    const db = await runtime.getD1Database('DB', 'entry')
    for (const s of base.schema.filter((s) => s.type === 'table')) await db.prepare(s.sql).run()
    for (const t of base.tables)
      for (const originalRow of t.rows) {
        if (options.empty && ['cms_versions', 'cms_media_refs'].includes(t.name)) continue
        const row =
          options.empty && t.name === 'cms_state'
            ? {
                ...originalRow,
                draft_version_id: null,
                draft_revision: base.first.expectedRevision,
              }
            : originalRow
        const keys = Object.keys(row)
        await db
          .prepare(
            `INSERT INTO "${t.name}"(${keys.map((k) => `"${k}"`).join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
          )
          .bind(...keys.map((k) => row[k]))
          .run()
      }
    for (const s of base.schema.filter((s) => s.type !== 'table')) await db.prepare(s.sql).run()
    await db.prepare('CREATE TABLE cp2_disposable_owner(id TEXT PRIMARY KEY)').run()
    await db.prepare('INSERT INTO cp2_disposable_owner VALUES(?)').bind(instance).run()
    const binding = await runtime.getBindings('entry')
    const env = {
      ...base.env,
      DELEGAS_DB: db,
      CMS_MEDIA_LOCAL: 'disposable-v1',
      CMS_MEDIA_BUCKET: await runtime.getR2Bucket('BUCKET', 'entry'),
      CMS_MEDIA_PROCESSOR: binding.PROCESSOR,
    } as LocalMediaEnv
    const request = (method = 'GET', body?: unknown, revision?: string) =>
      new Request(`${TEST_ORIGIN}/api/admin/site`, {
        method,
        headers: {
          Cookie: base.cookie,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
          ...(revision ? { 'If-Match': `"${revision}"` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const auth = await requireAdmin(request(), env)
    if (auth.error) throw Error('Cloned session invalid')
    const repo = cmsRepository(db, auth)
    const before = await history(db)
    if (!options.empty && before !== base.history) throw Error('Baseline clone mismatch')
    if (!options.baselineOnly) {
      const sql = options.sql ?? sql9()
      for (const part of splitSql(sql).slice(0, options.prefix))
        await db.prepare(executableSql(part)).run()
      if (options.prefix === undefined && sql)
        await db.prepare("INSERT INTO d1_migrations VALUES('0009_cms_v2.sql')").run()
    }
    const document = convertCmsV1ToV2(base.last.site.draft.document!).document
    const command = (
      doc: CmsDocumentV2 = document,
      origin = 'convert',
      expected = base.last.command.revision,
    ) => ({
      version: `version_${crypto.randomUUID()}`,
      operation: crypto.randomUUID() as string,
      expected,
      resulting: `c2_${crypto.randomUUID()}`,
      document: JSON.stringify(doc),
      hash: 'a'.repeat(64),
      origin,
      source: origin === 'convert' ? base.last.command.versionId : null,
    })
    const write = async (c: ReturnType<typeof command>) => {
      if (!(await ready(db))) throw Error('CMS_SCHEMA_UNAVAILABLE')
      await db
        .prepare(
          'UPDATE cms_v2_write SET version_id=?,operation_id=?,expected_revision=?,resulting_revision=?,document_json=?,command_hash=?,actor_id=?,session_hash=?,origin=?,origin_kind=?,source_version_id=? WHERE singleton=1',
        )
        .bind(
          c.version,
          c.operation,
          c.expected,
          c.resulting,
          c.document,
          c.hash,
          auth.principal.user.id,
          auth.principal.sessionHash,
          auth.config.origin,
          c.origin,
          c.source,
        )
        .run()
      return db
        .prepare('SELECT * FROM cms_v2_versions WHERE operation_id=?')
        .bind(c.operation)
        .first<Record<string, unknown>>()
    }
    const legacySave = async () => {
      const state = await repo.load(),
        c = {
          ...base.second,
          operationId: crypto.randomUUID(),
          expectedRevision: state.draft.revision,
        }
      const result = await repo.save(c)
      return { c, result }
    }
    const mediaCycle = async () => {
      const operation = crypto.randomUUID(),
        id = `media_${operation}`
      const rejected = await handleLocalMedia(
        new Request(`${TEST_ORIGIN}/api/admin/media`, {
          method: 'POST',
          headers: {
            Cookie: base.cookie,
            Origin: TEST_ORIGIN,
            'X-Operation-Id': operation,
            'If-None-Match': '*',
            'Content-Type': 'image/png',
          },
          body: base.png,
        }),
        env,
      )
      if (rejected.status !== 200) throw Error('Unrelated upload failed')
      const row = await db
        .prepare('SELECT revision FROM cms_media WHERE media_id=?')
        .bind(id)
        .first<{ revision: string }>()
      if (!row) throw Error('Upload lifecycle missing')
      const removed = await handleLocalMedia(
        new Request(`${TEST_ORIGIN}/api/admin/media/${id}`, {
          method: 'DELETE',
          headers: {
            Cookie: base.cookie,
            Origin: TEST_ORIGIN,
            'X-Operation-Id': crypto.randomUUID(),
            'If-Match': `"${row.revision}"`,
          },
        }),
        env,
        id,
      )
      if (removed.status !== 200) throw Error('Unrelated delete failed')
    }
    const getReceipt = (id: string) => handleCmsCommand(request(), env, id)
    return {
      runtime,
      db,
      env,
      auth,
      repo,
      base,
      instance,
      request,
      document,
      command,
      write,
      legacySave,
      mediaCycle,
      getReceipt,
      close: () => runtime.dispose(),
    }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
