import { expect, it } from 'vitest'
import { applyTestMigration } from './auth-fixture'
import { cmsFixture, seedCmsMedia } from './cms-fixture'

it('0007 preserves 0006 draft history, media, references and publication lock', async () => {
  const f = await cmsFixture()
  try {
    const id = `media_${crypto.randomUUID()}`
    await seedCmsMedia(f.db, id)
    const cmd = f.command(),
      hero = cmd.document.modules.find((m) => m.template === 'hero')
    if (hero?.template !== 'hero') throw Error('fixture')
    hero.content.media = { id, alt: 'existing' }
    expect((await f.save(cmd)).response.status).toBe(200)
    const before = await (await f.get()).json(),
      catalog = await f.catalog()
    await applyTestMigration(f.db, '0007_cms_media_local.sql')
    expect(await (await f.get()).json()).toEqual(before)
    expect(await f.catalog()).toBe(catalog)
    expect(await f.count('cms_versions')).toBe(1)
    expect(await f.count('cms_media_refs')).toBe(1)
    expect(
      await f.db.prepare('SELECT state,revision FROM cms_media WHERE media_id=?').bind(id).first(),
    ).toEqual({ state: 'quarantined', revision: 'm0' })
    expect(
      (await f.db.prepare('SELECT published_version_id FROM cms_state').first())
        ?.published_version_id,
    ).toBeNull()
  } finally {
    await f.runtime.dispose()
  }
})
