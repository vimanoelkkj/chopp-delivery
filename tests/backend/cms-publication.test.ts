import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { handleCmsPublish, handlePublicCms } from '../../server/cms/handlers'
import { handleLocalMedia } from '../../server/cms/media-library'
import { parseCmsDocument } from '../../server/cms/validation-v2'
import type { CmsVersionedCommandResult, PublicCmsV2 } from '../../shared/cms'
import { readPreviewSnapshot } from '../../src/features/admin/preview/model'
import { readSiteSnapshot } from '../../src/features/admin/site/siteModel'
import { TEST_ORIGIN } from './auth-fixture'
import { cp3Fixture, draft, site } from './cms-v2-api-fixture'
import { applySql, splitSql } from './cms-v2-sql-fixture'

const migration = () => readFileSync('migrations/0012_cms_publication.sql', 'utf8')
const publicRequest = () => new Request(`${TEST_ORIGIN}/api/site`)

async function fixture(options: { prefix?: number } = {}) {
  const f = await cp3Fixture()
  try {
    await applySql(f.db, readFileSync('migrations/0011_cms_delivery_region.sql', 'utf8'))
    await f.db.prepare("INSERT INTO d1_migrations VALUES('0011_cms_delivery_region.sql')").run()
    const operation = crypto.randomUUID()
    const upload = await handleLocalMedia(
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
    expect(upload.status).toBe(200)
    const document = structuredClone(f.document)
    document.commercial.whatsappNumber = '5531999999999'
    for (const module of document.modules) {
      if (module.template === 'hero')
        module.content = {
          heading: 'Conteúdo aprovado',
          summary: 'Texto editorial',
          media: { id: `media_${operation}`, alt: 'Imagem de teste' },
          deliveryRegion: 'Região de teste',
        }
      if (module.template === 'catalog') module.content = { heading: 'Catálogo', intro: 'Opções' }
      if (module.template === 'contact') module.content = { heading: 'Contato', body: 'Converse' }
    }
    document.modules.splice(document.modules.length - 1, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'highlight',
      visible: false,
      navigation: 'none',
      content: { heading: 'PRIVATE_HIDDEN', body: 'Não publicar este módulo', media: null },
    })
    expect(parseCmsDocument(document, 'publish').value).toBeDefined()
    const conversion = await f.convert()
    expect(conversion.response.status).toBe(200)
    const input = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: conversion.result.command.revision,
      document,
    }
    const saved = await f.call('PUT', draft, input, input.expectedRevision)
    expect(saved.status).toBe(200)
    const savedReceipt = await saved.json()
    await applySql(f.db, splitSql(migration()).slice(0, options.prefix).join(''))
    if (options.prefix === undefined)
      await f.db.prepare("INSERT INTO d1_migrations VALUES('0012_cms_publication.sql')").run()
    const command = () => ({
      action: 'publish' as const,
      operationId: crypto.randomUUID(),
      expectedRevision: savedReceipt.command.revision,
      document,
    })
    const publish = (body = command(), headers: Record<string, string> = {}) =>
      handleCmsPublish(
        new Request(`${TEST_ORIGIN}${site}/publish`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: {
            Cookie: f.base.cookie,
            Origin: TEST_ORIGIN,
            'Content-Type': 'application/json',
            'If-Match': `"${body.expectedRevision}"`,
            ...headers,
          },
        }),
        f.env,
      )
    return { ...f, document, savedReceipt, command, publish }
  } catch (error) {
    await f.close()
    throw error
  }
}

