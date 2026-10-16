import { expect, it } from 'vitest'
import { handleCmsCommand, handleCmsDraft, handleCmsSite } from '../../server/cms/handlers'
import { cmsRevision } from '../../server/cms/validation'
import type { CmsAdminSnapshot } from '../../shared/cms'
import { TEST_ORIGIN } from './auth-fixture'
import { cmsFixture, seedCmsMedia } from './cms-fixture'

it('GET é só leitura; primeira criação, atualização e snapshots imutáveis preservam catálogo e publicação', async () => {
  const f = await cmsFixture()
  try {
    const catalog = await f.catalog()
    const state = await f.db.prepare('SELECT * FROM cms_state').first()
    expect(f.initial.draft.document).toBeNull()
    expect(f.initial.published).toBeNull()
    expect(cmsRevision(f.initial.draft.revision)).toBe(true)
    await f.get()
    await f.get()
    expect(await f.db.prepare('SELECT * FROM cms_state').first()).toEqual(state)
    expect(await f.count('cms_versions')).toBe(0)
    const firstInput = f.command()
    const first = await f.save(firstInput)
    expect(first.response.status).toBe(200)
    expect(first.response.headers.get('cache-control')).toBe('no-store')
    expect(first.response.headers.get('etag')).toBe(`"${first.result.command.revision}"`)
    expect(first.result.site.draft.document).toEqual(firstInput.document)
    const secondInput = f.command(first.result.command.revision)
    Object.assign(secondInput.document.modules[0].content, {
      heading: 'Delegas: delivery de chope',
    })
    const second = await f.save(secondInput)
    expect(second.response.status).toBe(200)
    expect(second.result.command.revision).not.toBe(first.result.command.revision)
    expect(await f.count('cms_versions')).toBe(2)
    const versions = await f.db
      .prepare('SELECT * FROM cms_versions ORDER BY rowid')
      .all<{ document_json: string }>()
    expect(JSON.parse(versions.results[0].document_json)).toEqual(firstInput.document)
    expect(JSON.parse(versions.results[1].document_json)).toEqual(secondInput.document)
    await expect(f.db.prepare("UPDATE cms_versions SET document_json='{}'").run()).rejects.toThrow(
      /CMS_VERSION_IMMUTABLE/,
    )
    await expect(f.db.prepare('DELETE FROM cms_versions').run()).rejects.toThrow(
      /CMS_VERSION_IMMUTABLE/,
    )
    expect(((await (await f.get()).json()) as CmsAdminSnapshot).draft.document).toEqual(
      secondInput.document,
    )
    expect(
      await f.db.prepare('SELECT published_version_id,published_revision FROM cms_state').first(),
    ).toEqual({ published_version_id: null, published_revision: null })
    expect(await f.catalog()).toBe(catalog)
    expect(JSON.stringify(second.result)).not.toMatch(
      /command_hash|session_hash|actor_id|quarantine_key/,
    )
  } finally {
    await f.runtime.dispose()
  }
})
it('conflito de revisão obsoleta não insere versão nem recibo', async () => {
  const f = await cmsFixture()
  try {
    expect((await f.save(f.command())).response.status).toBe(200)
    const stale = await f.save(f.command())
    expect(stale.response.status).toBe(409)
    expect(await f.count('cms_versions')).toBe(1)
  } finally {
    await f.runtime.dispose()
  }
})
it('duas escritas concorrentes: uma revisão aceita e outra conflita', async () => {
  const f = await cmsFixture()
  try {
    const inputs = [f.command(), f.command()]
    Object.assign(inputs[1].document.modules[0].content, { heading: 'Outra intenção' })
    const results = await Promise.all(inputs.map(f.save))
    expect(results.map((r) => r.response.status).sort()).toEqual([200, 409])
    expect(await f.count('cms_versions')).toBe(1)
    const winner = results.find((r) => r.response.status === 200)
    expect(((await (await f.get()).json()) as CmsAdminSnapshot).draft).toEqual(
      winner?.result.site.draft,
    )
  } finally {
    await f.runtime.dispose()
  }
})
it('replay concorrente, ordem de chaves diferente e recuperação após resposta perdida retornam recibo original', async () => {
  const f = await cmsFixture()
  try {
    const input = f.command()
    const [a, b] = await Promise.all([f.save(input), f.save(input)])
    expect([a.response.status, b.response.status]).toEqual([200, 200])
    expect(a.result).toEqual(b.result)
    expect(await f.count('cms_versions')).toBe(1)
    const next = await f.save(f.command(a.result.command.revision))
    expect(next.response.status).toBe(200)
    const reordered = {
      document: input.document,
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
      action: input.action,
    }
    expect((await f.save(reordered)).result).toEqual(a.result)
    const recovered = await handleCmsCommand(f.request('GET'), f.env, input.operationId)
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toEqual(a.result)
    expect(((await (await f.get()).json()) as CmsAdminSnapshot).draft.revision).toBe(
      next.result.command.revision,
    )
    expect(await f.count('cms_versions')).toBe(2)
    input.document.commercial.whatsappNumber = '5511998765432'
    expect((await f.save(input)).response.status).toBe(409)
    expect(await f.count('cms_versions')).toBe(2)
  } finally {
    await f.runtime.dispose()
  }
})
it.each(['revoked', 'inactive', 'authVersion', 'expired', 'origin'])(
  'sessão %s após guard não escreve; SQL reavalia autorização',
  async (reason) => {
    const f = await cmsFixture()
    try {
      const before = await f.catalog()
      const db = new Proxy(f.db, {
        get(target, key, receiver) {
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              if (reason === 'revoked') await target.prepare('DELETE FROM admin_sessions').run()
              if (reason === 'inactive')
                await target.prepare('UPDATE admin_users SET active=0').run()
              if (reason === 'authVersion')
                await target.prepare('UPDATE admin_users SET auth_version=auth_version+1').run()
              if (reason === 'expired')
                await target.prepare('UPDATE admin_sessions SET expires_at=created_at+1').run()
              if (reason === 'origin')
                await target
                  .prepare("UPDATE admin_sessions SET origin='https://other.invalid'")
                  .run()
              return target.batch(statements)
            }
          return Reflect.get(target, key, receiver)
        },
      })
      const input = f.command()
      expect(
        (
          await handleCmsDraft(f.request('PUT', input, input.expectedRevision), {
            ...f.env,
            DELEGAS_DB: db,
          })
        ).status,
      ).toBe(401)
      expect(await f.count('cms_versions')).toBe(0)
      expect(
        (
          await f.db
            .prepare('SELECT draft_revision FROM cms_state')
            .first<{ draft_revision: string }>()
        )?.draft_revision,
      ).toBe(input.expectedRevision)
      expect(await f.catalog()).toBe(before)
    } finally {
      await f.runtime.dispose()
    }
  },
)
it('autenticação, CSRF, métodos e recuperação sem autorização não vazam dados', async () => {
  const f = await cmsFixture()
  try {
    const input = f.command()
    expect((await handleCmsSite(new Request(`${TEST_ORIGIN}/api/admin/site`), f.env)).status).toBe(
      401,
    )
    expect(
      (
        await handleCmsDraft(
          f.request('PUT', input, input.expectedRevision, { Origin: 'https://evil.invalid' }),
          f.env,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await handleCmsDraft(
          f.request('PUT', input, input.expectedRevision, { 'Sec-Fetch-Site': 'cross-site' }),
          f.env,
        )
      ).status,
    ).toBe(403)
    expect((await handleCmsDraft(f.request('POST'), f.env)).status).toBe(405)
    expect((await handleCmsSite(f.request('PUT'), f.env)).status).toBe(405)
    expect((await handleCmsCommand(f.request('GET'), f.env, crypto.randomUUID())).status).toBe(404)
    expect((await handleCmsCommand(f.request('GET'), f.env, '../x')).status).toBe(400)
    expect((await f.save(input)).response.status).toBe(200)
    await f.db.prepare('DELETE FROM admin_sessions').run()
    expect((await handleCmsCommand(f.request('GET'), f.env, input.operationId)).status).toBe(401)
    expect(await f.count('cms_versions')).toBe(1)
  } finally {
    await f.runtime.dispose()
  }
})
it('If-Match forte obrigatório, envelope coerente, publish proibido e documentos inválidos não escrevem', async () => {
  const f = await cmsFixture()
  try {
    const input = f.command()
    expect((await handleCmsDraft(f.request('PUT', input), f.env)).status).toBe(428)
    for (const match of [
      '*',
      `W/"${input.expectedRevision}"`,
      input.expectedRevision,
      `"${input.expectedRevision}", "${input.expectedRevision}"`,
      `"c1_${crypto.randomUUID()}"`,
    ])
      expect(
        (await handleCmsDraft(f.request('PUT', input, undefined, { 'If-Match': match }), f.env))
          .status,
      ).toBe(400)
    for (const body of [
      { ...input, action: 'publish' },
      { ...input, extra: true },
      { ...input, document: {} },
      {
        ...input,
        document: {
          ...input.document,
          commercial: { fulfillmentMode: 'pickup', whatsappNumber: null },
        },
      },
    ])
      expect(
        (await handleCmsDraft(f.request('PUT', body, input.expectedRevision), f.env)).status,
      ).toBe(400)
    expect(await f.count('cms_versions')).toBe(0)
  } finally {
    await f.runtime.dispose()
  }
})
it('referências deduplicadas e ocultas são preservadas; referências inexistentes/deleting não geram gravação parcial', async () => {
  const f = await cmsFixture()
  try {
    const media = `media_${crypto.randomUUID()}`,
      hidden = `media_${crypto.randomUUID()}`
    await seedCmsMedia(f.db, media)
    await seedCmsMedia(f.db, hidden)
    const input = f.command()
    Object.assign(input.document.modules[0].content, { media: { id: media, alt: '' } })
    input.document.modules.splice(
      2,
      0,
      {
        id: `module_${crypto.randomUUID()}`,
        template: 'about',
        region: 'details',
        visible: false,
        navigation: 'none',
        content: { heading: '', body: '', media: { id: hidden, alt: '' } },
      },
      {
        id: `module_${crypto.randomUUID()}`,
        template: 'highlight',
        region: 'details',
        visible: false,
        navigation: 'none',
        content: { heading: '', body: '', media: { id: media, alt: '' } },
      },
    )
    const saved = await f.save(input)
    expect(saved.response.status).toBe(200)
    expect(await f.count('cms_media_refs')).toBe(2)
    await expect(
      f.db.prepare("UPDATE cms_media SET state='deleting' WHERE media_id=?").bind(media).run(),
    ).rejects.toThrow(/CMS_MEDIA_REFERENCED/)
    await expect(
      f.db.prepare('DELETE FROM cms_media WHERE media_id=?').bind(media).run(),
    ).rejects.toThrow(/FOREIGN KEY/)
    const bad = f.command(saved.result.command.revision)
    Object.assign(bad.document.modules[0].content, {
      media: { id: `media_${crypto.randomUUID()}`, alt: '' },
    })
    expect((await f.save(bad)).response.status).toBe(400)
    const deleting = `media_${crypto.randomUUID()}`
    await seedCmsMedia(f.db, deleting, 'deleting')
    Object.assign(bad.document.modules[0].content, { media: { id: deleting, alt: '' } })
    expect((await f.save(bad)).response.status).toBe(400)
    expect(await f.count('cms_versions')).toBe(1)
    expect(await f.count('cms_media_refs')).toBe(2)
  } finally {
    await f.runtime.dispose()
  }
})
it.each([
  'version-abort',
  'version-ignore',
  'ref-ignore',
  'state-ignore',
  'session-during-trigger',
])('falha %s reverte snapshot, refs, estado e recibo', async (point) => {
  const f = await cmsFixture()
  try {
    const media = `media_${crypto.randomUUID()}`
    await seedCmsMedia(f.db, media)
    const input = f.command()
    Object.assign(input.document.modules[0].content, { media: { id: media, alt: '' } })
    const before = await f.catalog()
    const state = await f.db.prepare('SELECT * FROM cms_state').first()
    const table =
      point === 'ref-ignore'
        ? 'cms_media_refs'
        : point === 'state-ignore'
          ? 'cms_state'
          : 'cms_versions'
    const event = point === 'state-ignore' ? 'UPDATE' : 'INSERT'
    const effect =
      point === 'session-during-trigger'
        ? 'DELETE FROM admin_sessions'
        : point === 'version-abort'
          ? "SELECT RAISE(ABORT,'INJECTED_SECRET_SQL')"
          : 'SELECT RAISE(IGNORE)'
    await f.db
      .prepare(`CREATE TRIGGER cms_test_failure BEFORE ${event} ON ${table} BEGIN ${effect}; END;`)
      .run()
    const response = await handleCmsDraft(f.request('PUT', input, input.expectedRevision), f.env)
    expect(response.status).toBe(point === 'session-during-trigger' ? 401 : 503)
    expect(await response.text()).not.toMatch(/INJECTED|SQL|session_hash|cms_versions|FOREIGN/)
    expect(await f.count('cms_versions')).toBe(0)
    expect(await f.count('cms_media_refs')).toBe(0)
    expect(await f.db.prepare('SELECT * FROM cms_state').first()).toEqual(state)
    expect(await f.catalog()).toBe(before)
    expect(
      (await f.db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').first<{ n: number }>())?.n,
    ).toBe(1)
  } finally {
    await f.runtime.dispose()
  }
})
it('migration ausente e singleton inválido falham fechados; publicação permanece desabilitada no SQL', async () => {
  const f = await cmsFixture()
  try {
    const saved = await f.save(f.command())
    expect(saved.response.status).toBe(200)
    await expect(
      f.db
        .prepare(
          'UPDATE cms_state SET published_version_id=draft_version_id,published_revision=draft_revision',
        )
        .run(),
    ).rejects.toThrow(/CMS_PUBLICATION_DISABLED/)
    await expect(f.db.prepare('DELETE FROM cms_state').run()).rejects.toThrow(/CMS_STATE_REQUIRED/)
    await f.db.prepare("DELETE FROM d1_migrations WHERE name='0006_cms_foundation.sql'").run()
    expect((await f.get()).status).toBe(503)
    expect((await f.save(f.command(saved.result.command.revision))).response.status).toBe(503)
    expect(await f.count('cms_versions')).toBe(1)
  } finally {
    await f.runtime.dispose()
  }
})
