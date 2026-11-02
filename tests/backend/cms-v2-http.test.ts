import { expect, it } from 'vitest'
import { conversion, cp3Fixture, draft, site } from './cms-v2-api-fixture'
import { executableSql, splitSql, sql9 } from './cms-v2-sql-fixture'

it('every partial migration preserves real HTTP v1 and returns schema unavailable for v2', async () => {
  const parts = splitSql(sql9()),
    ids = new Set<string>()
  for (let k = 0; k < parts.length; k++) {
    const f = await cp3Fixture({ baselineOnly: true })
    ids.add(f.instance)
    try {
      for (const p of parts.slice(0, k)) await f.db.prepare(executableSql(p)).run()
      const get = await f.call('GET', site)
      expect(get.status).toBe(200)
      expect((await get.json()).schema).toBe(1)
      const input = {
        ...f.base.second,
        operationId: crypto.randomUUID(),
        expectedRevision: f.base.last.command.revision,
      }
      const saved = await f.call('PUT', draft, input, input.expectedRevision)
      expect(saved.status).toBe(200)
      for (const action of ['previewConversion', 'convertToV2', 'startV2']) {
        const doc = structuredClone(f.document)
        doc.modules.splice(1, 0, {
          id: `module_${crypto.randomUUID()}`,
          template: 'carousel',
          visible: true,
          navigation: 'primary',
          content: { heading: 'B', lead: 'L', media: null, entries: [] },
        })
        const c = { ...f.intent(action), ...(action === 'startV2' ? { document: doc } : {}) }
        const r = await f.call('POST', conversion, c, c.expectedRevision)
        expect(r.status).toBe(503)
        expect((await r.json()).error.code).toBe('CMS_SCHEMA_UNAVAILABLE')
      }
      const v2 = {
        action: 'saveDraft',
        operationId: crypto.randomUUID(),
        expectedRevision: input.expectedRevision,
        document: f.document,
      }
      const r = await f.call('PUT', draft, v2, v2.expectedRevision)
      expect(r.status).toBe(503)
      expect((await r.json()).error.code).toBe('CMS_SCHEMA_UNAVAILABLE')
      expect(
        await (await f.call('GET', site + '/commands/' + f.base.first.operationId)).json(),
      ).toEqual(f.base.receipt)
    } finally {
      await f.close()
    }
  }
  expect(ids.size).toBe(parts.length)
}, 240000)
it('ready false preserves v1; v2 on a ready v1 head is schema mismatch, unknown versions are unsupported', async () => {
  const f = await cp3Fixture()
  try {
    const body = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: f.base.last.command.revision,
      document: f.document,
    }
    const r = await f.call('PUT', draft, body, body.expectedRevision)
    expect(r.status).toBe(409)
    expect((await r.json()).error.code).toBe('CMS_SCHEMA_MISMATCH')
    const unknown = await f.call(
      'PUT',
      draft,
      { ...body, document: { ...f.document, schemaVersion: 3 } },
      body.expectedRevision,
    )
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error.code).toBe('CMS_SCHEMA_UNSUPPORTED')
    const epoch = {
      ...f.base.second,
      operationId: crypto.randomUUID(),
      expectedRevision: `c2_${crypto.randomUUID()}`,
    }
    const e = await f.call('PUT', draft, epoch, epoch.expectedRevision)
    expect(e.status).toBe(409)
    expect((await e.json()).error.code).toBe('CMS_REVISION_CONFLICT')
    await f.db.prepare('DROP TRIGGER cms_v2_refs_insert_guard').run()
    const c = f.intent()
    expect((await f.call('POST', conversion, c, c.expectedRevision)).status).toBe(503)
    const old = {
      ...f.base.second,
      operationId: crypto.randomUUID(),
      expectedRevision: f.base.last.command.revision,
    }
    expect((await f.call('PUT', draft, old, old.expectedRevision)).status).toBe(200)
  } finally {
    await f.close()
  }
}, 30000)
it('If-Match, methods, strict conversion payload and publication stay protected', async () => {
  const f = await cp3Fixture()
  try {
    const c = f.intent()
    expect((await f.call('POST', conversion, c)).status).toBe(428)
    expect((await f.call('POST', conversion, c, undefined, { 'If-Match': 'W/"bad"' })).status).toBe(
      400,
    )
    expect(
      (await f.call('POST', conversion, { ...c, unexpected: true }, c.expectedRevision)).status,
    ).toBe(400)
    expect(
      (
        await f.call(
          'POST',
          conversion,
          { ...c, expectedRevision: `c1_${crypto.randomUUID()}` },
          c.expectedRevision,
        )
      ).status,
    ).toBe(400)
    const method = await f.call('GET', conversion)
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('POST')
    const publish = await f.call(
      'PUT',
      draft,
      { ...f.base.second, action: 'publish' },
      f.base.second.expectedRevision,
    )
    expect(publish.status).toBe(400)
    const oversized = await f.call(
      'POST',
      conversion,
      { ...c, padding: 'x'.repeat(70000) },
      c.expectedRevision,
    )
    expect(oversized.status).toBe(413)
  } finally {
    await f.close()
  }
}, 30000)
