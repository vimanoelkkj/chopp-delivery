import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  applySql,
  cmsV2Fixture,
  executableSql,
  history,
  ready,
  splitSql,
  sql9,
} from './cms-v2-sql-fixture'

const schema = async (db: D1Database) =>
  (
    await db
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE name LIKE 'cms_v2_%' OR name IN ('cms_ready_v2','cms_versions_v2_namespace_supersession','cms_state_v2_supersession','cms_media_v2_referenced_guard') ORDER BY type,name",
      )
      .all()
  ).results
it('every independent prefix preserves actual v1 saves, receipts, refs, media and rejects incomplete v2', async () => {
  const parts = splitSql(sql9())
  expect(parts.length).toBeGreaterThan(10)
  expect(parts.join('')).toBe(sql9())
  expect(parts.at(-1)).toContain('CREATE VIEW cms_ready_v2')
  const seen = new Set<string>(),
    results = []
  for (let k = 0; k <= parts.length; k++) {
    const f = await cmsV2Fixture({ baselineOnly: true })
    seen.add(f.instance)
    try {
      for (const part of parts.slice(0, k)) await f.db.prepare(executableSql(part)).run()
      if (k === parts.length)
        await f.db.prepare("INSERT INTO d1_migrations VALUES('0009_cms_v2.sql')").run()
      const preserved = await f.repo.command(f.base.first.operationId)
      expect(preserved).toEqual(f.base.receipt)
      const { c, result } = await f.legacySave()
      expect(result.command.revision).toMatch(/^c1_/)
      expect(await f.repo.save(c)).toEqual(result)
      expect(await (await f.getReceipt(c.operationId)).json()).toEqual(result)
      expect(
        await f.db
          .prepare('SELECT document_json FROM cms_versions WHERE version_id=?')
          .bind(f.base.first.operationId ? f.base.receipt.command.versionId : '')
          .first('document_json'),
      ).toBe(
        JSON.parse(f.base.history)[0].find(
          (r: { version_id: string }) => r.version_id === f.base.receipt.command.versionId,
        ).document_json,
      )
      expect(
        (
          await f.db
            .prepare('SELECT media_id FROM cms_media_refs WHERE version_id=?')
            .bind(result.command.versionId)
            .all()
        ).results,
      ).toEqual([{ media_id: f.base.mediaId }])
      const prior = JSON.parse(f.base.history) as Record<string, unknown>[][],
        after = JSON.parse(await history(f.db)) as Record<string, unknown>[][]
      const ids = new Set(prior[0].map((row) => row.version_id))
      for (let i = 0; i < 2; i++)
        expect(after[i].filter((row) => ids.has(row.version_id))).toEqual(prior[i])
      await f.mediaCycle()
      expect(await f.repo.command(f.base.first.operationId)).toEqual(preserved)
      if (k < parts.length) {
        expect(await ready(f.db)).toBe(false)
        for (const origin of ['convert', 'start', 'save'])
          await expect(f.write(f.command(f.document, origin))).rejects.toThrow(
            'CMS_SCHEMA_UNAVAILABLE',
          )
        for (const table of ['cms_v2_versions', 'cms_v2_state', 'cms_v2_media_refs'])
          if (await f.db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').bind(table).first())
            expect(await f.db.prepare(`SELECT count(*) n FROM ${table}`).first('n')).toBe(0)
      } else {
        const c2 = f.command(f.document, 'convert', result.command.revision)
        c2.source = result.command.versionId
        await f.write(c2)
        await expect(f.legacySave()).rejects.toThrow('CMS_SCHEMA_SUPERSEDED')
      }
      results.push({
        prefix: k,
        v1Save: true,
        replay: true,
        oldReceipt: true,
        media: true,
        v2Ready: k === parts.length,
      })
    } finally {
      await f.close()
    }
  }
  expect(seen.size).toBe(parts.length + 1)
  const a = await cmsV2Fixture({ baselineOnly: true }),
    b = await cmsV2Fixture({ baselineOnly: true })
  try {
    await a.db.batch(parts.map((p) => a.db.prepare(executableSql(p))))
    await applySql(b.db, sql9())
    expect(await schema(a.db)).toEqual(await schema(b.db))
  } finally {
    await a.close()
    await b.close()
  }
  const folder = mkdtempSync(join(tmpdir(), 'chopp-cp2-prefix-evidence-'))
  writeFileSync(join(folder, '.owner'), 'cp2-prefix-evidence')
  writeFileSync(join(folder, 'results.json'), JSON.stringify(results, null, 2))
  console.log('CP2 prefix evidence', folder, results.length)
}, 240000)
it('negative control: legacy trigger before referenced tables is detected by a real v1 save', async () => {
  const parts = splitSql(sql9()),
    unsafe = parts.find((p) => p.includes('CREATE TRIGGER cms_versions_v2_namespace_supersession'))!
  const folder = mkdtempSync(join(tmpdir(), 'chopp-cp2-negative-'))
  writeFileSync(join(folder, '.owner'), 'cp2-negative')
  writeFileSync(join(folder, 'unsafe.sql'), unsafe + parts.filter((p) => p !== unsafe).join(''))
  const f = await cmsV2Fixture({ baselineOnly: true })
  try {
    await f.db
      .prepare(
        executableSql(readFileSync(join(folder, 'unsafe.sql'), 'utf8').slice(0, unsafe.length)),
      )
      .run()
    await expect(f.legacySave()).rejects.toThrow(/no such table.*cms_v2_/)
  } finally {
    await f.close()
  }
}, 30000)
