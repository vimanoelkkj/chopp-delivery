import { expect, it } from 'vitest'
import { cmsV2Fixture, history } from './cms-v2-sql-fixture'

it('upgrade preserves byte-identical history, v1 saves/replays, then supersedes only new writes', async () => {
  const f = await cmsV2Fixture()
  try {
    expect(await history(f.db)).toBe(f.base.history)
    expect(await f.repo.command(f.base.first.operationId)).toEqual(f.base.receipt)
    expect(await f.repo.save(f.base.first)).toEqual(f.base.receipt)
    const { c, result } = await f.legacySave()
    expect(result.command.revision).toMatch(/^c1_/)
    expect(await f.repo.save(c)).toEqual(result)
    expect(await (await f.getReceipt(c.operationId)).json()).toEqual(result)
    const command = f.command(f.document, 'convert', result.command.revision)
    command.source = result.command.versionId
    await f.write(command)
    expect(await f.repo.save(c)).toEqual(result)
    await expect(f.legacySave()).rejects.toThrow(/CMS_SCHEMA_SUPERSEDED/)
    expect(await f.repo.command(f.base.first.operationId)).toEqual(f.base.receipt)
    const before = JSON.parse(f.base.history) as Record<string, unknown>[][]
    const after = JSON.parse(await history(f.db)) as Record<string, unknown>[][]
    const ids = new Set(before[0].map((row) => row.version_id))
    for (let i = 0; i < 2; i++)
      expect(after[i].filter((row) => ids.has(row.version_id))).toEqual(before[i])
  } finally {
    await f.close()
  }
}, 30000)
it('expired or revoked session aborts the entire conversion', async () => {
  const f = await cmsV2Fixture()
  try {
    await f.db.prepare('DELETE FROM admin_sessions').run()
    await expect(f.write(f.command())).rejects.toThrow(/CMS_UNAUTHORIZED/)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(0)
  } finally {
    await f.close()
  }
}, 30000)
