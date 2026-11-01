import { expect, it } from 'vitest'
import { applyTestMigration } from './auth-fixture'
import { cmsFixture, seedCmsMedia } from './cms-fixture'
import { expansionFixture } from './expansion-fixture'

it('0006 é aditiva, cria só metadata e não altera schema nem dados do catálogo', async () => {
  const f = await expansionFixture()
  try {
    const tables = [
      'catalog_categories',
      'catalog_items',
      'catalog_variants',
      'catalog_meta',
      'products',
      'cachaca',
    ]
    const snapshot = async () => ({
      schema: (
        await f.db
          .prepare(
            "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'cms_%' AND tbl_name NOT LIKE 'cms_%' ORDER BY name",
          )
          .all()
      ).results,
      data: (
        await f.db.batch(tables.map((t) => f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`)))
      ).map((r) => r.results),
    })
    const before = await snapshot()
    await applyTestMigration(f.db, '0006_cms_foundation.sql')
    expect(await snapshot()).toEqual(before)
    for (const table of ['cms_versions', 'cms_media', 'cms_media_refs'])
      expect(await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0)
    expect(await f.db.prepare('SELECT COUNT(*) AS n FROM cms_state').first('n')).toBe(1)
    expect(await f.db.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] })
  } finally {
    await f.runtime.dispose()
  }
})
it('pós-condições recusam referência extra injetada e restauram todo o estado', async () => {
  const f = await cmsFixture()
  try {
    const a = `media_${crypto.randomUUID()}`,
      b = `media_${crypto.randomUUID()}`
    await seedCmsMedia(f.db, a)
    await seedCmsMedia(f.db, b)
    await f.db
      .prepare(
        `CREATE TRIGGER cms_test_extra_ref AFTER INSERT ON cms_media_refs WHEN NEW.media_id = '${a}' BEGIN INSERT INTO cms_media_refs VALUES(NEW.version_id,'${b}'); END`,
      )
      .run()
    const input = f.command()
    Object.assign(input.document.modules[0].content, { media: { id: a, alt: '' } })
    expect((await f.save(input)).response.status).toBe(503)
    expect(await f.count('cms_versions')).toBe(0)
    expect(await f.count('cms_media_refs')).toBe(0)
    expect(
      (
        await f.db
          .prepare('SELECT draft_revision FROM cms_state')
          .first<{ draft_revision: string }>()
      )?.draft_revision,
    ).toBe(input.expectedRevision)
  } finally {
    await f.runtime.dispose()
  }
})
it('guard ausente não permite gravar: ready é checado na leitura e mutação', async () => {
  const f = await cmsFixture()
  try {
    await f.db.prepare('DROP TRIGGER cms_versions_immutable_update').run()
    expect((await f.get()).status).toBe(503)
    expect((await f.save(f.command())).response.status).toBe(503)
    expect(await f.count('cms_versions')).toBe(0)
  } finally {
    await f.runtime.dispose()
  }
})
