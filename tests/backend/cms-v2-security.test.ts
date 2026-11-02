import { expect, it } from 'vitest'
import { handleLocalMedia } from '../../server/cms/media-library'
import { TEST_ORIGIN } from './auth-fixture'
import { conversion, cp3Fixture, draft, site } from './cms-v2-api-fixture'
import { history } from './cms-v2-sql-fixture'

it('authentication and CSRF fail before mutation and expose no private fields', async () => {
  const f = await cp3Fixture()
  try {
    const c = f.intent(),
      before = await history(f.db)
    for (const [headers, status] of [
      [{ Cookie: '' }, 401],
      [{ Origin: 'https://evil.invalid' }, 403],
      [{ Origin: '', 'Sec-Fetch-Site': 'cross-site' }, 403],
    ] as const) {
      const r = await f.call('POST', conversion, c, c.expectedRevision, headers)
      expect(r.status).toBe(status)
      expect(await r.text()).not.toMatch(/session_hash|objectKey|manifest|actor_id/)
    }
    expect(await history(f.db)).toBe(before)
  } finally {
    await f.close()
  }
}, 30000)
for (const effect of ['revoked', 'ignored', 'lost', 'tampered'])
  it(`finalization ${effect} cannot report false success or duplicate effects`, async () => {
    const f = await cp3Fixture()
    try {
      let armed = false
      const db = new Proxy(f.db, {
        get(target, key, receiver) {
          if (key === 'prepare')
            return (sql: string) => {
              if (sql.includes('UPDATE cms_v2_write')) armed = true
              return target.prepare(sql)
            }
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              const write = armed
              armed = false
              if (write && effect === 'revoked')
                await target.prepare('DELETE FROM admin_sessions').run()
              const result = await target.batch(statements)
              if (write && effect === 'lost') throw Error('response lost after commit')
              if (write && effect === 'tampered') {
                for (const r of result)
                  for (const row of r.results as Record<string, unknown>[])
                    if (typeof row.document_json === 'string') {
                      const doc = JSON.parse(row.document_json)
                      doc.modules[0].content.heading = 'tampered'
                      row.document_json = JSON.stringify(doc)
                    }
              }
              return result
            }
          return Reflect.get(target, key, receiver)
        },
      })
      if (effect === 'ignored')
        await f.db
          .prepare(
            'CREATE TRIGGER cp3_ignore BEFORE INSERT ON cms_v2_state BEGIN SELECT RAISE(IGNORE); END',
          )
          .run()
      const c = f.intent(),
        response = await f.call(
          'POST',
          conversion,
          c,
          c.expectedRevision,
          {},
          { ...f.env, DELEGAS_DB: db },
        )
      expect(response.status).toBe(effect === 'revoked' ? 401 : 503)
      expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(
        ['lost', 'tampered'].includes(effect) ? 1 : 0,
      )
      if (effect === 'lost') {
        const replay = await f.call('POST', conversion, c, c.expectedRevision)
        expect(replay.status).toBe(200)
        const result = await replay.json()
        expect(await (await f.call('GET', site + '/commands/' + c.operationId)).json()).toEqual(
          result,
        )
        expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(1)
      }
    } finally {
      await f.close()
    }
  }, 30000)
it('session revocation inside SQL rolls back conversion and its injected changes', async () => {
  const f = await cp3Fixture()
  try {
    await f.db
      .prepare(
        'CREATE TRIGGER cp3_revoke BEFORE INSERT ON cms_v2_state BEGIN DELETE FROM admin_sessions; END',
      )
      .run()
    const c = f.intent()
    expect((await f.call('POST', conversion, c, c.expectedRevision)).status).toBe(401)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(0)
    expect(await f.db.prepare('SELECT count(*) n FROM admin_sessions').first('n')).toBe(1)
  } finally {
    await f.close()
  }
}, 30000)
it('item and media errors map safely; read-only orphan/hidden/media warnings preserve references', async () => {
  const f = await cp3Fixture()
  try {
    const converted = await f.convert()
    expect(converted.response.status).toBe(200)
    const doc = structuredClone(converted.result.site.draft.document)
    doc.modules.splice(1, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'carousel',
      visible: true,
      navigation: 'primary',
      content: {
        heading: 'B',
        lead: 'L',
        media: null,
        entries: [{ itemId: 'absent', media: null }],
      },
    })
    const input = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: converted.result.command.revision,
      document: doc,
    }
    const missing = await f.call('PUT', draft, input, input.expectedRevision)
    expect(missing.status).toBe(400)
    expect((await missing.json()).error.code).toBe('CMS_INVALID_ITEM')
    doc.modules[1].content.entries[0].itemId = 'dronken'
    doc.modules[1].content.entries[0].media = { id: `media_${crypto.randomUUID()}`, alt: 'A' }
    const invalid = await f.call(
      'PUT',
      draft,
      { ...input, operationId: crypto.randomUUID() },
      input.expectedRevision,
    )
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error.code).toBe('CMS_INVALID_MEDIA')
    doc.modules[1].content.entries[0].media = null
    const saved = await f.call(
      'PUT',
      draft,
      { ...input, operationId: crypto.randomUUID() },
      input.expectedRevision,
    )
    expect(saved.status).toBe(200)
    await f.db.prepare("UPDATE catalog_items SET visible=0 WHERE id='dronken'").run()
    let read = await (await f.call('GET', site)).json()
    expect(read.warnings).toContain('ITEM_HIDDEN')
    expect(read.warnings).toContain('MEDIA_NOT_READY')
    await f.db.batch([
      f.db.prepare("DELETE FROM catalog_variants WHERE item_id='dronken'"),
      f.db.prepare("DELETE FROM catalog_items WHERE id='dronken'"),
    ])
    read = await (await f.call('GET', site)).json()
    expect(read.warnings).toContain('ITEM_MISSING')
    expect(read.draft.document.modules[1].content.entries[0].itemId).toBe('dronken')
    expect(JSON.stringify(read)).not.toMatch(
      /objectKey|sha256|manifest|session_hash|actor_id|command_hash/,
    )
  } finally {
    await f.close()
  }
}, 30000)

