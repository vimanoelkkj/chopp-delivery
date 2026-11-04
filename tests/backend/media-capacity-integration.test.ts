import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { handleCmsConvert, handleCmsDraft } from '../../server/cms/handlers'
import { handleLocalMedia, type MediaBucket } from '../../server/cms/media-library'
import { handleMediaCommand, handleMediaList } from '../../server/cms/media-queries'
import type { CmsVersionedCommandResult } from '../../shared/cms'
import { TEST_ORIGIN } from './auth-fixture'
import { applySql, sql9 } from './cms-v2-sql-fixture'
import { mediaFixture } from './media-stage3-fixture'

it('M3A: reusable slots, cleanup failures, history, receipts and concurrency on disposable D1/R2', async () => {
  const f = await mediaFixture()
  try {
    const request = (method = 'GET', body?: unknown, revision?: string) =>
      new Request(`${TEST_ORIGIN}/api/admin/site`, {
        method,
        headers: {
          Cookie: f.cookie,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
          ...(revision ? { 'If-Match': `"${revision}"` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const capacity = async () =>
      (
        (await (await handleMediaList(request(), f.env)).json()) as {
          capacity: { consumed: number; remaining: number; includesTombstones: boolean }
        }
      ).capacity
    const upload = (operation: string, bytes = f.png) =>
      handleLocalMedia(f.request('POST', bytes, { 'X-Operation-Id': operation }), f.env)
    const remove = (id: string, revision: string) =>
      handleLocalMedia(
        f.request('DELETE', undefined, {
          'X-Operation-Id': crypto.randomUUID(),
          'If-Match': `"${revision}"`,
        }),
        f.env,
        id,
      )
    const receipt = async (op: string) => (await handleMediaCommand(request(), f.env, op)).json()
    expect((await capacity()).includesTombstones).toBe(true)
    await applySql(f.db, sql9())
    await applySql(f.db, readFileSync('migrations/0010_cms_media_capacity.sql', 'utf8'))
    for (const name of [
      '0007_cms_media_local.sql',
      '0008_cms_media_atomic.sql',
      '0009_cms_v2.sql',
      '0010_cms_media_capacity.sql',
    ])
      await f.db.prepare('INSERT INTO d1_migrations VALUES(?)').bind(name).run()
    expect(await capacity()).toEqual({
      limit: 100,
      consumed: 0,
      remaining: 100,
      includesTombstones: false,
    })

    const bad = crypto.randomUUID()
    expect((await upload(bad, new Uint8Array([1, 2, 3]))).status).toBe(400)
    const failed = await receipt(bad)
    expect((await capacity()).consumed).toBe(1)
    expect((await remove(`media_${bad}`, bad)).status).toBe(200)
    expect((await capacity()).consumed).toBe(0)
    expect(await receipt(bad)).toEqual(failed)

    const rejected = Array.from({ length: 99 }, () => `media_${crypto.randomUUID()}`)
    await f.db.batch(
      rejected.map((id) =>
        f.db
          .prepare("INSERT INTO cms_media(media_id,state,created_at) VALUES(?,'rejected',1)")
          .bind(id),
      ),
    )
    const ops = [crypto.randomUUID(), crypto.randomUUID()]
    const responses = await Promise.all(ops.map((op) => upload(op)))
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    const winner = responses[0].status === 200 ? 0 : 1,
      op1 = ops[winner],
      id1 = `media_${op1}`
    const original = await responses[winner].json()
    expect((await capacity()).consumed).toBe(100)
    expect((await upload(crypto.randomUUID())).status).toBe(429)
    expect((await remove(rejected[0], 'm0')).status).toBe(200)
    expect((await capacity()).remaining).toBe(1)
    const op2 = crypto.randomUUID(),
      id2 = `media_${op2}`
    const second = await upload(op2)
    expect(second.status).toBe(200)
    const secondReceipt = await second.json()
    expect((await capacity()).consumed).toBe(100)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_media').first('n')).toBe(102)

    // Save a real v1 reference, convert to v2, then remove it from the current draft.
    const v1 = f.command()
    const hero = v1.document.modules.find((m) => m.template === 'hero')
    if (hero?.template !== 'hero') throw Error('fixture')
    hero.content.media = { id: id1, alt: 'Historical image' }
    const saved = await f.save(v1)
    expect(saved.response.status).toBe(200)
    const convert = await handleCmsConvert(
      request(
        'POST',
        {
          action: 'convertToV2',
          operationId: crypto.randomUUID(),
          expectedRevision: saved.result.command.revision,
        },
        saved.result.command.revision,
      ),
      f.env,
    )
    expect(convert.status).toBe(200)
    const converted = (await convert.json()) as CmsVersionedCommandResult
    if (converted.site.schema !== 2) throw Error('fixture')
    // Current and historical references both deny deletion.
    expect((await remove(id1, op1)).status).toBe(409)
    const doc = structuredClone(converted.site.draft.document)
    const v2hero = doc.modules.find((m) => m.template === 'hero')
    if (v2hero?.template !== 'hero') throw Error('fixture')
    v2hero.content.media = null
    const revision = converted.command.revision
    expect(
      (
        await handleCmsDraft(
          request(
            'PUT',
            {
              action: 'saveDraft',
              operationId: crypto.randomUUID(),
              expectedRevision: revision,
              document: doc,
            },
            revision,
          ),
          f.env,
        )
      ).status,
    ).toBe(200)
    const history = async () =>
      JSON.stringify(
        (
          await f.db.batch(
            ['cms_versions', 'cms_media_refs', 'cms_v2_versions', 'cms_v2_media_refs'].map(
              (table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`),
            ),
          )
        ).map((r) => r.results),
      )
    const beforeHistory = await history()
    expect((await remove(id1, op1)).status).toBe(409)
    expect(await history()).toBe(beforeHistory)
    expect((await capacity()).consumed).toBe(100)

    // Failed R2 cleanup keeps its slot. Reconciliation finishes deletion before releasing it.
    const bucket = f.env.CMS_MEDIA_BUCKET
    f.env.CMS_MEDIA_BUCKET = new Proxy(bucket, {
      get(target, key) {
        if (key === 'delete')
          return async (key: string) => {
            await target.delete(key)
            throw Error('injected cleanup failure')
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as MediaBucket
    expect((await remove(id2, op2)).status).toBe(503)
    expect((await capacity()).consumed).toBe(100)
    f.env.CMS_MEDIA_BUCKET = bucket
    expect((await f.reconcile()).status).toBe(200)
    expect((await capacity()).consumed).toBe(99)
    expect(await receipt(op2)).toEqual(secondReceipt)
    expect(await receipt(op1)).toEqual(original)
    // Original upload receipt stays immutable, and replay does not reserve a new slot after deletion.
    expect(await (await upload(op2)).json()).toEqual(secondReceipt)
    expect((await capacity()).consumed).toBe(99)
    expect(await history()).toBe(beforeHistory)
    expect((await bucket.list({ prefix: `cms/derived/${id1}/` })).objects).toHaveLength(2)
    expect((await bucket.list({ prefix: `cms/derived/${id2}/` })).objects).toHaveLength(0)
    expect(
      await f.db
        .prepare('SELECT published_version_id FROM cms_v2_state')
        .first('published_version_id'),
    ).toBeNull()
  } finally {
    await f.close()
  }
}, 30000)
