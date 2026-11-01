import { expect, it } from 'vitest'
import { cmsV2Fixture } from './cms-v2-sql-fixture'

it('SQL blocks publishing and mutation/deletion of v2 versions, refs and state', async () => {
  const f = await cmsV2Fixture()
  try {
    await f.write(f.command())
    for (const sql of [
      "UPDATE cms_v2_versions SET kind='published'",
      'DELETE FROM cms_v2_versions',
      'UPDATE cms_v2_media_refs SET media_id=media_id',
      'DELETE FROM cms_v2_media_refs',
      'DELETE FROM cms_v2_state',
    ])
      await expect(f.db.prepare(sql).run()).rejects.toThrow()
    for (const table of ['cms_state', 'cms_v2_state'])
      await expect(
        f.db
          .prepare(
            `UPDATE ${table} SET published_version_id=draft_version_id,published_revision=draft_revision`,
          )
          .run(),
      ).rejects.toThrow()
    for (const table of ['cms_versions', 'cms_v2_versions']) {
      const cols = table === 'cms_versions' ? '' : ',origin_kind,source_version_id'
      const vals = table === 'cms_versions' ? '' : ",'save',NULL"
      await expect(
        f.db
          .prepare(
            `INSERT INTO ${table}(version_id,kind,operation_id,expected_revision,resulting_revision,document_json,command_hash,actor_id,created_at${cols}) SELECT 'version_'||?, 'published',?,expected_revision,?,document_json,command_hash,actor_id,created_at${vals} FROM ${table} LIMIT 1`,
          )
          .bind(
            crypto.randomUUID(),
            crypto.randomUUID(),
            `${table === 'cms_versions' ? 'c1' : 'c2'}_${crypto.randomUUID()}`,
          )
          .run(),
      ).rejects.toThrow()
    }
  } finally {
    await f.close()
  }
}, 30000)