it('HTTP save and media deletion serialize with no dangling entry-only reference', async () => {
  const f = await cp3Fixture()
  try {
    const converted = await f.convert()
    expect(converted.response.status).toBe(200)
    const operation = crypto.randomUUID(),
      id = `media_${operation}`
    const upload = await handleLocalMedia(
      new Request(TEST_ORIGIN + '/api/admin/media', {
        method: 'POST',
        headers: {
          Cookie: f.base.cookie,
          Origin: TEST_ORIGIN,
          'X-Operation-Id': operation,
          'If-None-Match': '*',
          'Content-Type': 'image/png',
        },
        body: f.base.png,
      }),
      f.env,
    )
    expect(upload.status).toBe(200)
    const doc = structuredClone(converted.result.site.draft.document)
    doc.modules[0].content.media = null
    doc.modules.splice(1, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'carousel',
      visible: true,
      navigation: 'primary',
      content: {
        heading: 'B',
        lead: 'L',
        media: null,
        entries: [{ itemId: 'dronken', media: { id, alt: 'A' } }],
      },
    })
    const cmd = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: converted.result.command.revision,
      document: doc,
    }
    const deleting = `media_${crypto.randomUUID()}`
    await f.db
      .prepare("INSERT INTO cms_media(media_id,state,created_at) VALUES(?,'deleting',?)")
      .bind(deleting, Date.now())
      .run()
    const unavailable = structuredClone(cmd)
    unavailable.operationId = crypto.randomUUID()
    unavailable.document.modules[1].content.entries[0].media.id = deleting
    const refused = await f.call('PUT', draft, unavailable, unavailable.expectedRevision)
    expect(refused.status).toBe(400)
    expect((await refused.json()).error.code).toBe('CMS_INVALID_MEDIA')
    const revision = await f.db
      .prepare('SELECT revision FROM cms_media WHERE media_id=?')
      .bind(id)
      .first<string>('revision')
    const [saved, removed] = await Promise.all([
      f.call('PUT', draft, cmd, cmd.expectedRevision),
      handleLocalMedia(
        new Request(TEST_ORIGIN + '/api/admin/media/' + id, {
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
    expect([
      [200, 409],
      [400, 200],
    ]).toContainEqual([saved.status, removed.status])
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

it('commands recorded for a different actor cannot be retrieved or replayed', async () => {
  const f = await cp3Fixture()
  try {
    const converted = await f.convert()
    expect(converted.response.status).toBe(200)
    // F2 enforces one owner in SQL. Inject only a foreign actor in the read result;
    // keep the authenticated session and persisted history unchanged.
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, key) {
          if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values))
          if (key === 'first')
            return async () => {
              const row = await target.first<Record<string, unknown>>()
              return row ? { ...row, actor_id: 'foreign-actor' } : row
            }
          return Reflect.get(target, key, target)
        },
      })
    const db = new Proxy(f.db, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const statement = target.prepare(sql)
            return sql === 'SELECT * FROM cms_v2_versions WHERE operation_id=?'
              ? wrap(statement)
              : statement
          }
        return Reflect.get(target, key, target)
      },
    })
    const env = { ...f.env, DELEGAS_DB: db }
    const get = await f.call(
      'GET',
      site + '/commands/' + converted.input.operationId,
      undefined,
      undefined,
      {},
      env,
    )
    expect(get.status).toBe(404)
    const replay = await f.call(
      'POST',
      conversion,
      converted.input,
      converted.input.expectedRevision,
      {},
      env,
    )
    expect(replay.status).toBe(409)
    expect((await replay.json()).error.code).toBe('CMS_OPERATION_CONFLICT')
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(1)
  } finally {
    await f.close()
  }
}, 30000)
