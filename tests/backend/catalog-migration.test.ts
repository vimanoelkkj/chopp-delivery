import { expect, it } from 'vitest'
import { applyTestMigration, authFixture, seedOwner } from './auth-fixture'

it('0004 preserva dados previamente editados e autenticação ao ser aplicada pela primeira vez', async () => {
  const fixture = await authFixture(false)
  try {
    await seedOwner(fixture.db)
    await fixture.db
      .prepare(
        'UPDATE products SET name = ?, price_30_cents = ?, visible = ?, sort_order = ? WHERE id = ?',
      )
      .bind('Nome administrativo preservado', 49099, 0, 40, 'dronken')
      .run()
    await fixture.db.prepare('UPDATE cachaca SET price_cents = ?, visible = ?').bind(3001, 0).run()
    const existing = () =>
      fixture.db
        .batch([
          fixture.db.prepare('SELECT * FROM products ORDER BY id'),
          fixture.db.prepare('SELECT * FROM cachaca'),
          fixture.db.prepare('SELECT * FROM admin_users'),
        ])
        .then((results) => results.map((r) => r.results))
    const before = await existing()
    await applyTestMigration(fixture.db, '0004_catalog_revision.sql')
    expect(await existing()).toEqual(before)
    expect(await fixture.db.prepare('SELECT revision FROM catalog_meta').first('revision')).toBe(0)
  } finally {
    await fixture.runtime.dispose()
  }
})
