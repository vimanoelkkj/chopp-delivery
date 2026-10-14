import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authFixture } from './auth-fixture'

describe('PoC de recursos transacionais no runtime D1 real', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  beforeEach(async () => {
    fixture = await authFixture()
    for (const sql of [
      'CREATE TABLE poc_meta (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL) STRICT',
      'INSERT INTO poc_meta VALUES (1, 0)',
      'CREATE TABLE poc_items (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT',
      `CREATE TRIGGER poc_revision AFTER UPDATE ON poc_items WHEN OLD.name IS NOT NEW.name BEGIN UPDATE poc_meta SET revision = revision + 1 WHERE id = 1; END`,
      'CREATE VIEW poc_command AS SELECT id, revision, NULL AS payload FROM poc_meta',
      `CREATE TRIGGER poc_save INSTEAD OF UPDATE OF payload ON poc_command BEGIN
        UPDATE poc_items SET name = desired.name FROM (
          WITH incoming AS MATERIALIZED (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.name') AS name FROM json_each(NEW.payload))
          SELECT * FROM incoming
        ) AS desired WHERE poc_items.id = desired.id AND poc_items.name IS NOT desired.name;
      END`,
    ])
      await fixture.db.prepare(sql).run()
    for (let i = 0; i < 8; i++)
      await fixture.db
        .prepare('INSERT INTO poc_items VALUES (?, ?)')
        .bind(String(i), `old-${i}`)
        .run()
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })
  const payload = () =>
    JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `new-${i}` })))

  it('view com INSTEAD OF, JSON, UPDATE FROM, CTE materializada e triggers aninhados funciona com recursão OFF', async () => {
    const [, accepted, revision] = await fixture.db.batch([
      fixture.db.prepare('PRAGMA recursive_triggers = OFF'),
      fixture.db
        .prepare(
          'UPDATE poc_command SET payload = ? WHERE id = 1 AND revision = ? RETURNING 1 AS accepted',
        )
        .bind(payload(), 0),
      fixture.db.prepare('SELECT revision FROM poc_meta'),
    ])
    expect(accepted.results).toEqual([{ accepted: 1 }])
    expect(revision.results).toEqual([{ revision: 8 }])
    const same = await fixture.db
      .prepare('UPDATE poc_command SET payload = ? WHERE revision = ? RETURNING 1 AS accepted')
      .bind(payload(), 8)
      .all()
    expect(same.results).toEqual([{ accepted: 1 }])
    expect(await fixture.db.prepare('SELECT revision FROM poc_meta').first('revision')).toBe(8)
    expect(await fixture.db.prepare('SELECT payload FROM poc_command').first('payload')).toBeNull()
  })

  it('falha no quinto UPDATE real reverte quatro anteriores, revisão e efeitos de trigger', async () => {
    await fixture.db.prepare('CREATE TABLE poc_events (id TEXT)').run()
    await fixture.db
      .prepare(
        'CREATE TRIGGER poc_event AFTER UPDATE ON poc_items BEGIN INSERT INTO poc_events VALUES (NEW.id); END',
      )
      .run()
    await fixture.db
      .prepare(
        "CREATE TRIGGER poc_fifth BEFORE UPDATE ON poc_items WHEN (SELECT COUNT(*) FROM poc_events) = 4 BEGIN SELECT RAISE(ABORT, 'fifth update failed'); END",
      )
      .run()
    await expect(
      fixture.db
        .prepare('UPDATE poc_command SET payload = ? WHERE revision = ? RETURNING 1 AS accepted')
        .bind(payload(), 0)
        .all(),
    ).rejects.toThrow()
    expect(await fixture.db.prepare('SELECT revision FROM poc_meta').first('revision')).toBe(0)
    expect(await fixture.db.prepare('SELECT COUNT(*) FROM poc_events').first('COUNT(*)')).toBe(0)
    expect(
      (await fixture.db.prepare('SELECT name FROM poc_items ORDER BY id').all()).results,
    ).toEqual(Array.from({ length: 8 }, (_, i) => ({ name: `old-${i}` })))
  })

  it('condição fechada na view não aciona trigger e não grava', async () => {
    const result = await fixture.db
      .prepare(
        'UPDATE poc_command SET payload = ? WHERE revision = ? AND 0 RETURNING 1 AS accepted',
      )
      .bind(payload(), 0)
      .all()
    expect(result.results).toEqual([])
    expect(result.meta.rows_written).toBe(0)
    expect(await fixture.db.prepare('SELECT revision FROM poc_meta').first('revision')).toBe(0)
  })
})
