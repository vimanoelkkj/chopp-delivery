import { afterEach, beforeEach, expect, it } from 'vitest'
import { handleLocalMedia, type MediaBucket } from '../../server/cms/media-library'
import {
  handleMediaBytes,
  handleMediaCommand,
  handleMediaList,
} from '../../server/cms/media-queries'
import { TEST_ORIGIN } from './auth-fixture'
import { mediaFixture } from './media-stage3-fixture'

let f: Awaited<ReturnType<typeof mediaFixture>>
beforeEach(async () => {
  f = await mediaFixture()
})
afterEach(async () => {
  await f.close()
})
const req = (path = '', cookie?: string) =>
  new Request(`${TEST_ORIGIN}/api/admin/media${path}`, {
    headers: { Cookie: cookie ?? f.cookie },
  })
const list = (query = '') => handleMediaList(req(query), f.env)
const image = (id = f.id, profile = 'hero') =>
  handleMediaBytes(req(`/${id}/${profile}`), f.env, id, profile)
const command = (id: string = f.operation) => handleMediaCommand(req(`/commands/${id}`), f.env, id)
const remove = (id = f.id, revision = f.operation) =>
  handleLocalMedia(
    f.request('DELETE', undefined, {
      'X-Operation-Id': crypto.randomUUID(),
      'If-Match': `"${revision}"`,
    }),
    f.env,
    id,
  )
const seed = (state: string, time = 1) =>
  f.db
    .prepare('INSERT INTO cms_media(media_id,state,created_at) VALUES(?,?,?)')
    .bind(`media_${crypto.randomUUID()}`, state, time)
    .run()
type Listing = {
  media: { id: string; state: string; profiles: string[]; integrity: string }[]
  nextCursor: string | null
  capacity: { limit: number; consumed: number; remaining: number; includesTombstones: boolean }
}
const noInternals = (value: unknown) =>
  expect(JSON.stringify(value)).not.toMatch(
    /objectKey|sha256|derivatives_json|session_hash|request_hash|manifest|lease_token/,
  )

it('lists stable pages, safe metadata and lifetime capacity including rejected/deleted', async () => {
  expect((await f.upload()).status).toBe(200)
  for (const state of ['quarantined', 'processing', 'rejected', 'deleting', 'deleted'])
    await seed(state)
  const ids: string[] = []
  let query = '?limit=2'
  for (let page = 0; page < 3; page++) {
    const response = await list(query)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as Listing
    noInternals(body)
    expect(body.capacity).toEqual({
      limit: 100,
      consumed: 6,
      remaining: 94,
      includesTombstones: true,
    })
    expect(body.media).toHaveLength(2)
    for (const item of body.media) {
      ids.push(item.id)
      expect(item.profiles).toEqual(item.state === 'ready' ? ['hero', 'section'] : [])
      expect(item.integrity).toBe(item.state === 'ready' ? 'not_checked' : 'unavailable')
    }
    if (page < 2) expect(body.nextCursor).toBeTruthy()
    else expect(body.nextCursor).toBeNull()
    query = `?limit=2&cursor=${encodeURIComponent(body.nextCursor ?? '')}`
  }
  expect(new Set(ids).size).toBe(6)
  expect(await f.db.prepare('SELECT count(*) n FROM cms_media_checks').first('n')).toBe(1)
})

it('rejects malformed pagination and bounds limits', async () => {
  for (const query of [
    '?limit=0',
    '?limit=26',
    '?limit=-1',
    '?limit=1.5',
    '?limit=02',
    '?limit=1&limit=2',
    '?cursor=x',
    '?cursor=',
    '?other=1',
    `?cursor=${'x'.repeat(300)}`,
  ])
    expect((await list(query)).status, query).toBe(400)
  expect((await list('?limit=25')).status).toBe(200)
})

it('all reads require a valid session and remain disabled outside the disposable local capability', async () => {
  const handlers = [
    (r: Request, env = f.env) => handleMediaList(r, env),
    (r: Request, env = f.env) => handleMediaBytes(r, env, f.id, 'hero'),
    (r: Request, env = f.env) => handleMediaCommand(r, env, f.operation),
  ]
  for (const read of handlers) {
    expect((await read(req('', ''))).status).toBe(401)
    expect((await read(req(), { ...f.env, CMS_MEDIA_LOCAL: undefined })).status).toBe(404)
    expect((await read(new Request('https://example.invalid/api/admin/media'), f.env)).status).toBe(
      404,
    )
    const wrong = await read(
      new Request(`${TEST_ORIGIN}/api/admin/media`, {
        method: 'POST',
        headers: { Cookie: f.cookie, Origin: TEST_ORIGIN },
      }),
    )
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('GET')
  }
  await f.db.prepare('DELETE FROM admin_sessions').run()
  for (const read of handlers) expect((await read(req())).status).toBe(401)
})

it('delivers the exact verified WebP bytes with private headers and no conditional cache bypass', async () => {
  expect((await f.upload()).status).toBe(200)
  const manifest = await f.manifest()
  for (const profile of ['hero', 'section']) {
    const response = await image(f.id, profile)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(response.headers.has('etag')).toBe(false)
    const object = await f.env.CMS_MEDIA_BUCKET.get(manifest[profile].objectKey)
    if (!object) throw new Error('Missing fixture object')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(await object.arrayBuffer()),
    )
  }
})

