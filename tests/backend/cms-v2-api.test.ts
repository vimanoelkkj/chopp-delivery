import { expect, it } from 'vitest'
import { convertCmsV1ToV2 } from '../../server/cms/convert'
import { conversion, cp3Fixture, draft, site } from './cms-v2-api-fixture'
import { history } from './cms-v2-sql-fixture'

it('preview is read-only and conversion is server-computed, persisted and replayed immutably', async () => {
  const f = await cp3Fixture()
  try {
    const before = await history(f.db),
      initial = await (await f.call('GET', site)).json()
    expect(initial.schema).toBe(1)
    const input = f.intent(),
      preview = await f.call(
        'POST',
        conversion,
        { ...input, action: 'previewConversion' },
        input.expectedRevision,
      )
    expect(preview.status).toBe(200)
    const p = await preview.json()
    expect(p.preview.document).toEqual(convertCmsV1ToV2(f.base.last.site.draft.document!).document)
    expect(await history(f.db)).toBe(before)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(0)
    expect((await f.call('GET', site + '/commands/' + input.operationId)).status).toBe(404)
    expect(
      (await f.call('POST', conversion, { ...input, document: f.document }, input.expectedRevision))
        .status,
    ).toBe(400)
    const response = await f.call('POST', conversion, input, input.expectedRevision)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.command.action).toBe('convertToV2')
    expect(result.site.schema).toBe(2)
    expect(result.site.draft.document).toEqual(p.preview.document)
    const next = {
      action: 'saveDraft',
      expectedRevision: result.command.revision,
      operationId: crypto.randomUUID(),
      document: structuredClone(result.site.draft.document),
    }
    next.document.modules[0].content.heading = 'Edited v2'
    const saved = await f.call('PUT', draft, next, next.expectedRevision)
    expect(saved.status).toBe(200)
    const receipt = await saved.json()
    expect(await (await f.call('POST', conversion, input, input.expectedRevision)).json()).toEqual(
      result,
    )
    expect(await (await f.call('GET', site + '/commands/' + input.operationId)).json()).toEqual(
      result,
    )
    const another = {
      ...next,
      operationId: crypto.randomUUID(),
      expectedRevision: receipt.command.revision,
    }
    expect((await f.call('PUT', draft, another, another.expectedRevision)).status).toBe(200)
    expect(await (await f.call('PUT', draft, next, next.expectedRevision)).json()).toEqual(receipt)
    expect(await (await f.call('GET', site + '/commands/' + next.operationId)).json()).toEqual(
      receipt,
    )
    expect(await history(f.db)).toBe(before)
    expect(JSON.stringify(result)).not.toMatch(
      /objectKey|sha256|manifest|session_hash|actor_id|command_hash|quarantine_key/,
    )
  } finally {
    await f.close()
  }
}, 30000)
it('v1 receipts survive conversion; new v1 writes are superseded and epoch mismatches are conflicts', async () => {
  const f = await cp3Fixture()
  try {
    const c = await f.convert()
    expect(c.response.status).toBe(200)
    expect(
      await (await f.call('PUT', draft, f.base.first, f.base.first.expectedRevision)).json(),
    ).toEqual(f.base.receipt)
    expect(
      await (await f.call('GET', site + '/commands/' + f.base.first.operationId)).json(),
    ).toEqual(f.base.receipt)
    const old = { ...f.base.second, operationId: crypto.randomUUID() }
    const r = await f.call('PUT', draft, old, old.expectedRevision)
    expect(r.status).toBe(409)
    expect((await r.json()).error.code).toBe('CMS_SCHEMA_SUPERSEDED')
    const v2 = {
      action: 'saveDraft',
      expectedRevision: f.base.last.command.revision,
      operationId: crypto.randomUUID(),
      document: c.result.site.draft.document,
    }
    const epoch = await f.call('PUT', draft, v2, v2.expectedRevision)
    expect(epoch.status).toBe(409)
    expect((await epoch.json()).error.code).toBe('CMS_REVISION_CONFLICT')
  } finally {
    await f.close()
  }
}, 30000)
it('two conversions and conversion against v1 save have exactly one winner', async () => {
  const f = await cp3Fixture()
  try {
    const a = f.intent(),
      b = f.intent()
    const responses = await Promise.all([
      f.call('POST', conversion, a, a.expectedRevision),
      f.call('POST', conversion, b, b.expectedRevision),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(1)
  } finally {
    await f.close()
  }
  const g = await cp3Fixture()
  try {
    const c = g.intent(),
      v1 = {
        ...g.base.second,
        operationId: crypto.randomUUID(),
        expectedRevision: g.base.last.command.revision,
      }
    const responses = await Promise.all([
      g.call('POST', conversion, c, c.expectedRevision),
      g.call('PUT', draft, v1, v1.expectedRevision),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
  } finally {
    await g.close()
  }
}, 30000)
it('startV2 is limited to empty CMS, preserves explicit carousel and replays', async () => {
  const f = await cp3Fixture({ empty: true })
  try {
    const initial = await (await f.call('GET', site)).json()
    expect(initial.schema).toBeNull()
    const no = f.intent('convertToV2', initial.draft.revision)
    expect((await f.call('POST', conversion, no, no.expectedRevision)).status).toBe(409)
    const doc = structuredClone(f.document)
    doc.modules.splice(1, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'carousel',
      visible: true,
      navigation: 'primary',
      content: { heading: 'B', lead: 'L', media: null, entries: [] },
    })
    const input = { ...f.intent('startV2', initial.draft.revision), document: doc }
    const response = await f.call('POST', conversion, input, input.expectedRevision)
    expect(response.status).toBe(200)
    const receipt = await response.json()
    expect(receipt.command.action).toBe('startV2')
    expect(receipt.site.draft.document).toEqual(doc)
    expect(await (await f.call('POST', conversion, input, input.expectedRevision)).json()).toEqual(
      receipt,
    )
  } finally {
    await f.close()
  }
}, 30000)
it('operation namespace, payload/action conflicts, acknowledgements and concurrent revision are strict', async () => {
  const f = await cp3Fixture()
  try {
    const input = { ...f.intent(), acknowledge: ['B', 'A'] },
      response = await f.call('POST', conversion, input, input.expectedRevision)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(
      await (
        await f.call(
          'POST',
          conversion,
          { ...input, acknowledge: ['A', 'B'] },
          input.expectedRevision,
        )
      ).json(),
    ).toEqual(result)
    const bad = await f.call(
      'POST',
      conversion,
      { ...input, acknowledge: ['C'] },
      input.expectedRevision,
    )
    expect(bad.status).toBe(409)
    expect((await bad.json()).error.code).toBe('CMS_OPERATION_CONFLICT')
    const a = {
        action: 'saveDraft',
        expectedRevision: result.command.revision,
        operationId: crypto.randomUUID(),
        document: result.site.draft.document,
      },
      b = { ...a, operationId: crypto.randomUUID() }
    expect(
      (
        await Promise.all([
          f.call('PUT', draft, a, a.expectedRevision),
          f.call('PUT', draft, b, b.expectedRevision),
        ])
      )
        .map((r) => r.status)
        .sort(),
    ).toEqual([200, 409])
    const collision = { ...a, operationId: input.operationId }
    expect((await f.call('PUT', draft, collision, collision.expectedRevision)).status).toBe(409)
  } finally {
    await f.close()
  }
}, 30000)

it('concurrent identical conversions and saves produce one immutable result; legacy IDs cannot be reused', async () => {
  const f = await cp3Fixture()
  try {
    const collision = { ...f.intent(), operationId: f.base.first.operationId }
    const clash = await f.call('POST', conversion, collision, collision.expectedRevision)
    expect(clash.status).toBe(409)
    expect((await clash.json()).error.code).toBe('CMS_OPERATION_CONFLICT')
    const c = f.intent(),
      responses = await Promise.all([
        f.call('POST', conversion, c, c.expectedRevision),
        f.call('POST', conversion, c, c.expectedRevision),
      ])
    expect(responses.map((r) => r.status)).toEqual([200, 200])
    const a = await responses[0].json()
    expect(await responses[1].json()).toEqual(a)
    const cmd = {
      action: 'saveDraft',
      expectedRevision: a.command.revision,
      operationId: crypto.randomUUID(),
      document: a.site.draft.document,
    }
    const saves = await Promise.all([
      f.call('PUT', draft, cmd, cmd.expectedRevision),
      f.call('PUT', draft, cmd, cmd.expectedRevision),
    ])
    expect(saves.map((r) => r.status)).toEqual([200, 200])
    expect(await saves[0].json()).toEqual(await saves[1].json())
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(2)
  } finally {
    await f.close()
  }
}, 30000)

for (const kind of ['convert', 'save'] as const)
  it(`replays remain idempotent for ${kind} between receipt lookup and head read`, async () => {
    const f = await cp3Fixture()
    try {
      const base = kind === 'save' ? await f.convert() : null
      const c = base
        ? {
            action: 'saveDraft',
            operationId: crypto.randomUUID(),
            expectedRevision: base.result.command.revision,
            document: base.result.site.draft.document,
          }
        : f.intent()
      const path = kind === 'save' ? draft : conversion,
        method = kind === 'save' ? 'PUT' : 'POST'
      let committed: unknown,
        injected = false
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
        new Proxy(statement, {
          get(target, key) {
            if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values))
            if (key === 'first')
              return async () => {
                const found = await target.first()
                if (!found && !injected) {
                  injected = true
                  const winner = await f.call(method, path, c, c.expectedRevision)
                  expect(winner.status).toBe(200)
                  committed = await winner.json()
                }
                return found
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
      const response = await f.call(
        method,
        path,
        c,
        c.expectedRevision,
        {},
        { ...f.env, DELEGAS_DB: db },
      )
      expect(injected).toBe(true)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(committed)
      expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(
        kind === 'save' ? 2 : 1,
      )
    } finally {
      await f.close()
    }
  }, 30000)
