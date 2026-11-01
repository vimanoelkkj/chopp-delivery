import { existsSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import sharp from 'sharp'
import { localImageWorker } from '../../scripts/local-image-worker.mjs'
import {
  handleLocalMedia,
  type LocalMediaEnv,
  type MediaBucket,
} from '../../server/cms/media-library'
import { applyTestMigration, TEST_ORIGIN } from './auth-fixture'
import { cmsFixture } from './cms-fixture'

export async function mediaFixture() {
  const f = await cmsFixture()
  await applyTestMigration(f.db, '0007_cms_media_local.sql')
  if (existsSync('migrations/0008_cms_media_atomic.sql'))
    await applyTestMigration(f.db, '0008_cms_media_atomic.sql')
  const runtime = new Miniflare({
    r2Persist: false,
    workers: [
      {
        name: 'entry',
        modules: true,
        script: 'export default {fetch(){return new Response(null,{status:404})}}',
        r2Buckets: { BUCKET: 'stage3' },
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
  const env: LocalMediaEnv & {
    CMS_MEDIA_BUCKET: MediaBucket
    CMS_MEDIA_PROCESSOR: Pick<Fetcher, 'fetch'>
  } = {
    ...f.env,
    CMS_MEDIA_LOCAL: 'disposable-v1',
    CMS_MEDIA_BUCKET: await runtime.getR2Bucket('BUCKET', 'entry'),
    CMS_MEDIA_PROCESSOR: bindings.PROCESSOR as Pick<Fetcher, 'fetch'>,
  }
  const png = new Uint8Array(
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#803020' } })
      .png()
      .toBuffer(),
  )
  const operation = crypto.randomUUID(),
    id = `media_${operation}`
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
  const get = () => handleLocalMedia(request('GET'), env, id)
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
  const state = () =>
    f.db
      .prepare(
        'SELECT m.state,j.status FROM cms_media m JOIN cms_media_jobs j USING(media_id) WHERE j.operation_id=?',
      )
      .bind(operation)
      .first<{ state: string; status: string }>()
  const manifest = async () =>
    JSON.parse(
      (await f.db
        .prepare('SELECT derivatives_json FROM cms_media WHERE media_id=?')
        .bind(id)
        .first<string>('derivatives_json')) ?? '{}',
    )
  return {
    ...f,
    env,
    png,
    operation,
    id,
    request,
    upload,
    get,
    reconcile,
    state,
    manifest,
    close: async () => {
      await runtime.dispose()
      await f.runtime.dispose()
    },
  }
}
