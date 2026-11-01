import { expect, it } from 'vitest'
import { applySql, cmsV2Fixture, ready, splitSql, sql9 } from './cms-v2-sql-fixture'

it('0009 creates a ready empty v2 with preserved v1 and unchanged catalog', async () => {
  const f = await cmsV2Fixture()
  try {
    expect(sql9()).toContain('CREATE TABLE cms_v2_versions')
    expect(await ready(f.db)).toBe(true)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_state').first('n')).toBe(0)
    expect((await f.repo.load()).draft.document).toEqual(f.base.last.site.draft.document)
    expect((await f.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  } finally {
    await f.close()
  }
}, 30000)
it('Wrangler splitter preserves comments, quotes, CASE END and trigger bodies', async () => {
  const sql =
    "-- BEGIN; END\nCREATE TABLE t(a TEXT);CREATE TRIGGER x AFTER INSERT ON t BEGIN SELECT CASE WHEN NEW.a='END;''x' THEN 1 END; END;-- tail"
  expect(splitSql(sql).join('')).toBe(sql)
  expect(splitSql(sql)).toHaveLength(2)
  const f = await cmsV2Fixture({ baselineOnly: true })
  try {
    await applySql(f.db, sql)
    expect(
      await f.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='x'").first('n'),
    ).toBe(1)
  } finally {
    await f.close()
  }
}, 30000)

it('readiness fails closed if a named guard is absent, while the legacy CMS still saves', async () => {
  const f = await cmsV2Fixture()
  try {
    await f.db.prepare('DROP TRIGGER cms_v2_refs_insert_guard').run()
    expect(await ready(f.db)).toBe(false)
    expect((await f.legacySave()).result.command.revision).toMatch(/^c1_/)
    await expect(f.write(f.command())).rejects.toThrow('CMS_SCHEMA_UNAVAILABLE')
  } finally {
    await f.close()
  }
}, 30000)
it('start requires an actually empty v1 CMS and visible carousel; SQL numbers 2.0 are real', async () => {
  const f = await cmsV2Fixture({ empty: true })
  try {
    expect((await f.repo.load()).draft.document).toBeNull()
    const revision = (await f.repo.load()).draft.revision,
      doc = structuredClone(f.document)
    await expect(f.write(f.command(doc, 'start', revision))).rejects.toThrow('CMS_DOCUMENT_INVALID')
    doc.modules.splice(1, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'carousel',
      visible: true,
      navigation: 'primary',
      content: { heading: 'B', lead: 'L', media: null, entries: [] },
    })
    const c = f.command(doc, 'start', revision)
    await f.write(c)
    expect(
      await f.db.prepare('SELECT draft_revision FROM cms_v2_state').first('draft_revision'),
    ).toBe(c.resulting)
    expect(
      await f.db
        .prepare("SELECT json_type(?,'$.schemaVersion') t")
        .bind('{"schemaVersion":2.0}')
        .first('t'),
    ).toBe('real')
  } finally {
    await f.close()
  }
}, 30000)

it('direct SQL cannot smuggle commercial media fields or invalid optional IDs/navigation', async () => {
  const f = await cmsV2Fixture()
  try {
    const doc = structuredClone(f.document)
    doc.modules.splice(1, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'carousel',
      visible: true,
      navigation: 'primary',
      content: { heading: 'B', lead: 'L', media: null, entries: [] },
    })
    const changes = [
      (d: typeof doc) =>
        Object.assign(d.modules[0].content, { media: { id: f.base.mediaId, alt: 'A', price: 1 } }),
      (d: typeof doc) => {
        d.modules[1].id = 'module_invalid'
      },
      (d: typeof doc) => {
        d.modules[1].navigation = 'cta'
      },
    ]
    for (const change of changes) {
      const d = structuredClone(doc)
      change(d)
      await expect(f.write(f.command(d))).rejects.toThrow()
    }
  } finally {
    await f.close()
  }
}, 30000)
