import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

async function cleanup(path: string) {
  const root = await realpath(tmpdir()),
    target = await realpath(path)
  if (!target.startsWith(`${root}${sep}`) || !basename(target).startsWith('delegas-preflight-'))
    throw new Error('Unsafe cleanup path')
  await rm(target, { recursive: true, force: true })
}
const run = (args: string[]) =>
  spawnSync(process.execPath, ['scripts/catalog-preflight.mjs', ...args], {
    encoding: 'utf8',
    windowsHide: true,
  })
const history = [
  '0001_catalog.sql',
  '0002_catalog_seed.sql',
  '0003_admin_auth.sql',
  '0004_catalog_revision.sql',
]
async function fixture(file: string) {
  const db = new DatabaseSync(file)
  try {
    for (const name of history) db.exec(await readFile(`migrations/${name}`, 'utf8'))
    db.exec(
      'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    )
    for (const name of history) db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
async function filesState(directory: string) {
  return Promise.all(
    (await readdir(directory)).sort().map(async (name) => [
      name,
      createHash('sha256')
        .update(await readFile(join(directory, name)))
        .digest('hex'),
    ]),
  )
}
it('CLI lê SQLite descartável em modo somente leitura, reporta todos os erros e não altera arquivo/schema', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'delegas-preflight-')),
    file = join(scratch, 'snapshot # % café.sqlite')
  try {
    const db = await fixture(file)
    db.close()
    const hash = async () =>
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
    const before = await hash(),
      files = await readdir(scratch)
    const ok = run(['--sqlite', file])
    expect(ok.status, ok.stderr).toBe(0)
    expect(JSON.parse(ok.stdout).ok).toBe(true)
    expect(await hash()).toBe(before)
    expect(await readdir(scratch)).toEqual(files)
    const edit = new DatabaseSync(file)
    edit.prepare("UPDATE products SET name=? WHERE id='dronken'").run('\u200b\u2060')
    edit.exec('UPDATE cachaca SET price_cents=0,bottle_ml=9223372036854775807')
    edit.exec("UPDATE products SET name=CAST(x'EDA080' AS TEXT) WHERE id='palato-beber'")
    edit.exec('PRAGMA foreign_keys=OFF')
    edit
      .prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?,?)')
      .run('a'.repeat(64), 'missing-owner', 1, 'http://127.0.0.1', 0, 1)
    edit.close()
    const invalidBefore = await hash(),
      invalid = run(['--sqlite', file])
    expect(invalid.status, invalid.stderr).toBe(1)
    const result = JSON.parse(invalid.stdout)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'products',
          field: 'name',
          code: 'INVALID_TEXT',
          codePoints: ['U+200B', 'U+2060'],
        }),
        expect.objectContaining({ table: 'cachaca', field: 'price_cents', code: 'INVALID_CENTS' }),
        expect.objectContaining({ table: 'cachaca', field: 'bottle_ml', code: 'INVALID_VOLUME' }),
        expect.objectContaining({ table: 'admin_sessions', code: 'FOREIGN_KEY' }),
        expect.objectContaining({
          table: 'products',
          recordId: 'palato-beber',
          field: 'name',
          code: 'INVALID_UTF8',
        }),
      ]),
    )
    expect(invalid.stdout).not.toContain('\u200b')
    expect(await hash()).toBe(invalidBefore)
    const missing = join(scratch, 'missing.sqlite')
    expect(run(['--sqlite', missing]).status).toBe(2)
    expect(await readdir(scratch)).toEqual(files)
  } finally {
    await cleanup(scratch)
  }
})
it.each([
  'wal-live',
  'wal-main-only',
  'wal-missing',
  'journal',
  'partial',
  'integrity',
  'integrity-index',
  'corrupt',
])('CLI bloqueia snapshot %s e preserva todos os arquivos inclusive nas falhas', async (mode) => {
  const scratch = await mkdtemp(join(tmpdir(), 'delegas-preflight-')),
    file = join(scratch, 'snapshot.sqlite')
  let db: DatabaseSync | undefined
  try {
    db = await fixture(file)
    if (mode.startsWith('wal')) {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0')
      db.exec("UPDATE products SET name='WAL only' WHERE id='dronken'")
    }
    if (mode === 'partial') db.exec('CREATE TABLE catalog_categories(id TEXT)')
    if (mode === 'integrity')
      db.exec('PRAGMA ignore_check_constraints=ON; UPDATE products SET visible=2')
    if (mode === 'integrity-index') {
      db.enableDefensive(false)
      db.exec(`CREATE INDEX duplicate_visibility ON products(visible);
          PRAGMA writable_schema=ON;
          UPDATE sqlite_schema SET sql=replace(sql,'CREATE INDEX','CREATE UNIQUE INDEX')
          WHERE name='duplicate_visibility'`)
    }
    const input = mode === 'wal-missing' ? `${file}.isolated` : file
    if (mode === 'wal-missing') await copyFile(file, input)
    if (!['wal-live', 'wal-missing'].includes(mode)) {
      db.close()
      db = undefined
    }
    if (mode === 'journal') await writeFile(`${file}-journal`, 'unverified rollback journal')
    if (mode === 'corrupt') await writeFile(file, 'not a SQLite database')
    const before = await filesState(scratch),
      result = run(['--sqlite', input])
    expect(result.status, result.stderr).not.toBe(0)
    expect(JSON.parse(result.stdout).ok).toBe(false)
    expect(await filesState(scratch)).toEqual(before)
  } finally {
    db?.close()
    await cleanup(scratch)
  }
})
it.each(
  [[], ['--remote'], ['--sqlite', 'https://example.invalid/db'], ['--sqlite', ':memory:']].map(
    (args) => ({ args }),
  ),
)('CLI recusa entrada insegura $args', ({ args }) => {
  const r = run(args)
  expect(r.status).toBe(2)
  expect(JSON.parse(r.stdout).ok).toBe(false)
})
