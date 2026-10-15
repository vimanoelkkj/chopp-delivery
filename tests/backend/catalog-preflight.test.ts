import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { catalogPreflight } from '../../server/catalog-expansion/preflight'
import { authFixture } from './auth-fixture'

const migration = readFileSync('migrations/0005_catalog_expansion.sql', 'utf8')
const history = [
  '0001_catalog.sql',
  '0002_catalog_seed.sql',
  '0003_admin_auth.sql',
  '0004_catalog_revision.sql',
]
let f: Awaited<ReturnType<typeof authFixture>>
const read = async (sql: string) => {
  expect(sql).toMatch(/^(SELECT|PRAGMA)\b/)
  return (await f.db.prepare(sql).all()).results
}
const run = () => catalogPreflight(read, migration)
const state = async () =>
  (
    await f.db.batch(
      ['products', 'cachaca', 'catalog_meta', 'd1_migrations', 'sqlite_schema'].map((t) =>
        f.db.prepare(`SELECT * FROM ${t}`),
      ),
    )
  ).map((r) => r.results)
beforeEach(async () => {
  f = await authFixture()
  await f.db
    .prepare(
      'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    )
    .run()
  await f.db.batch(
    history.map((name) => f.db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(name)),
  )
})
afterEach(async () => {
  await f?.runtime.dispose()
})
it('aprova o catálogo efetivo editado, preserva todas as linhas e só executa leituras', async () => {
  await f.db
    .prepare(
      "UPDATE products SET name='Nome editado',price_30_cents=51029,visible=0,sort_order=42 WHERE id='dronken'",
    )
    .run()
  await f.db.prepare('UPDATE cachaca SET bottle_ml=750,price_cents=49099').run()
  const before = await state(),
    r = await run()
  expect(r.ok).toBe(true)
  expect(r.blockers).toEqual([])
  expect(r.counts).toEqual({ products: 8, cachacas: 1, variants: 17 })
  expect(await state()).toEqual(before)
})
it.each(['\u200b', '\u2060', '\u200d', '\ufe0f', '\u2800', '\u00a0', '\u0301', ' \t '])(
  'bloqueia nome e título somente invisíveis %j sem normalizar',
  async (name) => {
    await f.db.prepare("UPDATE products SET name=? WHERE id='dronken'").bind(name).run()
    await f.db.prepare('UPDATE cachaca SET title=?').bind(name).run()
    const before = await state(),
      r = await run()
    expect(r.ok).toBe(false)
    expect(r.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'products',
          recordId: 'dronken',
          field: 'name',
          code: 'INVALID_TEXT',
        }),
        expect.objectContaining({
          table: 'cachaca',
          recordId: 'cachaca',
          field: 'title',
          code: 'INVALID_TEXT',
        }),
      ]),
    )
    expect(await state()).toEqual(before)
  },
)
it('diagnostica todos os campos incompatíveis, inclusive ocultos e colisão global de IDs', async () => {
  await f.db
    .prepare(
      "UPDATE products SET name=?,description=?,price_30_cents=0,price_50_cents=10000000,sort_order=-1,visible=0 WHERE id='dronken'",
    )
    .bind('a'.repeat(121), 'b'.repeat(2001))
    .run()
  await f.db
    .prepare("UPDATE products SET price_30_cents=NULL,price_50_cents=NULL WHERE id='brahma'")
    .run()
  await f.db
    .prepare("UPDATE cachaca SET id='dronken',price_cents=0,bottle_ml=9007199254740992")
    .run()
  const before = await state(),
    r = await run()
  for (const field of [
    'name',
    'description',
    'price_30_cents',
    'price_50_cents',
    'sort_order',
    'bottle_ml',
  ])
    expect(r.blockers.some((b) => b.field === field)).toBe(true)
  expect(r.blockers.some((b) => b.code === 'ID_COLLISION')).toBe(true)
  expect(
    r.blockers.some((b) => b.code === 'VISIBLE_WITHOUT_PRICE' && b.recordId === 'brahma'),
  ).toBe(true)
  expect(await state()).toEqual(before)
})
it.each([
  { field: 'id', value: 'id\t', code: 'INVALID_ID' },
  { field: 'id', value: 'id\u202e', code: 'INVALID_ID' },
  { field: 'id', value: 'a'.repeat(129), code: 'INVALID_ID' },
  { field: 'name', value: 'Nome\u0001', code: 'INVALID_TEXT' },
  { field: 'description', value: 'Descrição\u202e', code: 'INVALID_TEXT' },
])(
  'bloqueia incompatibilidade v2 $field/$code sem modificar dados',
  async ({ field, value, code }) => {
    await f.db.prepare(`UPDATE products SET ${field}=? WHERE id='dronken'`).bind(value).run()
    const before = await state(),
      result = await run()
    expect(result.ok).toBe(false)
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ table: 'products', field, code }),
    )
    expect(await state()).toEqual(before)
  },
)
it.each([
  'partial',
  'missing-trigger',
  'history',
  'already-applied',
  'revision',
  'missing-column',
] as const)('bloqueia pré-condição %s', async (mode) => {
  if (mode === 'partial') await f.db.prepare('CREATE TABLE _catalog_assert(ok INTEGER)').run()
  if (mode === 'missing-trigger') await f.db.prepare('DROP TRIGGER products_revision_insert').run()
  if (mode === 'history')
    await f.db.prepare("DELETE FROM d1_migrations WHERE name='0004_catalog_revision.sql'").run()
  if (mode === 'already-applied')
    await f.db.prepare("INSERT INTO d1_migrations(name) VALUES('0005_catalog_expansion.sql')").run()
  if (mode === 'revision')
    await f.db.prepare('UPDATE catalog_meta SET revision=9007199254740991').run()
  if (mode === 'missing-column')
    await f.db.prepare('ALTER TABLE products RENAME COLUMN price_30_cents TO incompatible').run()
  const before = await state(),
    r = await run()
  expect(r.ok).toBe(false)
  expect(r.blockers.length).toBeGreaterThan(0)
  expect(await state()).toEqual(before)
})
it('detecta orçamento UTF-8 incompatível com PUT v2 e não descarta itens', async () => {
  const description = '🍺'.repeat(2000)
  await f.db.batch(
    Array.from({ length: 20 }, (_, i) =>
      f.db
        .prepare('INSERT INTO products(id,name,description,price_30_cents) VALUES(?,?,?,?)')
        .bind(`extra-${i}`, 'Extra', description, 100),
    ),
  )
  const before = await state(),
    r = await run()
  expect(r.counts.products).toBe(28)
  expect(r.blockers.some((b) => b.code === 'WRITE_BODY_LIMIT')).toBe(true)
  expect(await state()).toEqual(before)
})

