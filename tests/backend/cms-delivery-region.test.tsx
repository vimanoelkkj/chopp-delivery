/// <reference types="vite/client" />
import { existsSync, readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { deriveLayout } from '../../shared/cms/layout'
import { parseCmsDocument } from '../../shared/cms/validation-v2'
import { readPreviewSnapshot } from '../../src/features/admin/preview/model'
import { PreviewRenderer } from '../../src/features/admin/preview/PreviewRenderer'
import { kindOf, readField, setField } from '../../src/features/admin/site/editModel'
import { describeSection } from '../../src/features/admin/site/siteModel'
import { SiteHeader } from '../../src/pages/landing/sections/SiteHeader'
import { cmsDocument } from './cms-document-fixture'
import { cp3Fixture, draft, site } from './cms-v2-api-fixture'
import { v2 } from './cms-v2-fixture'
import { applySql, executableSql, splitSql } from './cms-v2-sql-fixture'

const region = 'Tiradentes e arredores'
const hero = (doc: ReturnType<typeof v2>) => {
  const module = doc.modules.find((m) => m.template === 'hero')
  if (!module) throw new Error('Missing hero')
  return module
}
const sqlPath = 'migrations/0011_cms_delivery_region.sql'

it('edits an optional region in old v2 documents without changing commercial data', () => {
  const doc = v2(),
    before = structuredClone(doc)
  expect(readField(hero(doc), 'deliveryRegion')).toBe('S\u00e3o Jo\u00e3o del-Rei e regi\u00e3o')
  const changed = setField(doc, 'hero', 'deliveryRegion', region)
  expect(readField(hero(changed), 'deliveryRegion')).toBe(region)
  expect(kindOf('deliveryRegion')).toBe('heading')
  expect(changed.commercial).toEqual(doc.commercial)
  expect(doc).toEqual(before)
  expect(parseCmsDocument(changed).value).toEqual(changed)
  const row = describeSection(changed, deriveLayout(changed), 'hero')?.content.find(
    (r) => r.key === 'deliveryRegion',
  )
  expect(row).toMatchObject({ status: 'editable', value: region })
})

it.each([null, 42, {}, 'x'.repeat(121), 'area\nextra', '<script>', 'https://example.com'])(
  'rejects invalid delivery-region text: %j',
  (value) => {
    const doc = v2()
    Object.assign(hero(doc).content, { deliveryRegion: value })
    expect(parseCmsDocument(doc).value).toBeUndefined()
  },
)

it('keeps v1 strict and the public header unchanged while the preview uses the saved region', () => {
  const old = cmsDocument()
  Object.assign(old.modules[0].content, { deliveryRegion: region })
  expect(parseCmsDocument(old).value).toBeUndefined()
  const doc = v2()
  Object.assign(hero(doc).content, { deliveryRegion: region })
  const value = readPreviewSnapshot({
    schema: 2,
    draft: { revision: 'c2_12345678-1234-4123-8123-123456789012', document: doc },
    published: null,
  })
  expect(value).not.toBeNull()
  if (!value) throw new Error('Missing preview')
  const preview = renderToStaticMarkup(
    <PreviewRenderer value={value} catalog={{ status: 'loading' }} retry={() => {}} />,
  )
  expect(preview).toContain(`Entrega e instala\u00e7\u00e3o em ${region}`)
  const publicHeader = renderToStaticMarkup(<SiteHeader />)
  expect(publicHeader).toContain('S\u00e3o Jo\u00e3o del-Rei e regi\u00e3o')
  expect(publicHeader).not.toContain(region)
})

it('persists the region through the real authenticated draft API and immutable history, without publication', async () => {
  const f = await cp3Fixture()
  try {
    const converted = await f.convert()
    expect(converted.response.status).toBe(200)
    const initial = converted.result
    const historyBefore = (
      await f.db
        .prepare('SELECT version_id,document_json FROM cms_v2_versions ORDER BY version_id')
        .all()
    ).results
    if (existsSync(sqlPath)) {
      const parts = splitSql(readFileSync(sqlPath, 'utf8'))
      expect(parts).toHaveLength(4)
      const original = splitSql(readFileSync('migrations/0009_cms_v2.sql', 'utf8')).find((part) =>
        part.includes('CREATE TRIGGER cms_v2_versions_insert_guard'),
      )
      if (!original) throw new Error('Missing original guard')
      const otherRules = (sql: string) =>
        executableSql(sql)
          .split('\n')
          .filter((line) => !line.includes("='hero' AND ((SELECT count(*)"))
          .join('\n')
          .replace(/\s+/g, ' ')
          .trim()
      expect(otherRules(parts[2])).toBe(otherRules(original))
      await f.db.prepare(executableSql(parts[0])).run()
      await expect(
        f.write(f.command(initial.site.draft.document, 'save', initial.command.revision)),
      ).rejects.toThrow('CMS_SCHEMA_UNAVAILABLE')
      await applySql(f.db, parts.slice(1).join(''))
    }
    const doc = setField(initial.site.draft.document, 'hero', 'deliveryRegion', region)
    const command = {
      action: 'saveDraft',
      expectedRevision: initial.command.revision,
      operationId: crypto.randomUUID(),
      document: doc,
    }
    const response = await f.call('PUT', draft, command, command.expectedRevision)
    expect(response.status).toBe(200)
    const saved = await response.json()
    const reloaded = await (await f.call('GET', site)).json()
    expect(readField(hero(reloaded.draft.document), 'deliveryRegion')).toBe(region)
    expect(reloaded.published).toBeNull()
    const preview = readPreviewSnapshot(reloaded)
    if (!preview) throw new Error('Missing saved preview')
    expect(
      renderToStaticMarkup(
        <PreviewRenderer value={preview} catalog={{ status: 'loading' }} retry={() => {}} />,
      ),
    ).toContain(region)
    expect((await f.call('GET', `${site}/commands/${command.operationId}`)).status).toBe(200)
    const prior = (
      await f.db
        .prepare('SELECT version_id,document_json FROM cms_v2_versions WHERE version_id=?')
        .bind(initial.command.versionId)
        .all()
    ).results
    expect(prior).toEqual(historyBefore)
    expect(saved.site.draft.document.commercial).toEqual(initial.site.draft.document.commercial)
    for (const badValue of [null, 42, 'x'.repeat(121), 'area\nextra']) {
      const invalid = structuredClone(doc)
      Object.assign(hero(invalid).content, { deliveryRegion: badValue })
      await expect(f.write(f.command(invalid, 'save', saved.command.revision))).rejects.toThrow(
        'CMS_DOCUMENT_INVALID',
      )
    }
    for (const change of ['missing_heading', 'commercial_key']) {
      const invalid = structuredClone(doc)
      const content = hero(invalid).content as unknown as Record<string, unknown>
      if (change === 'missing_heading') delete content.heading
      else content.priceCents = 500
      await expect(f.write(f.command(invalid, 'save', saved.command.revision))).rejects.toThrow(
        'CMS_DOCUMENT_INVALID',
      )
    }
    expect(await f.db.prepare('SELECT count(*) AS n FROM cms_v2_write_guard').first('n')).toBe(0)
    expect((await f.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  } finally {
    await f.close()
  }
}, 30000)
