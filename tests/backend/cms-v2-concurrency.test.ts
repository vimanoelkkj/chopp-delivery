import { expect, it } from 'vitest'
import { cmsV2Fixture } from './cms-v2-sql-fixture'

it('single winner on conversion/revision, idempotent immutable receipts and operation conflicts', async () => {
  const f = await cmsV2Fixture()
  try {
    const a = f.command(),
      b = f.command()
    const results = await Promise.allSettled([f.write(a), f.write(b)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const winner = results[0].status === 'fulfilled' ? a : b,
      receipt = await f.write(winner)
    expect(await f.write(winner)).toEqual(receipt)
    await expect(f.write({ ...winner, hash: 'b'.repeat(64) })).rejects.toThrow(
      /CMS_OPERATION_CONFLICT/,
    )
    await expect(f.write({ ...winner, document: winner.document + ' ' })).rejects.toThrow(
      /CMS_OPERATION_CONFLICT/,
    )
    const save = f.command(f.document, 'save', winner.resulting),
      other = f.command(f.document, 'save', winner.resulting)
    const saves = await Promise.allSettled([f.write(save), f.write(other)])
    expect(saves.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await f.write(winner)).toEqual(receipt)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(2)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_write_guard').first('n')).toBe(0)
    await expect(f.write({ ...f.command(), operation: f.base.first.operationId })).rejects.toThrow(
      /CMS_OPERATION_CONFLICT/,
    )
  } finally {
    await f.close()
  }
}, 30000)
for (const effect of [
  'SELECT RAISE(IGNORE)',
  "SELECT RAISE(ABORT,'injected')",
  'DELETE FROM admin_sessions',
])
  it(`atomic rollback on state trigger: ${effect}`, async () => {
    const f = await cmsV2Fixture()
    try {
      await f.db
        .prepare(`CREATE TRIGGER injected BEFORE INSERT ON cms_v2_state BEGIN ${effect}; END`)
        .run()
      await expect(f.write(f.command())).rejects.toThrow()
      for (const table of [
        'cms_v2_versions',
        'cms_v2_state',
        'cms_v2_media_refs',
        'cms_v2_write_guard',
      ])
        expect(await f.db.prepare(`SELECT count(*) n FROM ${table}`).first('n')).toBe(0)
      expect(await f.db.prepare('SELECT count(*) n FROM admin_sessions').first('n')).toBe(1)
    } finally {
      await f.close()
    }
  }, 30000)

for (const mode of ['missing', 'extra'])
  it(`atomic reference postconditions reject ${mode} rows`, async () => {
    const f = await cmsV2Fixture()
    try {
      if (mode === 'missing')
        await f.db
          .prepare(
            'CREATE TRIGGER injected_ref BEFORE INSERT ON cms_v2_media_refs BEGIN SELECT RAISE(IGNORE); END',
          )
          .run()
      else {
        const extra = `media_${crypto.randomUUID()}`
        await f.db
          .prepare("INSERT INTO cms_media(media_id,state,created_at) VALUES(?,'quarantined',?)")
          .bind(extra, Date.now())
          .run()
        await f.db
          .prepare(
            `CREATE TRIGGER injected_ref AFTER INSERT ON cms_v2_media_refs WHEN NEW.media_id='${f.base.mediaId}' BEGIN INSERT INTO cms_v2_media_refs VALUES(NEW.version_id,'${extra}'); END`,
          )
          .run()
      }
      await expect(f.write(f.command())).rejects.toThrow('CMS_WRITE_INCOMPLETE')
      for (const table of [
        'cms_v2_versions',
        'cms_v2_state',
        'cms_v2_media_refs',
        'cms_v2_write_guard',
      ])
        expect(await f.db.prepare(`SELECT count(*) n FROM ${table}`).first('n')).toBe(0)
    } finally {
      await f.close()
    }
  }, 30000)