it('preserva Unicode visível com ZWJ/acentos e permite chope oculto com preços null', async () => {
  await f.db
    .prepare(
      "UPDATE products SET name=?,visible=0,price_30_cents=NULL,price_50_cents=NULL WHERE id='dronken'",
    )
    .bind('  👩‍🔬 Café e\u0301  ')
    .run()
  const before = await state()
  expect((await run()).ok).toBe(true)
  expect(await state()).toEqual(before)
})
it('histórico ausente, singleton ausente e trigger desconhecido nunca produzem GO', async () => {
  await f.db.prepare('DROP TABLE d1_migrations').run()
  await f.db.prepare('DELETE FROM catalog_meta').run()
  await f.db
    .prepare('CREATE TRIGGER unknown_meta AFTER UPDATE ON catalog_meta BEGIN SELECT 1; END')
    .run()
  const r = await run()
  for (const code of ['SOURCE_TABLE_MISSING', 'REVISION_UNAVAILABLE', 'UNEXPECTED_TRIGGER'])
    expect(r.blockers.some((b) => b.code === code)).toBe(true)
})
it('dependência de autorização pós-corte ausente fecha o preflight', async () => {
  await f.db.prepare('DROP TABLE admin_sessions').run()
  const r = await run()
  expect(r.ok).toBe(false)
  expect(
    r.blockers.some((b) => b.code === 'READ_FAILED' && b.table === 'admin_users/admin_sessions'),
  ).toBe(true)
})
it('limite de itens v2 é verificado sobre todos os registros', async () => {
  await f.db.batch(
    Array.from({ length: 121 }, (_, i) =>
      f.db
        .prepare('INSERT INTO products(id,name,description,price_30_cents)VALUES(?,?,?,?)')
        .bind(`new-${i}`, 'Novo', '', 1),
    ),
  )
  const r = await run()
  expect(r.counts.products).toBe(129)
  expect(r.blockers.some((b) => b.code === 'WRITE_COUNT_LIMIT')).toBe(true)
})
