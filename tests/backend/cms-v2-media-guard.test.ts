import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { handleLocalMedia } from '../../server/cms/media-library'
import { collectMediaRefs } from '../../server/cms/media-refs'
import { parseCmsDocument } from '../../server/cms/validation-v2'
import { TEST_ORIGIN } from './auth-fixture'
import { applySql, cmsV2Fixture, sql9 } from './cms-v2-sql-fixture'

it('300 seeded differential documents match TS/SQL structure, refs and item/category checks', async () => {
  const f = await cmsV2Fixture()
  try {
    let revision = f.base.last.command.revision,
      seed = 0x12345678
    for (let i = 0; i < 300; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const doc = structuredClone(f.document)
      doc.modules.splice(1, 0, {
        id: `module_${crypto.randomUUID()}`,
        template: 'carousel',
        visible: !!(seed % 2),
        navigation: 'primary',
        content: {
          heading: 'B',
          lead: 'L',
          media: seed % 3 ? { id: f.base.mediaId, alt: 'A' } : null,
          entries: [
            { itemId: 'dronken', media: seed % 4 ? { id: f.base.mediaId, alt: 'A' } : null },
          ],
        },
      })
      const c = f.command(doc, i === 0 ? 'convert' : 'save', revision)
      expect(parseCmsDocument(doc).value).toEqual(doc)
      await f.write(c)
      revision = c.resulting
      const refs = (
        await f.db
          .prepare('SELECT media_id FROM cms_v2_media_refs WHERE version_id=? ORDER BY media_id')
          .bind(c.version)
          .all<{ media_id: string }>()
      ).results.map((r) => r.media_id)
      expect(refs).toEqual(collectMediaRefs(doc))
      const bad = structuredClone(doc)
      bad.modules.reverse()
      expect(parseCmsDocument(bad).fields).toBeDefined()
      await expect(f.write(f.command(bad, 'save', revision))).rejects.toThrow()
    }
    expect(
      await f.db.prepare("SELECT id FROM catalog_categories WHERE id='chopes'").first('id'),
    ).toBe('chopes')
    expect(
      (await f.db.prepare("SELECT value FROM json_each('{}','$.entries')").all()).results,
    ).toEqual([])
  } finally {
    await f.close()
  }
}, 60000)
it('entry-only media protects historical references, rejects absent/non-chopes item and unavailable media', async () => {
  const f = await cmsV2Fixture()
  try {
    const doc = structuredClone(f.document)
    Object.assign(doc.modules[0].content, { media: null })
    const id = `media_${crypto.randomUUID()}`
    await f.db
      .prepare('INSERT INTO cms_media(media_id,state,created_at) VALUES(?,?,?)')
      .bind(id, 'quarantined', Date.now())
      .run()
    const carousel = {
      id: `module_${crypto.randomUUID()}`,
      template: 'carousel' as const,
      visible: true,
      navigation: 'primary' as const,
      content: {
        heading: '',
        lead: '',
        media: null,
        entries: [{ itemId: 'cachaca', media: { id, alt: '' } }],
      },
    }
    doc.modules.splice(1, 0, carousel)
    await expect(f.write(f.command(doc))).rejects.toThrow(/CMS_INVALID_ITEM/)
    carousel.content.entries[0].itemId = 'absent'
    await expect(f.write(f.command(doc))).rejects.toThrow(/CMS_INVALID_ITEM/)
    carousel.content.entries[0].itemId = 'dronken'
    const c = f.command(doc)
    await f.write(c)
    await expect(
      f.db.batch([
        f.db
          .prepare("INSERT INTO cms_media_write_guard VALUES(1,?,?,'test')")
          .bind(crypto.randomUUID(), id),
        f.db.prepare("UPDATE cms_media SET state='deleted' WHERE media_id=?").bind(id),
      ]),
    ).rejects.toThrow(/CMS_MEDIA_REFERENCED/)
    const absent = structuredClone(doc)
    Object.assign((absent.modules[1].content as typeof carousel.content).entries[0].media, {
      id: `media_${crypto.randomUUID()}`,
    })
    await expect(f.write(f.command(absent, 'save', c.resulting))).rejects.toThrow(
      /CMS_MEDIA_UNAVAILABLE/,
    )
  } finally {
    await f.close()
  }
}, 30000)

