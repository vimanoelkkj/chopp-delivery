import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import { expect, it } from 'vitest'
import { localImageWorker } from '../../scripts/local-image-worker.mjs'
import {
  handleLocalMedia,
  type LocalMediaEnv,
  localMediaEnabled,
} from '../../server/cms/media-library'
import {
  handleMediaBytes,
  handleMediaCommand,
  handleMediaList,
} from '../../server/cms/media-queries'
import { mediaFixture } from './media-stage3-fixture'

const origin = 'https://chopp-delivery-homolog.pages.dev'
const capability = {
  ADMIN_ORIGIN: origin,
  CMS_MEDIA_ENVIRONMENT: 'homologation',
  CMS_MEDIA_ENABLED: 'enabled',
  CMS_MEDIA_BUCKET: {},
  CMS_MEDIA_PROCESSOR: {},
} as unknown as LocalMediaEnv
const request = (url = origin) => new Request(`${url}/api/admin/media`)

it('requires explicit homologation capabilities and the exact HTTPS canonical origin', () => {
  expect(localMediaEnabled(request(), capability)).toBe(true)
  for (const patch of [
    { CMS_MEDIA_ENABLED: undefined },
    { CMS_MEDIA_ENABLED: 'disabled' },
    { CMS_MEDIA_ENVIRONMENT: 'production' },
    { CMS_MEDIA_ENVIRONMENT: undefined },
    { CMS_MEDIA_BUCKET: undefined },
    { CMS_MEDIA_PROCESSOR: undefined },
    { ADMIN_ORIGIN: 'https://other.pages.dev' },
    { ADMIN_ALLOW_INSECURE_LOCAL: '1' },
    { CMS_MEDIA_LOCAL: 'disposable-v1' },
  ])
    expect(localMediaEnabled(request(), { ...capability, ...patch })).toBe(false)
  for (const url of [
    'http://chopp-delivery-homolog.pages.dev',
    'https://preview.chopp-delivery-homolog.pages.dev',
    'https://other.pages.dev',
    'https://chopp-delivery-homolog.pages.dev.evil.invalid',
  ]) {
    expect(localMediaEnabled(request(url), { ...capability, ADMIN_ORIGIN: url })).toBe(false)
  }
})

it('production media stays closed unless label, opt-in, exact production origin and bindings all match', () => {
  const production = 'https://chopp-delivery-prod.pages.dev'
  const open = {
    ...capability,
    ADMIN_ORIGIN: production,
    CMS_MEDIA_ENVIRONMENT: 'production',
  } as unknown as LocalMediaEnv
  expect(localMediaEnabled(request(production), open)).toBe(true)
  // Sem as variáveis de produção (a configuração atual) o recurso continua desligado.
  expect(
    localMediaEnabled(request(production), {
      ADMIN_ORIGIN: production,
    } as unknown as LocalMediaEnv),
  ).toBe(false)
  for (const patch of [
    { CMS_MEDIA_ENABLED: undefined },
    { CMS_MEDIA_ENABLED: 'disabled' },
    { CMS_MEDIA_ENVIRONMENT: 'homologation' },
    { CMS_MEDIA_BUCKET: undefined },
    { CMS_MEDIA_PROCESSOR: undefined },
    { ADMIN_ORIGIN: origin },
    { ADMIN_ALLOW_INSECURE_LOCAL: '1' },
    { CMS_MEDIA_LOCAL: 'disposable-v1' },
  ])
    expect(localMediaEnabled(request(production), { ...open, ...patch })).toBe(false)
  for (const url of [
    'http://chopp-delivery-prod.pages.dev',
    'https://main.chopp-delivery-prod.pages.dev',
    'https://chopp-delivery-prod.pages.dev.evil.invalid',
    origin,
  ])
    expect(localMediaEnabled(request(url), { ...open, ADMIN_ORIGIN: url })).toBe(false)
})