it('publishes an immutable snapshot and exposes only the published projection', async () => {
  const f = await fixture()
  try {
    expect((await handlePublicCms(publicRequest(), f.env)).status).toBe(404)
    const input = f.command()
    const response = await f.publish(input)
    expect(response.status).toBe(200)
    const receipt = (await response.json()) as CmsVersionedCommandResult
    if (receipt.site.schema !== 2) throw Error('Expected v2 receipt')
    expect(receipt.command.action).toBe('publish')
    expect(receipt.site.published?.document).toEqual(f.document)
    expect(readSiteSnapshot(receipt.site).kind).toBe('v2')
    expect(readPreviewSnapshot(receipt.site)?.document).toEqual(f.document)
    expect(receipt.command.revision).not.toBe(input.expectedRevision)
    expect(await (await f.publish(input)).json()).toEqual(receipt)
    const publicResponse = await handlePublicCms(publicRequest(), f.env)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.headers.get('ETag')).toBe(`"${receipt.command.revision}"`)
    const publicBody = (await publicResponse.json()) as PublicCmsV2
    expect(publicBody.modules[0].content).toMatchObject({ heading: 'Conteúdo aprovado' })
    expect(JSON.stringify(publicBody)).not.toMatch(
      /PRIVATE_HIDDEN|actor_id|session_hash|operationId|versionId|objectKey|sha256|command_hash|published_version_id/,
    )
    const edited = structuredClone(f.document)
    edited.modules[0].content = {
      ...edited.modules[0].content,
      heading: 'Rascunho privado',
    } as (typeof edited.modules)[0]['content']
    const save = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: receipt.command.revision,
      document: edited,
    }
    const saved = await f.call('PUT', draft, save, save.expectedRevision)
    expect(saved.status).toBe(200)
    expect((await saved.json()).site.published).toEqual(receipt.site.published)
    expect(await (await handlePublicCms(publicRequest(), f.env)).json()).toEqual(publicBody)
    expect(await (await f.publish(input)).json()).toEqual(receipt)
    expect(
      await (await f.call('GET', `${site}/commands/${save.operationId}`)).json(),
    ).toMatchObject({ site: { published: receipt.site.published } })
  } finally {
    await f.close()
  }
}, 30000)

const durable = async (db: D1Database) =>
  JSON.stringify(
    (
      await db.batch([
        db.prepare('SELECT * FROM cms_v2_versions ORDER BY version_id'),
        db.prepare('SELECT * FROM cms_v2_state'),
        db.prepare('SELECT * FROM cms_v2_media_refs ORDER BY version_id,media_id'),
      ])
    ).map((r) => r.results),
  )

it('rejects unauthenticated, cross-origin and mismatched preconditions before writing', async () => {
  const f = await fixture()
  try {
    const before = await durable(f.db)
    for (const [headers, status] of [
      [{ Cookie: '' }, 401],
      [{ Origin: 'https://evil.invalid' }, 403],
      [{ 'Sec-Fetch-Site': 'cross-site' }, 403],
      [{ 'If-Match': '' }, 400],
      [{ 'If-Match': `"c2_${crypto.randomUUID()}"` }, 400],
    ] as const)
      expect((await f.publish(f.command(), headers)).status).toBe(status)
    const absent = new Request(`${TEST_ORIGIN}${site}/publish`, {
      method: 'POST',
      body: JSON.stringify(f.command()),
      headers: { Cookie: f.base.cookie, Origin: TEST_ORIGIN, 'Content-Type': 'application/json' },
    })
    expect((await handleCmsPublish(absent, f.env)).status).toBe(428)
    expect(await durable(f.db)).toBe(before)
    expect(
      (await handlePublicCms(new Request(publicRequest(), { method: 'POST' }), f.env)).status,
    ).toBe(405)
  } finally {
    await f.close()
  }
}, 30000)

it('requires the exact saved publishable document and a fresh operation identity', async () => {
  const f = await fixture()
  try {
    const before = await durable(f.db)
    const changed = structuredClone(f.document)
    const hero = changed.modules.find((m) => m.template === 'hero')
    if (hero?.template !== 'hero') throw Error('Fixture hero missing')
    hero.content.heading = 'Alteração não salva'
    expect((await f.publish({ ...f.command(), document: changed })).status).toBe(409)
    hero.content.heading = ''
    expect((await f.publish({ ...f.command(), document: changed })).status).toBe(400)
    expect(
      (await f.publish({ ...f.command(), operationId: f.savedReceipt.command.operationId })).status,
    ).toBe(409)
    expect(await durable(f.db)).toBe(before)
    const command = f.command()
    expect((await f.publish(command)).status).toBe(200)
    const collision = await f.publish({
      ...command,
      document: f.document,
      expectedRevision: `c2_${crypto.randomUUID()}`,
    })
    expect(collision.status).toBe(409)
    expect(await collision.json()).toMatchObject({ error: { code: 'CMS_OPERATION_CONFLICT' } })
  } finally {
    await f.close()
  }
}, 30000)

