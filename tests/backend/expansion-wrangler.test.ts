import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { Miniflare } from 'miniflare'
import { expect, it } from 'vitest'

async function cleanup(scratch: string, marker: string) {
  const root = await realpath(tmpdir()),
    target = await realpath(scratch)
  if (
    !target.startsWith(`${root}${sep}`) ||
    !basename(target).startsWith('delegas-expansion-migration-') ||
    (await readFile(join(target, 'owner'), 'utf8')) !== marker
  )
    throw new Error('Temp ownership mismatch')
  await rm(target, { recursive: true, force: true })
}

it.each(['ddl', 'backfill', 'retire', 'revision', 'equivalence'])(
  'Wrangler 0005: falha em %s reverte schema, dados, revisão e histórico',
  async (checkpoint) => {
    const scratch = await mkdtemp(join(tmpdir(), 'delegas-expansion-migration-'))
    const marker = crypto.randomUUID()
    await writeFile(join(scratch, 'owner'), marker)
    const migrationDir = join(scratch, 'migrations')
    await cp(resolve('migrations'), migrationDir, { recursive: true })
    const file = join(migrationDir, '0005_catalog_expansion.sql')
    const sql = await readFile(file, 'utf8')
    await rm(file)
    const config = join(scratch, 'wrangler.jsonc'),
      state = join(scratch, 'state')
    await writeFile(
      config,
      JSON.stringify({
        name: 'delegas-disposable-migration',
        compatibility_date: '2026-08-06',
        d1_databases: [
          { binding: 'DB', database_name: 'DB', database_id: 'DB', migrations_dir: migrationDir },
        ],
      }),
    )
    const migrate = () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/wrangler/bin/wrangler.js',
          'd1',
          'migrations',
          'apply',
          'DB',
          '--local',
          '--config',
          config,
          '--persist-to',
          state,
        ],
        { encoding: 'utf8', stdio: 'pipe', windowsHide: true },
      )
    const open = () =>
      new Miniflare({
        modules: true,
        script: 'export default {fetch(){return new Response("test")}}',
        compatibilityDate: '2026-08-06',
        d1Databases: { DB: 'DB' },
        d1Persist: join(state, 'v3', 'd1'),
      })
    let runtime: Miniflare | undefined
    try {
      migrate()
      runtime = open()
      let db = await runtime.getD1Database('DB')
      await db
        .prepare(
          "UPDATE products SET price_30_cents=12345,visible=0,sort_order=42 WHERE id='dronken'",
        )
        .run()
      const snapshot = async () =>
        (
          await db.batch([
            db.prepare(
              "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
            ),
            db.prepare('SELECT * FROM products ORDER BY id'),
            db.prepare('SELECT * FROM cachaca'),
            db.prepare('SELECT * FROM catalog_meta'),
            db.prepare('SELECT * FROM d1_migrations ORDER BY id'),
          ])
        ).map((r) => r.results)
      const before = await snapshot()
      await runtime.dispose()
      runtime = undefined
      const injection =
        checkpoint === 'equivalence'
          ? "DELETE FROM catalog_variants WHERE item_id='brahma' AND code='30';"
          : 'CREATE TABLE injected_failure(ok INTEGER CHECK(ok=1)); INSERT INTO injected_failure VALUES(0);'
      const target = checkpoint === 'equivalence' ? 'backfill' : checkpoint
      await writeFile(
        file,
        sql.replace(`-- checkpoint: ${target}`, `-- checkpoint: ${target}\n${injection}`),
      )
      expect(() => migrate()).toThrow()
      runtime = open()
      db = await runtime.getD1Database('DB')
      expect(await snapshot()).toEqual(before)
      expect(
        await db
          .prepare("SELECT COUNT(*) FROM sqlite_schema WHERE name LIKE 'catalog_items%'")
          .first('COUNT(*)'),
      ).toBe(0)
      await runtime.dispose()
      runtime = undefined
      // Restore the exact candidate and retry on the rolled-back database.
      await writeFile(file, sql)
      migrate()
      runtime = open()
      db = await runtime.getD1Database('DB')
      expect(
        await db
          .prepare("SELECT price_cents FROM catalog_variants WHERE item_id='dronken' AND code='30'")
          .first('price_cents'),
      ).toBe(12345)
      expect(await db.prepare('SELECT COUNT(*) FROM catalog_ready').first('COUNT(*)')).toBe(1)
    } finally {
      await runtime?.dispose()
      await cleanup(scratch, marker)
    }
  },
  30000,
)