it('refuses invalid IDs/profiles, missing and non-ready resources without private details', async () => {
  for (const [id, profile] of [
    ['bad', 'hero'],
    [f.id, 'original'],
    [f.id, 'toString'],
    [f.id, '../hero'],
  ])
    expect((await image(id, profile)).status).toBe(400)
  expect((await image()).status).toBe(404)
  for (const state of ['quarantined', 'processing', 'rejected', 'deleting', 'deleted']) {
    const id = `media_${crypto.randomUUID()}`
    await f.db
      .prepare('INSERT INTO cms_media(media_id,state,created_at) VALUES(?,?,1)')
      .bind(id, state)
      .run()
    const response = await image(id)
    expect(response.status).toBe(404)
    noInternals(await response.json())
  }
})

for (const corruption of ['missing', 'same-size', 'mime'] as const) {
  it(`refuses ${corruption} objects, including a damaged non-selected profile`, async () => {
    expect((await f.upload()).status).toBe(200)
    const manifest = await f.manifest(),
      d = manifest.section
    const object = await f.env.CMS_MEDIA_BUCKET.get(d.objectKey)
    if (!object) throw new Error('Missing fixture object')
    const bytes = new Uint8Array(await object.arrayBuffer())
    if (corruption === 'missing') await f.env.CMS_MEDIA_BUCKET.delete(d.objectKey)
    else {
      if (corruption === 'same-size') bytes[bytes.length - 1] ^= 1
      await f.env.CMS_MEDIA_BUCKET.put(d.objectKey, bytes, {
        httpMetadata: { contentType: corruption === 'mime' ? 'text/html' : 'image/webp' },
      })
    }
    const response = await image()
    expect(response.status).toBe(503)
    noInternals(await response.json())
    expect((await f.state())?.state).toBe('ready')
    expect(
      await f.db
        .prepare('SELECT valid FROM cms_media_checks ORDER BY rowid DESC LIMIT 1')
        .first('valid'),
    ).toBe(0)
  })
}

for (const race of ['delete', 'revoke', 'late-corruption'] as const) {
  it(`fails closed for concurrent ${race} during verification`, async () => {
    expect((await f.upload()).status).toBe(200)
    const bucket = f.env.CMS_MEDIA_BUCKET
    let calls = 0
    f.env.CMS_MEDIA_BUCKET = new Proxy(bucket, {
      get(target, key) {
        if (key === 'get')
          return async (objectKey: string) => {
            const object = await target.get(objectKey)
            calls++
            if (calls === 2) {
              if (race === 'delete') expect((await remove()).status).toBe(200)
              else if (race === 'revoke') await f.db.prepare('DELETE FROM admin_sessions').run()
              else {
                const manifest = await f.manifest()
                await target.put(manifest.hero.objectKey, new Uint8Array([1, 2, 3]))
              }
            }
            return object
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as MediaBucket
    const response = await image()
    if (race === 'late-corruption') {
      // The already verified buffer, never a second R2 read, is sent.
      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer()).length).toBeGreaterThan(3)
      expect(calls).toBe(2)
    } else {
      expect(response.status).toBe(race === 'revoke' ? 401 : 404)
      expect(response.headers.get('content-type')).not.toBe('image/webp')
    }
  })
}

it('queries the original persisted receipt after a lost response and later deletion, without replaying', async () => {
  expect((await command()).status).toBe(404)
  const uploaded = await f.upload(),
    original = await uploaded.json()
  expect((await command()).status).toBe(200)
  expect(await (await command()).json()).toEqual(original)
  expect((await remove()).status).toBe(200)
  expect(await (await command()).json()).toEqual(original)
  expect((await image()).status).toBe(404)
  expect(await f.db.prepare('SELECT count(*) n FROM cms_media_jobs').first('n')).toBe(2)
  noInternals(original)
  expect((await command('invalid')).status).toBe(400)
  const unknown = await command(crypto.randomUUID())
  expect(unknown.status).toBe(404)
  expect(await unknown.json()).toMatchObject({ outcome: 'unknown' })
})

it('reports running/expired operations and unknown IDs as unresolved', async () => {
  const actor = await f.db.prepare('SELECT user_id FROM admin_sessions LIMIT 1').first('user_id')
  await f.db
    .prepare("INSERT INTO cms_media_jobs VALUES(?,'upload',?,?, '', '*','running',1,1)")
    .bind(f.operation, f.id, actor)
    .run()
  const response = await command()
  expect(response.status).toBe(202)
  expect(await response.json()).toEqual({
    operation: { id: f.operation, status: 'running', reconciliationRequired: true },
    outcome: 'unknown',
  })
  expect((await command(crypto.randomUUID())).status).toBe(404)
})

it('counts 100 tombstones without reclaiming quota or mutating history', async () => {
  for (let i = 0; i < 100; i++) await seed('deleted')
  const body = (await (await list()).json()) as Listing
  expect(body.capacity).toEqual({
    limit: 100,
    consumed: 100,
    remaining: 0,
    includesTombstones: true,
  })
  expect((await f.upload()).status).toBe(429)
  expect(await f.db.prepare('SELECT count(*) n FROM cms_media').first('n')).toBe(100)
})

it('returns the existing failed receipt without retrying a rejected upload', async () => {
  expect((await handleLocalMedia(f.request('POST', new Uint8Array([1, 2, 3])), f.env)).status).toBe(
    400,
  )
  const response = await command()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    media: { id: f.id, state: 'rejected', profiles: [] },
    operation: { id: f.operation, status: 'failed' },
  })
  expect(await f.db.prepare('SELECT count(*) n FROM cms_media_jobs').first('n')).toBe(1)
})

it('denies an actually expired session on every query, without serving bytes', async () => {
  expect((await f.upload()).status).toBe(200)
  await f.db.prepare('UPDATE admin_sessions SET expires_at=created_at+1').run()
  expect((await list()).status).toBe(401)
  expect((await image()).status).toBe(401)
  expect((await command()).status).toBe(401)
  expect(await f.db.prepare('SELECT count(*) n FROM cms_media_checks').first('n')).toBe(1)
})
