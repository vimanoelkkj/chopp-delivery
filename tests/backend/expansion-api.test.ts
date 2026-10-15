import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequest as cachacaV1Route } from '../../functions/api/admin/cachacas/[id]'
import { onRequest as catalogV1Route } from '../../functions/api/admin/catalog'
import { onRequest as productV1Route } from '../../functions/api/admin/products/[id]'
import { handleLogin, handleLogout } from '../../server/auth/handlers'
import { handleExpandedCatalog, handlePublicCatalog } from '../../server/catalog-expansion/handlers'
import { handleLegacyAdmin, handleLegacyPublic } from '../../server/catalog-expansion/legacy'
import type { ExpandedCatalog } from '../../shared/catalog'
import { authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'
import { expansionFixture } from './expansion-fixture'

// GET metadata is read-only and deliberately absent from PUT.
function writable(snapshot: ExpandedCatalog) {
  return {
    revision: snapshot.revision,
    categories: snapshot.categories.map((c) => ({
      ...c,
      items: c.items.map(({ creationRef: _ref, variants, ...item }) => ({
        ...item,
        variants: variants.map(({ creationRef: _ref, ...v }) => v),
      })),
    })),
  }
}
describe('catálogo v2 real em D1 descartável', () => {
  let f: Awaited<ReturnType<typeof expansionFixture>>, cookie: string
  const request = (method: string, body?: unknown, revision?: string, session = cookie) =>
    new Request(`${TEST_ORIGIN}/api/admin/catalog/v2`, {
      method,
      headers: {
        Origin: TEST_ORIGIN,
        Cookie: session,
        'Content-Type': 'application/json',
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const load = async () => {
    const r = await handleExpandedCatalog(request('GET'), f.env)
    expect(r.status).toBe(200)
    return (await r.json()) as ExpandedCatalog
  }
  const save = (body: unknown, revision: string) =>
    handleExpandedCatalog(request('PUT', body, revision), f.env)
  const state = async () =>
    (
      await f.db.batch(
        ['catalog_items', 'catalog_variants', 'catalog_meta'].map((t) =>
          f.db.prepare(`SELECT * FROM ${t}`),
        ),
      )
    ).map((r) => r.results)
  beforeEach(async () => {
    f = await expansionFixture()
    await seedOwner(f.db)
    cookie =
      (await handleLogin(authRequest('login', { body: loginBody() }), f.env)).headers.get(
        'set-cookie',
      ) ?? ''
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await f?.runtime.dispose()
  })
  it('preserva os nove itens, nulls, centavos e GET sem efeito; no-op mantém revisão', async () => {
    const before = await state(),
      s = await load()
    expect(s.categories.map((c) => c.items.length)).toEqual([8, 1])
    expect(s.categories[0].items.find((i) => i.id === 'brahma')?.variants[0].priceCents).toBeNull()
    expect(await state()).toEqual(before)
    const r = await save(writable(s), s.revision)
    expect(r.status).toBe(200)
    expect(((await r.json()) as { catalog: ExpandedCatalog }).catalog).toEqual(s)
    expect(await state()).toEqual(before)
  })
  it('atualiza centavos e ordem e publica a fonte nova, preservando legado congelado', async () => {
    const s = await load(),
      input = writable(s)
    input.categories[0].items[0].variants[0].priceCents = 51029
    input.categories[0].items.reverse()
    const r = await save(input, s.revision)
    expect(r.status).toBe(200)
    const next = ((await r.json()) as { catalog: ExpandedCatalog }).catalog
    expect(next.revision).not.toBe(s.revision)
    expect(next.categories[0].items.map((i) => i.id)).toEqual(
      input.categories[0].items.map((i) => i.id),
    )
    expect((await load()).categories).toEqual(next.categories)
    expect(
      await f.db
        .prepare('SELECT price_30_cents FROM products WHERE id=?')
        .bind('dronken')
        .first('price_30_cents'),
    ).toBe(51000)
  })
  it('cria item/variante, recupera refs em GET e retry perdido conflita sem duplicar', async () => {
    const s = await load(),
      input = writable(s)
    const clientId = `tmp:${crypto.randomUUID()}`,
      variantRef = `tmp:${crypto.randomUUID()}`
    const body = structuredClone(input) as {
      revision: string
      categories: { id: string; name: string; items: unknown[] }[]
    }
    body.categories[1].items.push({
      clientId,
      name: 'Segunda cachaça',
      description: 'Nova',
      visible: true,
      variants: [{ clientId: variantRef, label: 'Garrafa', volumeMl: 750, priceCents: 3001 }],
    })
    const r = await save(body, s.revision)
    expect(r.status).toBe(200)
    const next = (await r.json()) as {
      catalog: ExpandedCatalog
      created: { items: { clientId: string; id: string }[] }
    }
    expect(next.created.items[0]).toMatchObject({ clientId })
    expect(next.catalog.categories[1].items[1]).toMatchObject({
      creationRef: clientId,
      variants: [{ creationRef: variantRef, priceCents: 3001 }],
    })
    const before = await state()
    expect((await save(body, s.revision)).status).toBe(409)
    expect(await state()).toEqual(before)
    expect(await load()).toEqual(next.catalog)
    const publicResponse = await handlePublicCatalog(
      new Request(`${TEST_ORIGIN}/api/catalog`),
      f.db,
    )
    const text = await publicResponse.text()
    expect(text).toContain('Segunda cachaça')
    expect(text).not.toContain('creationRef')
  })
  it('omite variante persistente ou item: rejeita e preserva tudo', async () => {
    const s = await load(),
      before = await state(),
      input = writable(s)
    input.categories[0].items[0].variants.pop()
    expect((await save(input, s.revision)).status).toBe(400)
    expect(await state()).toEqual(before)
    const input2 = writable(s)
    input2.categories[0].items.pop()
    expect((await save(input2, s.revision)).status).toBe(400)
    expect(await state()).toEqual(before)
  })
  it('concorrência com a mesma revisão admite só um escritor', async () => {
    const s = await load(),
      a = writable(s),
      b = writable(s)
    a.categories[0].items[0].name = 'A'
    b.categories[0].items[0].name = 'B'
    expect(
      (await Promise.all([save(a, s.revision), save(b, s.revision)])).map((r) => r.status).sort(),
    ).toEqual([200, 409])
  })
  it('falha na quinta edição ou IGNORE reverte dados e revisão', async () => {
    const s = await load(),
      before = await state(),
      input = writable(s)
    for (const i of input.categories[0].items) i.description = 'modificada'
    input.categories[0].items.push({
      clientId: `tmp:${crypto.randomUUID()}`,
      name: 'Nova criação revertida',
      description: '',
      visible: true,
      variants: [
        { clientId: `tmp:${crypto.randomUUID()}`, label: '20 L', volumeMl: 20000, priceCents: 100 },
      ],
    } as unknown as (typeof input.categories)[0]['items'][number])
    await f.db.prepare('CREATE TABLE mutation_count(n INTEGER)').run()
    await f.db.prepare('INSERT INTO mutation_count VALUES(0)').run()
    await f.db
      .prepare(
        "CREATE TRIGGER inject_failure BEFORE UPDATE ON catalog_items BEGIN UPDATE mutation_count SET n=n+1; SELECT CASE WHEN (SELECT n FROM mutation_count)=5 THEN RAISE(ABORT,'INJECTED_FIFTH') END; END",
      )
      .run()
    expect((await save(input, s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
    expect(await f.db.prepare('SELECT n FROM mutation_count').first('n')).toBe(0)
    await f.db.prepare('DROP TRIGGER inject_failure').run()
    await f.db
      .prepare(
        "CREATE TRIGGER inject_ignore BEFORE UPDATE ON catalog_items WHEN OLD.id='brahma' BEGIN SELECT RAISE(IGNORE); END",
      )
      .run()
    expect((await save(input, s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
  })
  it.each(['logout', 'disable', 'expiry', 'version', 'origin'] as const)(
    'revogação %s depois do guard não admite escrita',
    async (mode) => {
      const s = await load(),
        before = await state(),
        input = writable(s)
      input.categories[0].items[0].name = 'Negado'
      const db = new Proxy(f.db, {
        get(target, key, receiver) {
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              if (mode === 'logout') await handleLogout(authRequest('logout', { cookie }), f.env)
              if (mode === 'disable') await target.prepare('UPDATE admin_users SET active=0').run()
              if (mode === 'expiry')
                await target.prepare('UPDATE admin_sessions SET created_at=0,expires_at=1').run()
              if (mode === 'version')
                await target.prepare('UPDATE admin_users SET auth_version=auth_version+1').run()
              if (mode === 'origin')
                await target
                  .prepare("UPDATE admin_sessions SET origin='https://invalid.example'")
                  .run()
              return target.batch(statements)
            }
          return Reflect.get(target, key, receiver)
        },
      })
      expect(
        (
          await handleExpandedCatalog(request('PUT', input, s.revision), {
            ...f.env,
            DELEGAS_DB: db,
          })
        ).status,
      ).toBe(401)
      expect(await state()).toEqual(before)
    },
  )
  it('revogação por trigger durante o comando aborta inclusive a criação', async () => {
    const s = await load(),
      before = await state(),
      body = writable(s)
    body.categories[0].items[0].name = 'Revogar'
    await f.db
      .prepare(
        'CREATE TRIGGER revoke_mid_write AFTER UPDATE ON catalog_items BEGIN DELETE FROM admin_sessions; END',
      )
      .run()
    expect((await save(body, s.revision)).status).toBe(401)
    expect(await state()).toEqual(before)
    expect((await load()).revision).toBe(s.revision)
  })
  it('autenticação, CSRF, precondição, métodos e JSON estritos', async () => {
    const s = await load(),
      body = writable(s),
      before = await state()
    expect(
      (await handleExpandedCatalog(request('GET', undefined, undefined, ''), f.env)).status,
    ).toBe(401)
    const csrf = request('PUT', body, s.revision)
    csrf.headers.set('Origin', 'https://invalid.example')
    expect((await handleExpandedCatalog(csrf, f.env)).status).toBe(403)
    expect((await handleExpandedCatalog(request('PUT', body), f.env)).status).toBe(428)
    const weak = request('PUT', body, s.revision)
    weak.headers.set('If-Match', `W/"${s.revision}"`)
    expect((await handleExpandedCatalog(weak, f.env)).status).toBe(400)
    for (const method of ['HEAD', 'OPTIONS', 'PATCH', 'POST', 'DELETE'])
      expect((await handleExpandedCatalog(request(method), f.env)).status).toBe(405)
    expect((await save({ ...body, extra: true }, s.revision)).status).toBe(400)
    expect((await save(s, s.revision)).status).toBe(400) // creationRef is read-only
    const malformed = request('PUT', undefined, s.revision)
    expect((await handleExpandedCatalog(new Request(malformed, { body: '{' }), f.env)).status).toBe(
      400,
    )
    expect(await state()).toEqual(before)
  })
  it.each([
    'duplicate-item',
    'duplicate-variant',
    'unknown-item',
    'wrong-parent',
    'category-name',
    'new-empty',
    'null-bottle',
    'no-price',
    'fraction',
    'negative',
    'unicode',
  ] as const)('rejeita %s sem efeitos', async (mode) => {
    const s = await load(),
      body = writable(s),
      before = await state()
    const item = body.categories[0].items[0]
    if (mode === 'duplicate-item') body.categories[0].items.push(structuredClone(item))
    if (mode === 'duplicate-variant') item.variants.push(structuredClone(item.variants[0]))
    if (mode === 'unknown-item') item.id = 'unknown'
    if (mode === 'wrong-parent')
      body.categories[1].items.push(body.categories[0].items.shift() as typeof item)
    if (mode === 'category-name') body.categories[0].name = 'Changed'
    if (mode === 'new-empty')
      body.categories[0].items.push({
        clientId: `tmp:${crypto.randomUUID()}`,
        name: 'New',
        description: '',
        visible: false,
        variants: [],
      } as unknown as typeof item)
    if (mode === 'null-bottle') body.categories[1].items[0].variants[0].priceCents = null
    if (mode === 'no-price') for (const v of item.variants) v.priceCents = null
    if (mode === 'fraction') item.variants[0].priceCents = 1.1
    if (mode === 'negative') item.variants[0].volumeMl = -1
    if (mode === 'unicode') item.name = '\ud800'
    expect((await save(body, s.revision)).status).toBe(400)
    expect(await state()).toEqual(before)
  })
  it('reutilização de ref persistida em outro produto ou com revisão nova não duplica', async () => {
    const s = await load(),
      body = writable(s),
      ref = `tmp:${crypto.randomUUID()}`
    const newVariant = { clientId: ref, label: '20 L', volumeMl: 20000, priceCents: 30000 }
    body.categories[0].items[0].variants.push(
      newVariant as unknown as (typeof body.categories)[0]['items'][number]['variants'][number],
    )
    const r = await save(body, s.revision)
    expect(r.status).toBe(200)
    const next = ((await r.json()) as { catalog: ExpandedCatalog }).catalog,
      before = await state()
    const retry = writable(next)
    retry.categories[0].items[1].variants.push(
      newVariant as unknown as (typeof retry.categories)[0]['items'][number]['variants'][number],
    )
    expect((await save(retry, next.revision)).status).toBe(400)
    expect(await state()).toEqual(before)
  })
  it('INSERT ignorado e erro na leitura posterior revertem criação, refs e edição', async () => {
    const s = await load(),
      body = writable(s),
      before = await state()
    body.categories[0].items[0].name = 'Não persistir'
    body.categories[0].items[0].variants.push({
      clientId: `tmp:${crypto.randomUUID()}`,
      label: '20 L',
      volumeMl: 20000,
      priceCents: 50000,
    } as unknown as (typeof body.categories)[0]['items'][number]['variants'][number])
    await f.db
      .prepare(
        'CREATE TRIGGER ignore_insert BEFORE INSERT ON catalog_variants BEGIN SELECT RAISE(IGNORE); END',
      )
      .run()
    expect((await save(body, s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
    await f.db.prepare('DROP TRIGGER ignore_insert').run()
    const db = new Proxy(f.db, {
      get(target, key, receiver) {
        if (key === 'batch')
          return (statements: D1PreparedStatement[]) =>
            target.batch([...statements, target.prepare('SELECT * FROM missing_snapshot')])
        return Reflect.get(target, key, receiver)
      },
    })
    expect(
      (await handleExpandedCatalog(request('PUT', body, s.revision), { ...f.env, DELEGAS_DB: db }))
        .status,
    ).toBe(503)
    expect(await state()).toEqual(before)
  })
  it('legado só lê projeção fiel; todos os escritores HTTP estão aposentados', async () => {
    const s = await load(),
      before = await state()
    for (const resource of ['catalog', 'products', 'cachacas'] as const)
      expect((await handleLegacyAdmin(request('GET'), f.env, resource)).status).toBe(200)
    expect((await handleLegacyPublic(request('GET'), f.db)).status).toBe(200)
    for (const [method, resource] of [
      ['PUT', 'catalog'],
      ['PATCH', 'item'],
    ] as const) {
      const response = await handleLegacyAdmin(request(method, writable(s)), f.env, resource)
      expect(response.status).toBe(410)
      expect(await response.text()).toContain('ENDPOINT_RETIRED')
    }
    expect(await state()).toEqual(before)
    for (const [method, route] of [
      ['PUT', catalogV1Route],
      ['PATCH', productV1Route],
      ['PATCH', cachacaV1Route],
    ] as const) {
      expect(
        (
          await route({ request: request(method, writable(s)), env: f.env } as Parameters<
            typeof route
          >[0])
        ).status,
      ).toBe(410)
    }
    await f.db
      .prepare(
        "INSERT INTO catalog_variants(item_id,code,label,volume_ml,price_cents,sort_order)VALUES('dronken','extra','20 L',20000,NULL,2)",
      )
      .run()
    expect((await handleLegacyPublic(request('GET'), f.db)).status).toBe(409)
    expect((await handleLegacyAdmin(request('GET'), f.env, 'catalog')).status).toBe(409)
    expect((await handlePublicCatalog(request('GET'), f.db)).status).toBe(200)
  })
  it('schema incompleto, metadados ou D1 ausentes fecham a leitura e a escrita', async () => {
    const s = await load(),
      before = await state()
    await f.db.prepare('DROP TRIGGER catalog_variants_revision_update').run()
    expect((await handlePublicCatalog(request('GET'), f.db)).status).toBe(503)
    expect((await save(writable(s), s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
  })
  it('schema sem a view de pós-condição não é considerado pronto', async () => {
    const s = await load(),
      before = await state()
    await f.db.prepare('DROP VIEW catalog_state').run()
    expect((await handlePublicCatalog(request('GET'), f.db)).status).toBe(503)
    expect((await save(writable(s), s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
  })
  it('ordem esparsa preservada no-op e variantes reordenadas de forma estável', async () => {
    await f.db.prepare('UPDATE catalog_items SET sort_order=50').run()
    const s = await load(),
      body = writable(s),
      before = await state()
    expect((await save(body, s.revision)).status).toBe(200)
    expect(await state()).toEqual(before)
    body.categories.reverse()
    body.categories.find((c) => c.id === 'chopes')?.items[0].variants.reverse()
    const r = await save(body, s.revision)
    expect(r.status).toBe(200)
    const next = ((await r.json()) as { catalog: ExpandedCatalog }).catalog
    expect(next.categories.map((c) => c.id)).toEqual(body.categories.map((c) => c.id))
    expect(next.categories[1].items[0].variants.map((v) => v.code)).toEqual(
      body.categories[1].items[0].variants.map((v) => v.code),
    )
    const noop = await save(writable(next), next.revision)
    expect(((await noop.json()) as { catalog: ExpandedCatalog }).catalog).toEqual(next)
    expect((await handleLegacyPublic(request('GET'), f.db)).status).toBe(409)
  })
  it('IGNORE do avanço de revisão aborta o salvamento inteiro', async () => {
    const s = await load(),
      body = writable(s),
      before = await state()
    body.categories[0].items[0].name = 'Não persistir com revisão velha'
    await f.db
      .prepare(
        'CREATE TRIGGER ignore_revision BEFORE UPDATE ON catalog_meta BEGIN SELECT RAISE(IGNORE); END',
      )
      .run()
    expect((await save(body, s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
  })
  it('metadata apagada por trigger ignorado não permite commit parcial', async () => {
    const s = await load(),
      body = writable(s),
      before = await state()
    body.categories[0].items[0].name = 'Não persistir sem singleton'
    await f.db
      .prepare(
        'CREATE TRIGGER delete_meta AFTER UPDATE ON catalog_items BEGIN DELETE FROM catalog_meta; SELECT RAISE(IGNORE); END',
      )
      .run()
    expect((await save(body, s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
  })
  it('AFTER IGNORE que pula o trigger de revisão também aborta o comando', async () => {
    const s = await load(),
      body = writable(s),
      before = await state()
    body.categories[0].items[0].name = 'Não persistir sem revisão'
    await f.db
      .prepare(
        'CREATE TRIGGER skip_revision AFTER UPDATE ON catalog_items BEGIN SELECT RAISE(IGNORE); END',
      )
      .run()
    expect((await save(body, s.revision)).status).toBe(503)
    expect(await state()).toEqual(before)
  })
  it('snapshots concorrentes sempre contêm uma revisão e estado correspondentes', async () => {
    const s = await load(),
      body = writable(s)
    body.categories[0].items[0].variants[0].priceCents = 12345
    const [saved, ...responses] = await Promise.all([
      save(body, s.revision),
      ...Array.from({ length: 5 }, () => handleExpandedCatalog(request('GET'), f.env)),
    ])
    expect(saved.status).toBe(200)
    const next = ((await saved.json()) as { catalog: ExpandedCatalog }).catalog
    for (const response of responses) {
      const snapshot = (await response.json()) as ExpandedCatalog
      expect(response.headers.get('ETag')).toBe(`"${snapshot.revision}"`)
      expect([JSON.stringify(s), JSON.stringify(next)]).toContain(JSON.stringify(snapshot))
    }
  })
  it('público inclui variantes null e categorias futuras, omite só ocultos e nunca escreve', async () => {
    await f.db.prepare("UPDATE catalog_items SET visible=0 WHERE id='brahma'").run()
    await f.db.prepare("INSERT INTO catalog_categories VALUES('future','Categoria futura',2)").run()
    await f.db
      .prepare("INSERT INTO catalog_items VALUES('future-id','future','Novo','',1,0,NULL)")
      .run()
    await f.db
      .prepare("INSERT INTO catalog_variants VALUES('future-id','unit','Unidade',NULL,199,0,NULL)")
      .run()
    const before = await state(),
      r = await handlePublicCatalog(request('GET'), f.db)
    const data = (await r.json()) as ExpandedCatalog
    expect(data.categories[0].items).toHaveLength(7)
    expect(data.categories[0].items.some((i) => i.id === 'brahma')).toBe(false)
    expect(
      data.categories[0].items.find((i) => i.id === 'kaiser')?.variants[0].priceCents,
    ).toBeNull()
    expect(data.categories[2].items[0]).toMatchObject({
      id: 'future-id',
      variants: [{ volumeMl: null, priceCents: 199 }],
    })
    expect(await state()).toEqual(before)
    expect((await load()).categories[0].items).toHaveLength(8)
  })
  it.each([
    "INSERT INTO products(id,name,description,visible)VALUES('blocked','Bloqueado','',0)",
    "UPDATE products SET name='Bloqueado'",
    'DELETE FROM products',
    "INSERT INTO cachaca(id,title,description,bottle_ml,price_cents,visible)VALUES('blocked','Bloqueado','',700,100,1)",
    'UPDATE cachaca SET price_cents=100',
    'DELETE FROM cachaca',
  ])('bloqueia SQL legado %s', async (sql) => {
    const before = await state()
    await expect(f.db.prepare(sql).run()).rejects.toThrow('CATALOG_LEGACY_READ_ONLY')
    expect(await state()).toEqual(before)
  })
})
