import { Miniflare } from 'miniflare'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localImageWorker } from '../../scripts/local-image-worker.mjs'
import { publicationMediaErrors } from '../../server/cms/media-contract'
import {
  handleLocalMedia,
  type LocalMediaEnv,
  type MediaBucket,
} from '../../server/cms/media-library'
import { applyTestMigration, TEST_ORIGIN } from './auth-fixture'
import { cmsFixture } from './cms-fixture'

describe('private local media lifecycle with real D1, R2, Images emulator and F2 sessions', () => {
  let f: Awaited<ReturnType<typeof cmsFixture>>
  let runtime: Miniflare
  let env: LocalMediaEnv
  let png: Uint8Array<ArrayBuffer>
  let operation: string
  beforeEach(async () => {
    f = await cmsFixture()
    await applyTestMigration(f.db, '0007_cms_media_local.sql')
    runtime = new Miniflare({
      r2Persist: false,
      workers: [
        {
          name: 'entry',
          modules: true,
          script: 'export default {fetch(){return new Response(null,{status:404})}}',
          r2Buckets: { BUCKET: 'local-media' },
          serviceBindings: { PROCESSOR: 'private' },
        },
        {
          name: 'private',
          modules: true,
          compatibilityDate: '2026-08-06',
          images: { binding: 'IMAGES' },
          script: localImageWorker,
        },
      ],
    })
    const bindings = await runtime.getBindings('entry')
    env = {
      ...f.env,
      CMS_MEDIA_LOCAL: 'disposable-v1',
      CMS_MEDIA_BUCKET: await runtime.getR2Bucket('BUCKET', 'entry'),
      CMS_MEDIA_PROCESSOR: bindings.PROCESSOR as Pick<Fetcher, 'fetch'>,
    }
    png = new Uint8Array(
      await sharp({ create: { width: 64, height: 48, channels: 3, background: '#803020' } })
        .withMetadata()
        .png()
        .toBuffer(),
    )
    operation = crypto.randomUUID()
  })
  afterEach(async () => {
    await runtime?.dispose()
    await f?.runtime.dispose()
  })
  const request = (
    method = 'POST',
    body: Uint8Array<ArrayBuffer> | undefined = png,
    headers: Record<string, string> = {},
  ) =>
    new Request(`${TEST_ORIGIN}/api/admin/media`, {
      method,
      headers: {
        Cookie: f.cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'image/png',
        'X-Operation-Id': operation,
        'If-None-Match': '*',
        ...headers,
      },
      ...(method === 'GET' || method === 'DELETE' || !body ? {} : { body }),
    })
  const upload = () => handleLocalMedia(request(), env)
  const media = () =>
    f.db
      .prepare('SELECT * FROM cms_media WHERE media_id=?')
      .bind(`media_${operation}`)
      .first<{ state: string; derivatives_json: string | null; revision: string }>()
  const jobs = () => f.db.prepare('SELECT * FROM cms_media_jobs').all<{ status: string }>()
  const objects = () => env.CMS_MEDIA_BUCKET?.list({ prefix: 'cms/' })
  const reconcile = () =>
    handleLocalMedia(
      request('POST', new Uint8Array(), {
        'X-Operation-Id': crypto.randomUUID(),
        'If-Match': '"local-media-v1"',
      }),
      env,
      undefined,
      true,
    )
  const deletion = (revision = operation) =>
    handleLocalMedia(
      request('DELETE', undefined, {
        'X-Operation-Id': crypto.randomUUID(),
        'If-Match': `"${revision}"`,
      }),
      env,
      `media_${operation}`,
    )

  it('upgrades 0006 without seeding content, persists sanitized manifests, replays and tombstones', async () => {
    expect(f.initial.draft.document).toBeNull()
    const response = await upload()
    expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).not.toMatch(
      /objectKey|sha256|quarantine|actor|session/,
    )
    expect((await media())?.state).toBe('ready')
    const manifest = JSON.parse((await media())?.derivatives_json ?? '{}')
    expect(Object.keys(manifest)).toEqual(['hero', 'section'])
    expect((await objects())?.objects).toHaveLength(2)
    for (const d of Object.values(manifest) as { objectKey: string; sha256: string }[]) {
      const stored = await env.CMS_MEDIA_BUCKET?.get(d.objectKey)
      const bytes = Buffer.from(await (stored as R2ObjectBody).arrayBuffer())
      const info = await sharp(bytes).metadata()
      expect(info.format).toBe('webp')
      for (const field of ['exif', 'icc', 'iptc', 'xmp', 'orientation'] as const)
        expect(info[field]).toBeUndefined()
      expect(bytes.equals(Buffer.from(png))).toBe(false)
    }
    expect((await upload()).status).toBe(200)
    expect((await jobs()).results).toHaveLength(1)
    expect((await deletion('m0')).status).toBe(412)
    expect((await media())?.state).toBe('ready')
    expect((await deletion()).status).toBe(200)
    expect((await media())?.state).toBe('deleted')
    expect((await objects())?.objects).toHaveLength(0)
  })
  it.each([
    ['unauthenticated', { Cookie: '' }, 401],
    ['wrong origin', { Origin: 'https://evil.invalid' }, 403],
    ['cross site', { 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['missing precondition', { 'If-None-Match': '' }, 400],
  ] as const)('rejects %s without persistent effects', async (_name, headers, status) => {
    expect((await handleLocalMedia(request('POST', png, headers), env)).status).toBe(status)
    expect(await media()).toBeNull()
    expect((await jobs()).results).toHaveLength(0)
  })
  it('denies revoked sessions and missing opt-in', async () => {
    expect((await handleLocalMedia(request(), { ...env, CMS_MEDIA_LOCAL: undefined })).status).toBe(
      404,
    )
    await f.db.prepare('DELETE FROM admin_sessions').run()
    expect((await upload()).status).toBe(401)
    expect(await media()).toBeNull()
  })
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'rejects truncated/forged %s and persists rejection',
    async (mime) => {
      const response = await handleLocalMedia(
        request('POST', new Uint8Array([255, 216, 255, 217]), { 'Content-Type': mime }),
        env,
      )
      expect(response.status).toBe(400)
      expect((await media())?.state).toBe('rejected')
      expect((await jobs()).results[0].status).toBe('failed')
      expect((await objects())?.objects).toHaveLength(0)
    },
  )
  it('rejects MIME spoofing, preserves failed operation identity', async () => {
    expect(
      (await handleLocalMedia(request('POST', png, { 'Content-Type': 'image/jpeg' }), env)).status,
    ).toBe(400)
    expect((await media())?.state).toBe('rejected')
    expect((await upload()).status).toBe(409)
  })
  it('rejects pixel bombs, extreme dimensions and animations before invoking processor', async () => {
    let calls = 0
    env.CMS_MEDIA_PROCESSOR = {
      fetch: async () => {
        calls++
        return new Response(null, { status: 500 })
      },
    }
    for (const [width, height] of [
      [6001, 1],
      [4000, 3001],
    ]) {
      operation = crypto.randomUUID()
      const bytes = new Uint8Array(
        await sharp({ create: { width, height, channels: 3, background: 'red' } })
          .png()
          .toBuffer(),
      )
      expect((await handleLocalMedia(request('POST', bytes), env)).status).toBe(400)
      expect((await media())?.state).toBe('rejected')
    }
    operation = crypto.randomUUID()
    const animation = new Uint8Array(
      await sharp(Buffer.concat([Buffer.alloc(16 * 16 * 3), Buffer.alloc(16 * 16 * 3, 255)]), {
        raw: { width: 16, height: 32, pageHeight: 16, channels: 3 },
      })
        .webp({ loop: 0, delay: [100, 100] })
        .toBuffer(),
    )
    expect(
      (await handleLocalMedia(request('POST', animation, { 'Content-Type': 'image/webp' }), env))
        .status,
    ).toBe(400)
    expect((await media())?.state).toBe('rejected')
    expect(calls).toBe(0)
  })
  it('rejects oversized upload, stale condition and missing media references', async () => {
    expect(
      (await handleLocalMedia(request('POST', new Uint8Array(5 * 1024 * 1024 + 1)), env)).status,
    ).toBe(413)
    expect((await media())?.state).toBe('rejected')
    const cmd = f.command()
    const hero = cmd.document.modules.find((m) => m.template === 'hero')
    if (hero?.template !== 'hero') throw Error('fixture')
    hero.content.media = { id: `media_${crypto.randomUUID()}`, alt: 'photo' }
    expect((await f.save(cmd)).response.status).toBe(400)
    expect(await f.count('cms_versions')).toBe(0)
  })
  it('serializes concurrent upload and replay without duplicates', async () => {
    const responses = await Promise.all([upload(), upload()])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await objects())?.objects).toHaveLength(2)
    expect((await jobs()).results).toHaveLength(1)
    expect((await upload()).status).toBe(200)
  })
  it('blocks deletion referenced solely by a hidden module in an immutable draft', async () => {
    expect((await upload()).status).toBe(200)
    const cmd = f.command()
    cmd.document.modules.splice(2, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'highlight',
      region: 'details',
      visible: false,
      navigation: 'none',
      content: { heading: '', body: '', media: { id: `media_${operation}`, alt: 'photo' } },
    })
    expect((await f.save(cmd)).response.status).toBe(200)
    expect((await deletion()).status).toBe(409)
    expect((await media())?.state).toBe('ready')
    expect((await objects())?.objects).toHaveLength(2)
  })
  it.each(['quarantined', 'processing', 'rejected', 'deleting', 'deleted'])(
    'rejects %s for publication',
    async (state) => {
      const doc = f.command().document,
        hero = doc.modules.find((m) => m.template === 'hero')
      if (hero?.template !== 'hero') throw Error('fixture')
      hero.content.media = { id: `media_${operation}`, alt: 'photo' }
      expect(
        publicationMediaErrors(
          doc,
          new Map([
            [
              `media_${operation}`,
              { id: `media_${operation}`, state: state as 'processing', derivatives: null },
            ],
          ]),
        ),
      ).toEqual([`media_${operation}`])
      expect(
        (await f.db.prepare('SELECT published_version_id FROM cms_state').first())
          ?.published_version_id,
      ).toBeNull()
    },
  )
  it('processor failure leaves rejected media and no original object', async () => {
    env.CMS_MEDIA_PROCESSOR = {
      fetch: async () => {
        throw Error('injected processor failure')
      },
    }
    expect((await upload()).status).toBe(503)
    expect((await media())?.state).toBe('rejected')
    expect((await objects())?.objects).toHaveLength(0)
  })
  it.each(['before', 'after'])(
    'reconciles R2 failure %s put without claiming atomicity',
    async (when) => {
      const bucket = env.CMS_MEDIA_BUCKET as MediaBucket
      env.CMS_MEDIA_BUCKET = new Proxy(bucket, {
        get(target, key) {
          if (key === 'put')
            return async (...args: Parameters<MediaBucket['put']>) => {
              if (when === 'after') await target.put(...args)
              throw Error('injected R2 failure')
            }
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      expect((await upload()).status).toBe(503)
      expect((await media())?.state).toBe('rejected')
      expect((await objects())?.objects).toHaveLength(when === 'after' ? 1 : 0)
      expect((await reconcile()).status).toBe(200)
      expect((await objects())?.objects).toHaveLength(0)
    },
  )
  it('D1 failure after objects retains recoverable private objects and reconciles later', async () => {
    await f.db
      .prepare(
        "CREATE TRIGGER injected_media_failure BEFORE UPDATE ON cms_media WHEN NEW.state='ready' BEGIN SELECT RAISE(ABORT,'injected D1 failure'); END",
      )
      .run()
    expect((await upload()).status).toBe(503)
    expect((await media())?.state).toBe('rejected')
    expect((await objects())?.objects).toHaveLength(2)
    expect((await reconcile()).status).toBe(200)
    expect((await objects())?.objects).toHaveLength(0)
  })
  it('auth revocation during processing fences completion and preserves the lease', async () => {
    const processor = env.CMS_MEDIA_PROCESSOR as Pick<Fetcher, 'fetch'>
    env.CMS_MEDIA_PROCESSOR = {
      fetch: async (input, init) => {
        const result = await processor.fetch(input, init)
        await f.db.prepare('DELETE FROM admin_sessions').run()
        return result
      },
    }
    expect((await upload()).status).toBe(401)
    expect((await media())?.state).toBe('processing')
    expect((await objects())?.objects).toHaveLength(0)
  })
  it('bounds a stalled processor and preserves rejected state', async () => {
    env.CMS_MEDIA_PROCESSOR = { fetch: () => new Promise(() => {}) }
    expect((await upload()).status).toBe(408)
    expect((await media())?.state).toBe('rejected')
    expect((await objects())?.objects).toHaveLength(0)
  }, 10000)
  it('bounds stalled upload and releases the slot into a failed receipt', async () => {
    const stream = new ReadableStream<Uint8Array>()
    const base = request()
    const stalled = new Request(base.url, {
      method: 'POST',
      headers: base.headers,
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect((await handleLocalMedia(stalled, env)).status).toBe(408)
    expect((await media())?.state).toBe('rejected')
    expect((await jobs()).results[0].status).toBe('failed')
  }, 10000)
  it('validates JPEG and WebP through the actual service binding', async () => {
    for (const format of ['jpeg', 'webp'] as const) {
      operation = crypto.randomUUID()
      const bytes = new Uint8Array(await sharp(png)[format]().toBuffer())
      expect(
        (await handleLocalMedia(request('POST', bytes, { 'Content-Type': `image/${format}` }), env))
          .status,
      ).toBe(200)
      expect((await media())?.state).toBe('ready')
      operation = crypto.randomUUID()
      expect(
        (
          await handleLocalMedia(
            request('POST', bytes.slice(0, Math.floor(bytes.length / 2)), {
              'Content-Type': `image/${format}`,
            }),
            env,
          )
        ).status,
      ).toBe(400)
      expect((await media())?.state).toBe('rejected')
    }
  })
  it('expires interrupted work, removes unknown orphan objects, keeps ready manifests', async () => {
    expect((await upload()).status).toBe(200)
    const orphan = `cms/derived/media_${crypto.randomUUID()}/orphan/hero.webp`
    await env.CMS_MEDIA_BUCKET?.put(orphan, new Uint8Array([1, 2, 3]))
    const stale = crypto.randomUUID()
    await f.db
      .prepare(
        "INSERT INTO cms_media_jobs VALUES (?,'upload',?,'owner-test','',NULL,'running',1,1)",
      )
      .bind(stale, `media_${stale}`)
      .run()
    expect((await reconcile()).status).toBe(200)
    expect((await objects())?.objects).toHaveLength(2)
    expect((await media())?.state).toBe('ready')
    expect(
      (
        await f.db
          .prepare('SELECT state FROM cms_media WHERE media_id=?')
          .bind(`media_${stale}`)
          .first()
      )?.state,
    ).toBe('rejected')
    expect(
      (
        await f.db
          .prepare('SELECT status FROM cms_media_jobs WHERE operation_id=?')
          .bind(stale)
          .first()
      )?.status,
    ).toBe('failed')
  })
  it('recovers partial deletion and prevents dangling ready manifests', async () => {
    expect((await upload()).status).toBe(200)
    const bucket = env.CMS_MEDIA_BUCKET as MediaBucket
    env.CMS_MEDIA_BUCKET = new Proxy(bucket, {
      get(target, key) {
        if (key === 'delete')
          return async (key: string) => {
            await target.delete(key)
            throw Error('delete failure')
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    expect((await deletion()).status).toBe(503)
    expect((await media())?.state).toBe('deleting')
    env.CMS_MEDIA_BUCKET = bucket
    expect((await reconcile()).status).toBe(200)
    expect((await media())?.state).toBe('deleted')
    expect((await objects())?.objects).toHaveLength(0)
  })
  it('rejects metadata-bearing and forged processor output before storing bytes', async () => {
    for (const data of [new Uint8Array(await sharp(png).withMetadata().webp().toBuffer()), png]) {
      operation = crypto.randomUUID()
      env.CMS_MEDIA_PROCESSOR = {
        fetch: async () => new Response(data, { headers: { 'Content-Type': 'image/webp' } }),
      }
      expect((await upload()).status).toBe(400)
      expect((await media())?.state).toBe('rejected')
      expect((await objects())?.objects).toHaveLength(0)
    }
  })
  it('serializes completed replays while preserving immutable R2 objects', async () => {
    expect((await upload()).status).toBe(200)
    const before = (await objects())?.objects.map((o) => o.key)
    const responses = await Promise.all([upload(), upload()])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await objects())?.objects.map((o) => o.key)).toEqual(before)
    expect((await media())?.state).toBe('ready')
  })
  it('rejects corrupt PNG, APNG control chunks and appended JPEG payloads', async () => {
    const corrupt = png.slice()
    corrupt[50] ^= 255
    const apng = new Uint8Array(
      Buffer.concat([
        png.slice(0, 33),
        Buffer.from('000000086163544c000000020000000000000000', 'hex'),
        png.slice(33),
      ]),
    )
    const jpeg = await sharp(png).jpeg().toBuffer()
    for (const [bytes, mime] of [
      [corrupt, 'image/png'],
      [apng, 'image/png'],
      [
        new Uint8Array(Buffer.concat([jpeg, Buffer.from('payload'), Buffer.from([255, 217])])),
        'image/jpeg',
      ],
    ] as const) {
      operation = crypto.randomUUID()
      expect(
        (await handleLocalMedia(request('POST', bytes, { 'Content-Type': mime }), env)).status,
      ).toBe(400)
      expect((await media())?.state).toBe('rejected')
    }
    expect((await objects())?.objects).toHaveLength(0)
  })
  it('times out R2 after a write and reconciles the persisted orphan', async () => {
    const bucket = env.CMS_MEDIA_BUCKET as MediaBucket
    env.CMS_MEDIA_BUCKET = new Proxy(bucket, {
      get(target, key) {
        if (key === 'put')
          return async (...args: Parameters<MediaBucket['put']>) => {
            await target.put(...args)
            return new Promise(() => {})
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    expect((await upload()).status).toBe(408)
    expect((await media())?.state).toBe('rejected')
    expect((await objects())?.objects).toHaveLength(1)
    expect((await reconcile()).status).toBe(200)
    expect((await objects())?.objects).toHaveLength(0)
  }, 10000)
})
