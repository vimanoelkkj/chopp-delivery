import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { handleLogin } from '../../server/auth/handlers'
import { handlePublicCatalog } from '../../server/catalog-expansion/handlers'
import { handleCatalogMedia } from '../../server/catalog-media/handlers'
import { handleCmsPublish } from '../../server/cms/handlers'
import { handleLocalMedia, type LocalMediaEnv } from '../../server/cms/media-library'
import { handlePublicMedia, type PublicMediaEnv } from '../../server/cms/public-media'
import { authRequest, loginBody, TEST_ORIGIN } from './auth-fixture'
import { cp3Fixture, draft, site } from './cms-v2-api-fixture'
import { applySql, splitSql } from './cms-v2-sql-fixture'

// F4A.6.4C: imagem principal por produto. D1 e R2 descartáveis (Miniflare), nada remoto.
const PATH = '/api/admin/catalog/media'
vi.setConfig({ testTimeout: 120_000 }) // cada teste sobe D1, R2 e o processador de imagens

async function fixture(options: { migration?: boolean } = {}) {
  const f = await cp3Fixture()
  try {
    await applySql(f.db, readFileSync('migrations/0011_cms_delivery_region.sql', 'utf8'))
    await f.db.prepare("INSERT INTO d1_migrations VALUES('0011_cms_delivery_region.sql')").run()
    await applySql(
      f.db,
      splitSql(readFileSync('migrations/0012_cms_publication.sql', 'utf8')).join(''),
    )
    await f.db.prepare("INSERT INTO d1_migrations VALUES('0012_cms_publication.sql')").run()
    if (options.migration !== false) {
      await applySql(
        f.db,
        splitSql(readFileSync('migrations/0013_catalog_item_media.sql', 'utf8')).join(''),
      )
      await f.db.prepare("INSERT INTO d1_migrations VALUES('0013_catalog_item_media.sql')").run()
    }
    const env = f.env as unknown as LocalMediaEnv & PublicMediaEnv
    const secondLogin = await handleLogin(authRequest('login', { body: loginBody() }), f.env)
    const secondCookie = secondLogin.headers.get('set-cookie') ?? ''

    const upload = async (bytes: Uint8Array<ArrayBuffer> = f.base.png) => {
      const operation = crypto.randomUUID()
      const response = await handleLocalMedia(
        new Request(`${TEST_ORIGIN}/api/admin/media`, {
          method: 'POST',
          body: bytes,
          headers: {
            Cookie: f.base.cookie,
            Origin: TEST_ORIGIN,
            'Content-Type': 'image/png',
            'X-Operation-Id': operation,
            'If-None-Match': '*',
          },
        }),
        env,
      )
      return { id: `media_${operation}`, operation, status: response.status }
    }
    const request = (
      method: string,
      itemId: string | null,
      body?: unknown,
      headers: Record<string, string> = {},
      cookie = f.base.cookie,
    ) =>
      new Request(`${TEST_ORIGIN}${PATH}${itemId ? `/${itemId}` : ''}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          Origin: TEST_ORIGIN,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const call = (
      method: string,
      itemId: string | null,
      revision?: string,
      body?: unknown,
      options: { cookie?: string; env?: LocalMediaEnv } = {},
    ) =>
      handleCatalogMedia(
        request(
          method,
          itemId,
          body,
          revision === undefined ? {} : { 'If-Match': `"${revision}"` },
          options.cookie,
        ),
        options.env ?? env,
        itemId ?? undefined,
      )
    const put = (itemId: string, revision: string, mediaId: string, alt = 'Foto do produto') =>
      call('PUT', itemId, revision, { mediaId, alt })
    const media = (id: string, profile = 'section') =>
      handlePublicMedia(
        new Request(`${TEST_ORIGIN}/api/site/media/${id}/${profile}`),
        env,
        id,
        profile,
      )
    const catalog = async () =>
      (await (
        await handlePublicCatalog(new Request(`${TEST_ORIGIN}/api/catalog`), f.db)
      ).json()) as {
        categories: { items: { id: string; image?: { id: string; alt: string } }[] }[]
      }
    const removeMedia = (media: { id: string; operation: string }) =>
      handleLocalMedia(
        new Request(`${TEST_ORIGIN}/api/admin/media/${media.id}`, {
          method: 'DELETE',
          headers: {
            Cookie: f.base.cookie,
            Origin: TEST_ORIGIN,
            'X-Operation-Id': crypto.randomUUID(),
            'If-Match': `"${media.operation}"`,
          },
        }),
        env,
        media.id,
      )
    const rows = async () =>
      (await f.db.prepare('SELECT * FROM catalog_item_media ORDER BY item_id').all()).results
    const setVisible = (itemId: string, visible: 0 | 1) =>
      f.db.prepare('UPDATE catalog_items SET visible = ? WHERE id = ?').bind(visible, itemId).run()

    // Publicação editorial com uma mídia no hero (para provar a autorização independente).
    const documentWith = (mediaId: string) => {
      const document = structuredClone(f.document)
      document.commercial.whatsappNumber = '5531999999999'
      for (const module of document.modules) {
        if (module.template === 'hero')
          module.content = {
            heading: 'Conteúdo aprovado',
            summary: 'Texto editorial',
            media: { id: mediaId, alt: 'Imagem editorial' },
            deliveryRegion: 'Região de teste',
          }
        if (module.template === 'catalog') module.content = { heading: 'Catálogo', intro: 'Opções' }
        if (module.template === 'contact') module.content = { heading: 'Contato', body: 'Converse' }
      }
      return document
    }
    let revision: string | undefined
    const publishEditorial = async (mediaId: string) => {
      const document = documentWith(mediaId)
      if (!revision) {
        const conversion = await f.convert()
        revision = conversion.result.command.revision as string
      }
      const saved = await f.call(
        'PUT',
        draft,
        {
          action: 'saveDraft',
          operationId: crypto.randomUUID(),
          expectedRevision: revision,
          document,
        },
        revision,
      )
      expect(saved.status).toBe(200)
      revision = (await saved.json()).command.revision as string
      const body = {
        action: 'publish' as const,
        operationId: crypto.randomUUID(),
        expectedRevision: revision,
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
        env,
      )
      expect(response.status).toBe(200)
      revision = ((await response.json()) as { command: { revision: string } }).command.revision
    }
    return {
      ...f,
      env,
      secondCookie,
      upload,
      call,
      put,
      media,
      catalog,
      removeMedia,
      rows,
      setVisible,
      publishEditorial,
    }
  } catch (error) {
    await f.close()
    throw error
  }
}

type Body = { itemId: string; mediaId: string | null; alt: string | null; revision: string }

it('associa, substitui, altera só o alt, remove e nunca reaproveita um token antigo', async () => {
  const f = await fixture()
  try {
    const [a, b] = [await f.upload(), await f.upload()]
    const first = await f.call('GET', 'dronken')
    expect(first.status).toBe(200)
    expect(((await first.json()) as Body).revision).toBe('m0')

    const created = await f.put('dronken', 'm0', a.id, 'Barril A')
    expect(created.status).toBe(200)
    expect(created.headers.get('ETag')).toBe('"m1"')
    expect(await created.json()).toEqual({
      itemId: 'dronken',
      mediaId: a.id,
      alt: 'Barril A',
      revision: 'm1',
    })
    // Só o alt: a revisão cresce.
    const altOnly = await f.put('dronken', 'm1', a.id, 'Barril A, de frente')
    expect(((await altOnly.json()) as Body).revision).toBe('m2')
    // Mesma imagem e mesmo alt na revisão atual: idempotente, sem revisão nova.
    const same = await f.put('dronken', 'm2', a.id, 'Barril A, de frente')
    expect(same.status).toBe(200)
    expect(((await same.json()) as Body).revision).toBe('m2')
    // Substituição.
    const replaced = await f.put('dronken', 'm2', b.id, 'Barril B')
    expect(await replaced.json()).toMatchObject({ mediaId: b.id, alt: 'Barril B', revision: 'm3' })
    // Remoção mantém a linha (tombstone) e a revisão continua crescendo.
    const removed = await f.call('DELETE', 'dronken', 'm3')
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({
      itemId: 'dronken',
      mediaId: null,
      alt: null,
      revision: 'm4',
    })
    expect(await f.rows()).toHaveLength(1)
    // Token antigo não volta a valer, nem depois de reassociar.
    expect((await f.put('dronken', 'm3', a.id)).status).toBe(409)
    expect((await f.put('dronken', 'm4', a.id)).status).toBe(200)
    expect((await f.put('dronken', 'm3', b.id)).status).toBe(409)
    expect(((await (await f.call('GET', 'dronken')).json()) as Body).revision).toBe('m5')
    // Sem imagem: remover de novo não é um sucesso silencioso.
    const none = await f.call('DELETE', 'brahma', 'm0')
    expect(none.status).toBe(404)
    const list = (await (await f.call('GET', null)).json()) as { associations: Body[] }
    expect(list.associations.map((x) => [x.itemId, x.revision])).toEqual([['dronken', 'm5']])
  } finally {
    await f.close()
  }
})

it('duas sessões na mesma revisão: uma vence, a outra recebe 409 e nada é sobrescrito', async () => {
  const f = await fixture()
  try {
    const [a, b] = [await f.upload(), await f.upload()]
    const winner = await f.put('dronken', 'm0', a.id, 'Primeira sessão')
    expect(winner.status).toBe(200)
    const loser = await f.call(
      'PUT',
      'dronken',
      'm0',
      { mediaId: b.id, alt: 'Segunda sessão' },
      { cookie: f.secondCookie },
    )
    expect(loser.status).toBe(409)
    expect(((await loser.json()) as { error: { code: string } }).error.code).toBe(
      'CATALOG_MEDIA_CONFLICT',
    )
    expect(await f.rows()).toMatchObject([{ media_id: a.id, alt: 'Primeira sessão', revision: 1 }])
    // A segunda sessão relê e então consegue, sobre a revisão nova.
    expect(
      (
        await f.call(
          'PUT',
          'dronken',
          'm1',
          { mediaId: b.id, alt: 'Segunda sessão' },
          { cookie: f.secondCookie },
        )
      ).status,
    ).toBe(200)
  } finally {
    await f.close()
  }
})

it('recusa produto inexistente, mídia ausente ou não pronta, alt inválido e pedidos malformados', async () => {
  const f = await fixture()
  try {
    const good = await f.upload()
    const bad = await f.upload(
      new TextEncoder().encode('isto não é uma imagem') as Uint8Array<ArrayBuffer>,
    )
    expect(bad.status).toBe(400) // rejeitada pelo processamento: existe, mas nunca fica pronta
    const ghost = `media_${crypto.randomUUID()}`
    expect((await f.put('nao-existe', 'm0', good.id)).status).toBe(404)
    for (const id of [bad.id, ghost]) {
      const refused = await f.put('dronken', 'm0', id)
      expect(refused.status, id).toBe(400)
      expect(JSON.stringify(await refused.json())).toContain('mediaId')
    }
    for (const alt of ['', '   ', 'x'.repeat(201), 'com\u0000controle']) {
      expect((await f.put('dronken', 'm0', good.id, alt)).status, JSON.stringify(alt)).toBe(400)
    }
    expect((await f.call('PUT', 'dronken', 'm0', { mediaId: good.id })).status).toBe(400)
    expect(
      (await f.call('PUT', 'dronken', 'm0', { mediaId: good.id, alt: 'ok', extra: 1 })).status,
    ).toBe(400)
    expect(
      (await f.call('PUT', 'dronken', undefined, { mediaId: good.id, alt: 'ok' })).status,
    ).toBe(428)
    const badToken = await handleCatalogMedia(
      new Request(`${TEST_ORIGIN}${PATH}/dronken`, {
        method: 'PUT',
        headers: {
          Cookie: f.base.cookie,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
          'If-Match': 'W/"m0"',
        },
        body: JSON.stringify({ mediaId: good.id, alt: 'ok' }),
      }),
      f.env,
      'dronken',
    )
    expect(badToken.status).toBe(400)
    expect(await f.rows()).toEqual([])
    // Sessão e origem continuam exigidas.
    expect((await f.call('GET', 'dronken', undefined, undefined, { cookie: '' })).status).toBe(401)
    const foreign = await handleCatalogMedia(
      new Request(`${TEST_ORIGIN}${PATH}/dronken`, {
        method: 'PUT',
        headers: {
          Cookie: f.base.cookie,
          Origin: 'https://outro.invalid',
          'Content-Type': 'application/json',
          'If-Match': '"m0"',
        },
        body: JSON.stringify({ mediaId: good.id, alt: 'ok' }),
      }),
      f.env,
      'dronken',
    )
    expect(foreign.status).toBe(403)
    expect((await f.call('PATCH', 'dronken', 'm0')).status).toBe(405)
    expect((await f.call('POST', null)).status).toBe(405)
  } finally {
    await f.close()
  }
})

it('produto oculto mantém a associação, mas só o produto visível autoriza a entrega pública', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    expect((await f.put('dronken', 'm0', a.id)).status).toBe(200)
    // Visível: a entrega pública existe (os dois perfis) e o catálogo expõe `image`.
    for (const profile of ['hero', 'section']) {
      const response = await f.media(a.id, profile)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/webp')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    }
    const visible = (await f.catalog()).categories[0].items.find((i) => i.id === 'dronken')
    expect(visible?.image).toEqual({ id: a.id, alt: 'Foto do produto' })
    // Oculto: a associação continua, a entrega e o catálogo público deixam de mostrar.
    await f.setVisible('dronken', 0)
    expect((await f.media(a.id)).status).toBe(404)
    expect((await f.catalog()).categories[0].items.some((i) => i.id === 'dronken')).toBe(false)
    expect(await f.rows()).toMatchObject([{ item_id: 'dronken', media_id: a.id, revision: 1 }])
    expect(((await (await f.call('GET', 'dronken')).json()) as Body).mediaId).toBe(a.id)
    // Visível de novo: volta a valer.
    await f.setVisible('dronken', 1)
    expect((await f.media(a.id)).status).toBe(200)
  } finally {
    await f.close()
  }
})

it('a publicação editorial continua autorizando a mesma mídia mesmo com o produto oculto', async () => {
  const f = await fixture()
  try {
    const shared = await f.upload()
    const other = await f.upload()
    expect((await f.put('dronken', 'm0', shared.id)).status).toBe(200)
    await f.publishEditorial(shared.id)
    await f.setVisible('dronken', 0)
    // Oculto, mas a versão publicada referencia a mídia: segue sendo entregue.
    expect((await f.media(shared.id, 'hero')).status).toBe(200)
    // Troca a publicação para outra mídia: sem referência editorial e com produto oculto, 404.
    await f.publishEditorial(other.id)
    expect((await f.media(shared.id, 'hero')).status).toBe(404)
    expect((await f.media(other.id, 'hero')).status).toBe(200)
    // O produto visível autoriza por conta própria, sem depender da publicação.
    await f.setVisible('dronken', 1)
    expect((await f.media(shared.id, 'hero')).status).toBe(200)
  } finally {
    await f.close()
  }
})

it('mídia associada não é excluída (MEDIA_REFERENCED); solta a associação, é liberada', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    const b = await f.upload()
    expect((await f.put('dronken', 'm0', a.id)).status).toBe(200)
    const blocked = await f.removeMedia(a)
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'MEDIA_REFERENCED',
    )
    expect(
      (
        (await f.db
          .prepare('SELECT state FROM cms_media WHERE media_id = ?')
          .bind(a.id)
          .first()) as {
          state: string
        }
      ).state,
    ).toBe('ready')
    // Substituir libera a antiga; a nova passa a ser protegida.
    expect((await f.put('dronken', 'm1', b.id)).status).toBe(200)
    expect((await f.removeMedia(b)).status).toBe(409)
    expect((await f.removeMedia(a)).status).toBe(200)
    // Remover a associação libera a atual.
    expect((await f.call('DELETE', 'dronken', 'm2')).status).toBe(200)
    expect((await f.removeMedia(b)).status).toBe(200)
    // Mídia excluída não pode ser associada.
    expect((await f.put('dronken', 'm3', b.id)).status).toBe(400)
  } finally {
    await f.close()
  }
})

it('o SQL protege a associação mesmo sem passar pelo handler', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    expect((await f.put('dronken', 'm0', a.id)).status).toBe(200)
    await expect(f.db.prepare('DELETE FROM catalog_item_media').run()).rejects.toThrow()
    await expect(
      f.db.prepare("UPDATE catalog_item_media SET alt = 'x', revision = revision + 5").run(),
    ).rejects.toThrow()
    await expect(
      f.db
        .prepare(
          "INSERT INTO catalog_item_media (item_id, media_id, alt, revision, updated_at) VALUES ('brahma', ?, 'ok', 1, 0)",
        )
        .bind(`media_${crypto.randomUUID()}`)
        .run(),
    ).rejects.toThrow()
    // Comando sem sessão válida é recusado no próprio gatilho.
    await expect(
      f.db
        .prepare(
          "UPDATE catalog_media_write SET media_id = ?, alt = 'x', session_hash = 'zzz', user_id = 'zzz', origin = 'http://x' WHERE item_id = 'brahma' AND revision = 0",
        )
        .bind(a.id)
        .run(),
    ).rejects.toThrow(/CATALOG_UNAUTHORIZED/)
    expect(await f.rows()).toMatchObject([{ item_id: 'dronken', revision: 1 }])
  } finally {
    await f.close()
  }
})

it('catálogo público: sem imagem a resposta é idêntica e só há `image` quando há associação', async () => {
  const f = await fixture()
  try {
    const before = await f.catalog()
    expect(JSON.stringify(before)).not.toContain('"image"')
    const a = await f.upload()
    expect((await f.put('dronken', 'm0', a.id, 'Dronken em aço')).status).toBe(200)
    const withImage = await f.catalog()
    expect(withImage.categories[0].items.filter((i) => i.image)).toEqual([
      expect.objectContaining({ id: 'dronken', image: { id: a.id, alt: 'Dronken em aço' } }),
    ])
    expect((await f.call('DELETE', 'dronken', 'm1')).status).toBe(200)
    expect(await f.catalog()).toEqual(before)
  } finally {
    await f.close()
  }
})

it('sem a migration 0013: catálogo e entrega editorial intactos; o endpoint falha de forma controlada', async () => {
  const f = await fixture({ migration: false })
  try {
    const a = await f.upload()
    expect(JSON.stringify(await f.catalog())).not.toContain('"image"')
    for (const call of [
      f.call('GET', null),
      f.call('GET', 'dronken'),
      f.put('dronken', 'm0', a.id),
    ]) {
      const response = await call
      expect(response.status).toBe(503)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'CATALOG_MEDIA_UNAVAILABLE',
      )
    }
    // A mídia editorial publicada continua sendo entregue pelo caminho antigo.
    await f.publishEditorial(a.id)
    expect((await f.media(a.id, 'hero')).status).toBe(200)
    expect((await f.media(`media_${crypto.randomUUID()}`, 'hero')).status).toBe(404)
  } finally {
    await f.close()
  }
})

it('gate desabilitado bloqueia só a escrita; leitura administrativa e entrega pública seguem', async () => {
  const f = await fixture()
  try {
    const a = await f.upload()
    expect((await f.put('dronken', 'm0', a.id)).status).toBe(200)
    // Gate fechado: sem o rótulo do laboratório descartável (a autenticação local continua valendo).
    const closed = { ...f.env, CMS_MEDIA_LOCAL: undefined }
    for (const response of [
      await f.call('PUT', 'dronken', 'm1', { mediaId: a.id, alt: 'novo' }, { env: closed }),
      await f.call('DELETE', 'dronken', 'm1', undefined, { env: closed }),
    ])
      expect(response.status).toBe(404)
    expect(await f.rows()).toMatchObject([{ revision: 1, alt: 'Foto do produto' }])
    expect((await f.call('GET', 'dronken', undefined, undefined, { env: closed })).status).toBe(200)
    expect((await f.call('GET', null, undefined, undefined, { env: closed })).status).toBe(200)
    // Entrega pública e catálogo não dependem do gate.
    const publicEnv = {
      DELEGAS_DB: f.db,
      CMS_MEDIA_BUCKET: f.env.CMS_MEDIA_BUCKET,
    } as PublicMediaEnv
    const response = await handlePublicMedia(
      new Request(`${TEST_ORIGIN}/api/site/media/${a.id}/section`),
      publicEnv,
      a.id,
      'section',
    )
    expect(response.status).toBe(200)
    expect((await f.catalog()).categories[0].items.find((i) => i.id === 'dronken')?.image?.id).toBe(
      a.id,
    )
  } finally {
    await f.close()
  }
})
