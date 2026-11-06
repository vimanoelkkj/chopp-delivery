import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { handleCmsPublish } from '../../server/cms/handlers'
import { handleLocalMedia } from '../../server/cms/media-library'
import { handlePublicMedia, type PublicMediaEnv } from '../../server/cms/public-media'
import { TEST_ORIGIN } from './auth-fixture'
import { cp3Fixture, draft, site } from './cms-v2-api-fixture'
import { applySql, splitSql } from './cms-v2-sql-fixture'

const url = (id: string, profile: string) => `${TEST_ORIGIN}/api/site/media/${id}/${profile}`
const get = (env: PublicMediaEnv, id: string, profile = 'hero', init: RequestInit = {}) =>
  handlePublicMedia(new Request(url(id, profile), init), env, id, profile)

async function fixture() {
  const f = await cp3Fixture()
  try {
    await applySql(f.db, readFileSync('migrations/0011_cms_delivery_region.sql', 'utf8'))
    await f.db.prepare("INSERT INTO d1_migrations VALUES('0011_cms_delivery_region.sql')").run()
    await applySql(
      f.db,
      splitSql(readFileSync('migrations/0012_cms_publication.sql', 'utf8')).join(''),
    )
    await f.db.prepare("INSERT INTO d1_migrations VALUES('0012_cms_publication.sql')").run()
    const upload = async () => {
      const operation = crypto.randomUUID()
      const response = await handleLocalMedia(
        new Request(`${TEST_ORIGIN}/api/admin/media`, {
          method: 'POST',
          body: f.base.png,
          headers: {
            Cookie: f.base.cookie,
            Origin: TEST_ORIGIN,
            'Content-Type': 'image/png',
            'X-Operation-Id': operation,
            'If-None-Match': '*',
          },
        }),
        f.env,
      )
      expect(response.status).toBe(200)
      return `media_${operation}`
    }
    const documentWith = (mediaId: string) => {
      const document = structuredClone(f.document)
      document.commercial.whatsappNumber = '5531999999999'
      for (const module of document.modules) {
        if (module.template === 'hero')
          module.content = {
            heading: 'Conteúdo aprovado',
            summary: 'Texto editorial',
            media: { id: mediaId, alt: 'Imagem de teste' },
            deliveryRegion: 'Região de teste',
          }
        if (module.template === 'catalog') module.content = { heading: 'Catálogo', intro: 'Opções' }
        if (module.template === 'contact') module.content = { heading: 'Contato', body: 'Converse' }
      }
      return document
    }
    type Doc = ReturnType<typeof documentWith>
    let revision: string | undefined
    const save = async (document: Doc) => {
      if (!revision) {
        const conversion = await f.convert()
        expect(conversion.response.status).toBe(200)
        revision = conversion.result.command.revision as string
      }
      const input = {
        action: 'saveDraft',
        operationId: crypto.randomUUID(),
        expectedRevision: revision,
        document,
      }
      const saved = await f.call('PUT', draft, input, revision)
      expect(saved.status).toBe(200)
      revision = (await saved.json()).command.revision as string
    }
    const publish = async (document: Doc) => {
      const body = {
        action: 'publish' as const,
        operationId: crypto.randomUUID(),
        expectedRevision: revision as string,
        document,
      }
      const response = await handleCmsPublish(
        new Request(`${TEST_ORIGIN}${site}/publish`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: {
            Cookie: f.base.cookie,
            Origin: TEST_ORIGIN,
            'Content-Type': 'application/json',
            'If-Match': `"${body.expectedRevision}"`,
          },
        }),
        f.env,
      )
      expect(response.status).toBe(200)
      revision = ((await response.json()) as { command: { revision: string } }).command.revision
    }
    return { ...f, upload, documentWith, save, publish }
  } catch (error) {
    await f.close()
    throw error
  }
}

it('serves only derivatives of the currently published version, with safe headers', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    const draftOnly = await f.upload()
    const orphan = await f.upload()
    await f.save(f.documentWith(a))
    // Nothing is published yet: every media is private.
    expect((await get(f.env, a)).status).toBe(404)
    await f.publish(f.documentWith(a))

    for (const profile of ['hero', 'section']) {
      const response = await get(f.env, a, profile)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/webp')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Cache-Control')).toBe('public, no-cache')
      expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
      expect(response.headers.get('Set-Cookie')).toBeNull()
      const bytes = new Uint8Array(await response.arrayBuffer())
      expect(bytes.length).toBe(Number(response.headers.get('Content-Length')))
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      expect(response.headers.get('ETag')).toBe(`"${digest}"`)
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    }
    // Conditional request: 304 without a body, still behind the authorization query.
    const etag = (await get(f.env, a)).headers.get('ETag') as string
    const cached = await get(f.env, a, 'hero', { headers: { 'If-None-Match': etag } })
    expect(cached.status).toBe(304)
    expect(await cached.text()).toBe('')
    const head = await get(f.env, a, 'hero', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    // Draft-only, unreferenced, malformed and unknown IDs/profiles look identical: 404.
    const bodies = new Set<string>()
    for (const [id, profile] of [
      [draftOnly, 'hero'],
      [orphan, 'section'],
      [a, 'original'],
      [a, 'constructor'],
      ['media_nope', 'hero'],
      [`media_${crypto.randomUUID()}`, 'hero'],
    ]) {
      const response = await get(f.env, id, profile)
      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      bodies.add(await response.text())
    }
    expect(bodies.size).toBe(1)
    // A draft that references another media does not authorize it before publication.
    await f.save(f.documentWith(draftOnly))
    expect((await get(f.env, draftOnly)).status).toBe(404)
    expect((await get(f.env, a)).status).toBe(200)

    expect((await get(f.env, a, 'hero', { method: 'POST' })).status).toBe(405)
  } finally {
    await f.close()
  }
})