it.each(['distinct', 'same', 'save'] as const)(
  'serializes publication against %s operation',
  async (race) => {
    const f = await fixture()
    try {
      const input = f.command()
      const other =
        race === 'save'
          ? f.call(
              'PUT',
              draft,
              { ...input, operationId: crypto.randomUUID(), action: 'saveDraft' },
              input.expectedRevision,
            )
          : f.publish(race === 'same' ? input : f.command())
      const responses = await Promise.all([f.publish(input), other])
      expect(responses.map((r) => r.status).sort()).toEqual(
        race === 'same' ? [200, 200] : [200, 409],
      )
      const count = await f.db
        .prepare("SELECT count(*) n FROM cms_v2_versions WHERE kind='published'")
        .first<number>('n')
      expect(count).toBeLessThanOrEqual(1)
      if (race !== 'save') expect(count).toBe(1)
    } finally {
      await f.close()
    }
  },
  30000,
)

it.each(['state-abort', 'state-ignore', 'refs-ignore'] as const)(
  'rolls back %s without changing the prior publication or history',
  async (fault) => {
    const f = await fixture()
    try {
      const first = await f.publish()
      expect(first.status).toBe(200)
      const receipt = (await first.json()) as CmsVersionedCommandResult
      const publicBefore = await (await handlePublicCms(publicRequest(), f.env)).text()
      const before = await durable(f.db)
      await f.db
        .prepare(
          fault === 'refs-ignore'
            ? "CREATE TRIGGER injected_publication BEFORE INSERT ON cms_v2_media_refs WHEN (SELECT kind FROM cms_v2_versions WHERE version_id=NEW.version_id)='published' BEGIN SELECT RAISE(IGNORE); END"
            : `CREATE TRIGGER injected_publication BEFORE UPDATE ON cms_v2_state WHEN NEW.published_version_id IS NOT OLD.published_version_id BEGIN SELECT RAISE(${fault === 'state-abort' ? "ABORT,'injected'" : 'IGNORE'}); END`,
        )
        .run()
      expect(
        (await f.publish({ ...f.command(), expectedRevision: receipt.command.revision })).status,
      ).toBe(503)
      expect(await durable(f.db)).toBe(before)
      expect(await (await handlePublicCms(publicRequest(), f.env)).text()).toBe(publicBefore)
      expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_write_guard').first('n')).toBe(0)
    } finally {
      await f.close()
    }
  },
  30000,
)

it('rechecks the session inside publication and rolls back a mid-command revocation', async () => {
  const f = await fixture()
  try {
    const before = await durable(f.db)
    await f.db
      .prepare(
        "CREATE TRIGGER revoke_publication AFTER INSERT ON cms_v2_versions WHEN NEW.kind='published' BEGIN DELETE FROM admin_sessions; END",
      )
      .run()
    expect((await f.publish()).status).toBe(401)
    expect(await durable(f.db)).toBe(before)
    expect(await f.db.prepare('SELECT count(*) n FROM admin_sessions').first('n')).toBe(1)
    expect((await handlePublicCms(publicRequest(), f.env)).status).toBe(404)
  } finally {
    await f.close()
  }
}, 30000)

it('refuses referenced media that is not ready without changing its state or the media gates', async () => {
  const f = await fixture()
  try {
    const id = `media_${crypto.randomUUID()}`
    await f.db
      .prepare("INSERT INTO cms_media(media_id,state,created_at) VALUES(?,'quarantined',1)")
      .bind(id)
      .run()
    const document = structuredClone(f.document)
    const hero = document.modules.find((m) => m.template === 'hero')
    if (hero?.template !== 'hero') throw Error('Fixture hero missing')
    hero.content.media = { id, alt: 'Ainda não processada' }
    const input = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: f.savedReceipt.command.revision,
      document,
    }
    const saved = await f.call('PUT', draft, input, input.expectedRevision)
    expect(saved.status).toBe(200)
    const receipt = await saved.json()
    const before = await durable(f.db)
    expect(
      (await f.publish({ ...f.command(), document, expectedRevision: receipt.command.revision }))
        .status,
    ).toBe(400)
    expect(await durable(f.db)).toBe(before)
    expect(
      await f.db.prepare('SELECT state FROM cms_media WHERE media_id=?').bind(id).first('state'),
    ).toBe('quarantined')
  } finally {
    await f.close()
  }
}, 30000)