it('catalog snapshot unchanged by migration and editorial writes; category is the seeded stable ID', async () => {
  const f = await cmsV2Fixture({ baselineOnly: true })
  try {
    const snapshot = async () =>
      JSON.stringify(
        (
          await f.db.batch(
            [
              'catalog_meta',
              'catalog_categories',
              'catalog_items',
              'catalog_variants',
              'products',
              'cachaca',
            ].map((t) => f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`)),
          )
        ).map((r) => r.results),
      )
    const before = await snapshot()
    await applySql(f.db, sql9())
    await f.db.prepare("INSERT INTO d1_migrations VALUES('0009_cms_v2.sql')").run()
    await f.write(f.command())
    expect(await snapshot()).toBe(before)
    expect(readFileSync('migrations/0005_catalog_expansion.sql', 'utf8')).toContain("('chopes',")
  } finally {
    await f.close()
  }
}, 30000)
it('the 100-media limit includes deleted tombstones for the lifetime of the library', async () => {
  const f = await cmsV2Fixture()
  try {
    const n = Number(await f.db.prepare('SELECT count(*) n FROM cms_media').first('n'))
    await f.db.batch(
      Array.from({ length: 100 - n }, () =>
        f.db
          .prepare("INSERT INTO cms_media(media_id,state,created_at) VALUES(?,'deleted',?)")
          .bind(`media_${crypto.randomUUID()}`, Date.now()),
      ),
    )
    const op = crypto.randomUUID()
    await expect(
      f.db
        .prepare(
          "UPDATE cms_media_start SET operation_id=?,action='upload',media_id=?,actor_id=?,session_hash=?,origin=?,expected_revision='*' WHERE singleton=1",
        )
        .bind(
          op,
          `media_${op}`,
          f.auth.principal.user.id,
          f.auth.principal.sessionHash,
          f.auth.config.origin,
        )
        .run(),
    ).rejects.toThrow('MEDIA_QUOTA')
    expect(await f.db.prepare('SELECT count(*) n FROM cms_media').first('n')).toBe(100)
  } finally {
    await f.close()
  }
}, 30000)
it('concurrent editorial reference and media delete cannot leave a dangling version', async () => {
  const f = await cmsV2Fixture()
  try {
    const op = crypto.randomUUID(),
      id = `media_${op}`,
      headers = {
        Cookie: f.base.cookie,
        Origin: TEST_ORIGIN,
        'X-Operation-Id': op,
        'If-None-Match': '*',
        'Content-Type': 'image/png',
      }
    expect(
      (
        await handleLocalMedia(
          new Request(`${TEST_ORIGIN}/api/admin/media`, {
            method: 'POST',
            headers,
            body: f.base.png,
          }),
          f.env,
        )
      ).status,
    ).toBe(200)
    const revision = await f.db
      .prepare('SELECT revision FROM cms_media WHERE media_id=?')
      .bind(id)
      .first<string>('revision')
    const doc = structuredClone(f.document)
    Object.assign(doc.modules[0].content, { media: { id, alt: 'race' } })
    const c = f.command(doc),
      results = await Promise.allSettled([
        f.write(c),
        handleLocalMedia(
          new Request(`${TEST_ORIGIN}/api/admin/media/${id}`, {
            method: 'DELETE',
            headers: {
              Cookie: f.base.cookie,
              Origin: TEST_ORIGIN,
              'X-Operation-Id': crypto.randomUUID(),
              'If-Match': `"${revision}"`,
            },
          }),
          f.env,
          id,
        ),
      ])
    const write = results[0],
      del = results[1]
    expect(del.status).toBe('fulfilled')
    if (del.status === 'fulfilled' && del.value.status === 200)
      expect(write.status).toBe('rejected')
    else {
      expect(write.status).toBe('fulfilled')
      if (del.status === 'fulfilled') expect(del.value.status).toBe(409)
    }
    expect(
      (
        await f.db
          .prepare(
            "SELECT r.media_id FROM cms_v2_media_refs r JOIN cms_media m USING(media_id) WHERE m.state IN ('deleting','deleted')",
          )
          .all()
      ).results,
    ).toEqual([])
  } finally {
    await f.close()
  }
}, 30000)
