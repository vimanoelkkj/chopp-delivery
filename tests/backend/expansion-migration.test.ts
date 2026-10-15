import { expect, it } from 'vitest'
import { applyTestMigration, authFixture } from './auth-fixture'

it('0005 copia os registros editados, preserva null/ordem/volume e congela escritores antigos', async () => {
  const f = await authFixture()
  try {
    await f.db
      .prepare('UPDATE products SET price_30_cents=?, visible=?, sort_order=? WHERE id=?')
      .bind(29, 0, 40, 'dronken')
      .run()
    await f.db.prepare('UPDATE cachaca SET bottle_ml=?, price_cents=?').bind(750, 49099).run()
    const before = await f.db.prepare('SELECT revision FROM catalog_meta').first('revision')
    await applyTestMigration(f.db, '0005_catalog_expansion.sql')
    expect(
      await f.db
        .prepare('SELECT id,visible,sort_order FROM catalog_items WHERE id=?')
        .bind('dronken')
        .first(),
    ).toEqual({ id: 'dronken', visible: 0, sort_order: 40 })
    expect(
      await f.db
        .prepare('SELECT price_cents FROM catalog_variants WHERE item_id=? AND code=?')
        .bind('dronken', '30')
        .first('price_cents'),
    ).toBe(29)
    expect(
      await f.db
        .prepare('SELECT price_cents FROM catalog_variants WHERE item_id=? AND code=?')
        .bind('brahma', '30')
        .first('price_cents'),
    ).toBeNull()
    expect(
      await f.db
        .prepare('SELECT volume_ml,price_cents FROM catalog_variants WHERE item_id=?')
        .bind('cachaca')
        .first(),
    ).toEqual({ volume_ml: 750, price_cents: 49099 })
    expect(await f.db.prepare('SELECT revision FROM catalog_meta').first('revision')).toBe(
      Number(before) + 1,
    )
    expect((await f.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    await expect(f.db.prepare("UPDATE products SET name='proibido'").run()).rejects.toThrow(
      'CATALOG_LEGACY_READ_ONLY',
    )
    await expect(f.db.prepare('UPDATE cachaca SET price_cents=1').run()).rejects.toThrow(
      'CATALOG_LEGACY_READ_ONLY',
    )
    await expect(f.db.prepare("UPDATE catalog_save SET payload='{}'").run()).rejects.toThrow()
  } finally {
    await f.runtime.dispose()
  }
})