it('checks catalog visibility atomically without writing commercial data', async () => {
  const f = await fixture()
  try {
    const document = structuredClone(f.document)
    document.modules.splice(1, 0, {
      id: `module_${crypto.randomUUID()}`,
      template: 'carousel',
      visible: true,
      navigation: 'primary',
      content: {
        heading: 'Barris',
        lead: 'Escolha',
        media: null,
        entries: [{ itemId: 'dronken', media: null }],
      },
    })
    const input = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: f.savedReceipt.command.revision,
      document,
    }
    const saved = await f.call('PUT', draft, input, input.expectedRevision)
    expect(saved.status).toBe(200)
    const receipt = await saved.json()
    const before = await durable(f.db)
    await f.db
      .prepare(
        "CREATE TRIGGER hide_publication_item BEFORE INSERT ON cms_v2_versions WHEN NEW.kind='published' BEGIN UPDATE catalog_items SET visible=0 WHERE id='dronken'; END",
      )
      .run()
    expect(
      (await f.publish({ ...f.command(), document, expectedRevision: receipt.command.revision }))
        .status,
    ).toBe(400)
    expect(await durable(f.db)).toBe(before)
    expect(
      await f.db.prepare("SELECT visible FROM catalog_items WHERE id='dronken'").first('visible'),
    ).toBe(1)
  } finally {
    await f.close()
  }
}, 30000)

it('keeps published pointers, versions and historical references guarded against direct SQL writes', async () => {
  const f = await fixture()
  try {
    expect((await f.publish()).status).toBe(200)
    const before = await durable(f.db)
    for (const sql of [
      'UPDATE cms_v2_state SET published_version_id=NULL,published_revision=NULL',
      "UPDATE cms_v2_versions SET kind='published'",
      'DELETE FROM cms_v2_versions',
      'DELETE FROM cms_v2_media_refs',
    ])
      await expect(f.db.prepare(sql).run()).rejects.toThrow(/CMS_/)
    expect(await durable(f.db)).toBe(before)
  } finally {
    await f.close()
  }
}, 30000)

it('recovers the immutable publication receipt after losing the committed response', async () => {
  const f = await fixture()
  try {
    let writing = false,
      lose = true
    f.env.DELEGAS_DB = new Proxy(f.db, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            if (sql.includes('UPDATE cms_v2_write')) writing = true
            return target.prepare(sql)
          }
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            const write = writing
            writing = false
            const result = await target.batch(statements)
            if (write && lose) {
              lose = false
              throw Error('injected response loss')
            }
            return result
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const input = f.command()
    expect((await f.publish(input)).status).toBe(503)
    expect((await handlePublicCms(publicRequest(), f.env)).status).toBe(200)
    const found = await f.call('GET', `${site}/commands/${input.operationId}`)
    expect(found.status).toBe(200)
    const receipt = await found.json()
    expect(receipt.command.action).toBe('publish')
    expect(await (await f.publish(input)).json()).toEqual(receipt)
    expect(
      await f.db
        .prepare("SELECT count(*) n FROM cms_v2_versions WHERE kind='published'")
        .first('n'),
    ).toBe(1)
  } finally {
    await f.close()
  }
}, 30000)

it.each(Array.from({ length: splitSql(migration()).length + 1 }, (_, i) => i))(
  'fails closed at publication migration prefix %s, including missing ledger',
  async (prefix) => {
    const f = await fixture({ prefix })
    try {
      const before = await durable(f.db)
      expect((await f.publish()).status).toBe(503)
      expect((await handlePublicCms(publicRequest(), f.env)).status).toBe(503)
      expect(await durable(f.db)).toBe(before)
    } finally {
      await f.close()
    }
  },
  30000,
)