it('keeps native Images processing private with no deployment or remote activation by default', () => {
  const config = JSON.parse(readFileSync('config/cloudflare/media-processor.jsonc', 'utf8'))
  expect(config.workers_dev).toBe(false)
  expect(config.preview_urls).toBe(false)
  expect(config.routes).toEqual([])
  expect(config.triggers.crons).toEqual([])
  expect(config.vars.CMS_MEDIA_PROCESSOR_ENABLED).toBe('disabled')
  expect(config.images).toEqual({ binding: 'IMAGES', remote: false })
  const source = readFileSync('server/cms/image-worker.mjs', 'utf8')
  expect(source).not.toMatch(/sharp|node:|eval\(|new Function/)
  expect(source).toContain('env.IMAGES.input')
  expect(source).toMatch(/format:\s*'image\/webp'/)
})

it('runs the HTTPS F2 lifecycle through disposable D1/R2, preserving replay, CSRF and integrity', async () => {
  const f = await mediaFixture()
  try {
    await f.db.prepare('UPDATE admin_sessions SET origin=?').bind(origin).run()
    const env = {
      ...f.env,
      ...capability,
      CMS_MEDIA_BUCKET: f.env.CMS_MEDIA_BUCKET,
      CMS_MEDIA_PROCESSOR: f.env.CMS_MEDIA_PROCESSOR,
      ADMIN_ALLOW_INSECURE_LOCAL: undefined,
      CMS_MEDIA_LOCAL: undefined,
    }
    const cookie = f.cookie.replace('delegas_admin_local_session=', '__Host-delegas_admin_session=')
    const req = (method = 'GET', path = '', extra: Record<string, string> = {}) =>
      new Request(`${origin}/api/admin/media${path}`, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'image/png',
          'X-Operation-Id': f.operation,
          'If-None-Match': '*',
          ...extra,
        },
        ...(method === 'POST' ? { body: f.png } : {}),
      })
    expect((await handleMediaList(req('GET', '', { Cookie: '' }), env)).status).toBe(401)
    expect(
      (await handleLocalMedia(req('POST', '', { Origin: 'https://evil.invalid' }), env)).status,
    ).toBe(403)
    expect(
      (await handleLocalMedia(req('POST', '', { 'Sec-Fetch-Site': 'cross-site' }), env)).status,
    ).toBe(403)
    expect((await handleLocalMedia(req('POST'), env)).status).toBe(200)
    expect(await f.state()).toEqual({ state: 'ready', status: 'done' })
    expect((await handleLocalMedia(req('POST'), env)).status).toBe(200)
    const jobs = await f.db.prepare('SELECT count(*) n FROM cms_media_jobs').first<number>('n')
    expect(jobs).toBe(1)
    expect((await handleMediaCommand(req('GET'), env, f.operation)).status).toBe(200)
    const list = await handleMediaList(req(), env)
    expect(list.status).toBe(200)
    expect(JSON.stringify(await list.json())).not.toMatch(/objectKey|sha256|manifest|session_hash/)
    const bytes = await handleMediaBytes(req(), env, f.id, 'hero')
    expect(bytes.status).toBe(200)
    expect(bytes.headers.get('Content-Type')).toBe('image/webp')
    expect(bytes.headers.get('Cache-Control')).toBe('no-store')
    expect(bytes.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const manifest = await f.manifest()
    await f.env.CMS_MEDIA_BUCKET.put(manifest.hero.objectKey, new Uint8Array(manifest.hero.bytes), {
      httpMetadata: { contentType: 'image/webp' },
    })
    expect((await handleMediaBytes(req(), env, f.id, 'hero')).status).toBe(503)
    await f.db.prepare('DELETE FROM admin_sessions').run()
    expect((await handleMediaList(req(), env)).status).toBe(401)
  } finally {
    await f.close()
  }
})

it('the processor fails closed while disabled and accepts only bounded private profiles', async () => {
  const runtime = new Miniflare({
    modules: true,
    script: localImageWorker,
    images: { binding: 'IMAGES' },
  })
  try {
    expect(
      (await runtime.dispatchFetch('http://private/hero', { method: 'POST', body: 'bad' })).status,
    ).toBe(404)
  } finally {
    await runtime.dispose()
  }
  const enabled = new Miniflare({
    modules: true,
    script: localImageWorker,
    bindings: { CMS_MEDIA_PROCESSOR_ENABLED: 'enabled' },
    images: { binding: 'IMAGES' },
  })
  try {
    expect((await enabled.dispatchFetch('http://private/hero')).status).toBe(404)
    expect(
      (await enabled.dispatchFetch('http://private/arbitrary', { method: 'POST', body: 'bad' }))
        .status,
    ).toBe(404)
    expect(
      (await enabled.dispatchFetch('http://private/hero', { method: 'POST', body: 'bad' })).status,
    ).toBe(422)
    expect(
      (
        await enabled.dispatchFetch('http://private/hero', {
          method: 'POST',
          body: new Uint8Array(5242881),
        })
      ).status,
    ).toBe(413)
  } finally {
    await enabled.dispose()
  }
})