it('revokes media when the publication is replaced', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    const b = await f.upload()
    await f.save(f.documentWith(a))
    await f.publish(f.documentWith(a))
    expect((await get(f.env, a)).status).toBe(200)
    expect((await get(f.env, b)).status).toBe(404)
    const next = f.documentWith(b)
    await f.save(next)
    await f.publish(next)
    expect((await get(f.env, a)).status).toBe(404)
    expect((await get(f.env, b)).status).toBe(200)
    // A cached validator from the replaced media must not authorize it any longer.
    const stale = await get(f.env, a, 'hero', { headers: { 'If-None-Match': '*' } })
    expect(stale.status).toBe(404)
  } finally {
    await f.close()
  }
})

it('refuses published media that is not ready or whose manifest is invalid', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    await f.save(f.documentWith(a))
    await f.publish(f.documentWith(a))
    expect((await get(f.env, a)).status).toBe(200)
    const original = await f.db
      .prepare('SELECT derivatives_json FROM cms_media WHERE media_id=?')
      .bind(a)
      .first<{ derivatives_json: string }>()
    const tamper = async (json: string, state = 'ready') => {
      // Simulates a corrupted database: immutability triggers normally forbid this write.
      const triggers = await f.db
        .prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='cms_media'")
        .all<{ name: string; sql: string }>()
      for (const { name } of triggers.results) await f.db.exec(`DROP TRIGGER "${name}"`)
      await f.db
        .prepare('UPDATE cms_media SET derivatives_json=?,state=? WHERE media_id=?')
        .bind(json, state, a)
        .run()
      for (const { sql } of triggers.results) await f.db.exec(sql.replace(/\s+/g, ' '))
    }
    const forged = JSON.parse(original?.derivatives_json ?? '{}')
    forged.hero.objectKey = 'cms/quarantine/other.webp'
    await tamper(JSON.stringify(forged))
    expect((await get(f.env, a)).status).toBe(404)
    expect((await get(f.env, a, 'section')).status).toBe(200)
    await tamper('{}')
    expect((await get(f.env, a, 'section')).status).toBe(404)
    await tamper(original?.derivatives_json ?? '{}')
    expect((await get(f.env, a)).status).toBe(200)
    await tamper(original?.derivatives_json ?? '{}', 'rejected')
    expect((await get(f.env, a)).status).toBe(404)
  } finally {
    await f.close()
  }
})

it('handles missing, corrupted and failing R2 objects without leaking details', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    await f.save(f.documentWith(a))
    await f.publish(f.documentWith(a))
    const bucket = f.env.CMS_MEDIA_BUCKET
    if (!bucket) throw Error('bucket')
    const withBucket = (wrapped: unknown) =>
      ({ ...f.env, CMS_MEDIA_BUCKET: wrapped }) as PublicMediaEnv

    const missing = await get(withBucket({ ...bucket, get: async () => null }), a)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('Cache-Control')).toBe('no-store')

    const corrupt = await get(
      withBucket({
        ...bucket,
        get: async (key: string) => {
          const object = await bucket.get(key)
          if (!object) return null
          const bytes = new Uint8Array(await object.arrayBuffer())
          bytes[bytes.length - 1] ^= 0xff
          return {
            key: object.key,
            size: object.size,
            httpMetadata: object.httpMetadata,
            arrayBuffer: async () => bytes.buffer,
          }
        },
      }),
      a,
    )
    expect(corrupt.status).toBe(404)

    const wrongType = await get(
      withBucket({
        ...bucket,
        get: async (key: string) => {
          const object = await bucket.get(key)
          return (
            object && {
              key: object.key,
              size: object.size,
              httpMetadata: { contentType: 'text/html' },
              arrayBuffer: () => object.arrayBuffer(),
            }
          )
        },
      }),
      a,
    )
    expect(wrongType.status).toBe(404)

    const failing = await get(
      withBucket({
        ...bucket,
        get: async () => {
          throw new Error('R2 internal failure secret-detail')
        },
      }),
      a,
    )
    expect(failing.status).toBe(503)
    expect(failing.headers.get('Cache-Control')).toBe('no-store')
    expect(await failing.text()).not.toMatch(/secret-detail|R2|cms\/derived|sha256/)

    expect((await get({ DELEGAS_DB: f.env.DELEGAS_DB }, a)).status).toBe(404)
  } finally {
    await f.close()
  }
})
