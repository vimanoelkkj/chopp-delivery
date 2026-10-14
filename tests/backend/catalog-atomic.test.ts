import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogSnapshot } from '../../server/admin-catalog/catalog-contract'
import { handleCatalog } from '../../server/admin-catalog/catalog-handler'
import { handleAdminPatch } from '../../server/admin-catalog/handlers'
import { handleLogin, handleLogout } from '../../server/auth/handlers'
import { authFixture, authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'

describe('GET/PUT catálogo atômico com revisão global e D1 descartável', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  let cookie: string
  let secondCookie: string
  const request = (method: string, body?: unknown, match?: string | null, session = cookie) => {
    const headers = new Headers({
      Origin: TEST_ORIGIN,
      Cookie: session,
      'Content-Type': 'application/json',
    })
    if (match !== null && match !== undefined) headers.set('If-Match', match)
    return new Request(`${TEST_ORIGIN}/api/admin/catalog`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const load = async (session = cookie) => {
    const response = await handleCatalog(request('GET', undefined, undefined, session), fixture.env)
    expect(response.status).toBe(200)
    const data = (await response.json()) as CatalogSnapshot
    expect(response.headers.get('etag')).toBe(`"${data.revision}"`)
    return data
  }
  const save = (data: CatalogSnapshot, match = `"${data.revision}"`, session = cookie) =>
    handleCatalog(request('PUT', data, match, session), fixture.env)
  const state = async () =>
    (
      await fixture.db.batch([
        fixture.db.prepare('SELECT * FROM products ORDER BY id'),
        fixture.db.prepare('SELECT * FROM cachaca'),
        fixture.db.prepare('SELECT * FROM catalog_meta'),
      ])
    ).map((r) => r.results)
  beforeEach(async () => {
    fixture = await authFixture()
    await seedOwner(fixture.db)
    cookie =
      (await handleLogin(authRequest('login', { body: loginBody() }), fixture.env)).headers.get(
        'set-cookie',
      ) ?? ''
    secondCookie =
      (await handleLogin(authRequest('login', { body: loginBody() }), fixture.env)).headers.get(
        'set-cookie',
      ) ?? ''
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture?.runtime.dispose()
  })

  it('GET espelha contrato F3B, inclui ocultos e não escreve', async () => {
    await fixture.db.prepare('UPDATE products SET visible = 0 WHERE id = ?').bind('brahma').run()
    await fixture.db.prepare('UPDATE cachaca SET visible = 0').run()
    const before = await state()
    const snapshot = await load()
    expect(snapshot.chopes).toHaveLength(8)
    expect(snapshot.chopes[0]).toEqual({
      id: 'dronken',
      name: 'Dronken',
      description: 'Double Double',
      visible: true,
      prices: { 30: 51000, 50: 65000 },
    })
    expect(snapshot.chopes.find((p) => p.id === 'brahma')).toMatchObject({
      visible: false,
      prices: { 30: null, 50: 89000 },
    })
    expect(snapshot.cachacas).toEqual([
      {
        id: 'cachaca',
        name: 'Temos cachaça',
        description: 'Conservada em barril de umburana com jequitibá rosa',
        visible: false,
        prices: { bottle: 3000 },
      },
    ])
    await load()
    expect(await state()).toEqual(before)
  })

  it('salva catálogo inteiro; no-op não avança revisão e volume é preservado', async () => {
    const data = await load()
    const unchanged = await save(data)
    expect(unchanged.status).toBe(200)
    expect(await unchanged.json()).toEqual(data)
    data.chopes[0].prices[30] = 49099
    data.chopes[1].visible = false
    data.cachacas[0].prices.bottle = 3001
    const saved = await save(data)
    expect(saved.status).toBe(200)
    const next = (await saved.json()) as CatalogSnapshot
    expect(next.revision).not.toBe(data.revision)
    expect(next.chopes[0].prices[30]).toBe(49099)
    expect(next.cachacas[0].prices.bottle).toBe(3001)
    expect(await fixture.db.prepare('SELECT bottle_ml FROM cachaca').first('bottle_ml')).toBe(700)
    const again = await save(next)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual(next)
  })

  it('duas sessões com mesma revisão: só um salvamento incompatível vence', async () => {
    const a = await load()
    const b = await load(secondCookie)
    a.chopes[0].prices[30] = 51001
    b.chopes[0].prices[30] = 51002
    const responses = await Promise.all([save(a), save(b, `"${b.revision}"`, secondCookie)])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    const winner = await responses.find((r) => r.status === 200)?.json()
    expect(await load()).toEqual(winner)
  })

  it('retry após resposta perdida conflita sem gravar de novo; recarregar resolve', async () => {
    const data = await load()
    data.chopes[0].name = 'Nome salvo'
    expect((await save(data)).status).toBe(200)
    const before = await state()
    expect((await save(data)).status).toBe(409)
    expect(await state()).toEqual(before)
    expect((await load()).chopes[0].name).toBe('Nome salvo')
  })

  it('falha no quinto produto reverte quatro anteriores, cachaça, revisão e efeitos de trigger', async () => {
    const data = await load()
    for (const item of [...data.chopes, ...data.cachacas]) item.name += ' alterado'
    await fixture.db.prepare('CREATE TABLE atomic_events (id TEXT)').run()
    await fixture.db
      .prepare(
        'CREATE TRIGGER atomic_event AFTER UPDATE ON products BEGIN INSERT INTO atomic_events VALUES (NEW.id); END',
      )
      .run()
    await fixture.db
      .prepare(
        "CREATE TRIGGER atomic_fifth BEFORE UPDATE ON products WHEN (SELECT COUNT(*) FROM atomic_events) = 4 BEGIN SELECT RAISE(ABORT, 'fifth product failure'); END",
      )
      .run()
    const before = await state()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await save(data)).status).toBe(503)
    expect(await state()).toEqual(before)
    expect(await fixture.db.prepare('SELECT COUNT(*) FROM atomic_events').first('COUNT(*)')).toBe(0)
  })

  it.each(['cachaca-failure', 'ignored-write'])(
    'erro %s depois dos produtos reverte tudo',
    async (mode) => {
      const data = await load()
      for (const p of data.chopes) p.name += ' novo'
      data.cachacas[0].name += ' nova'
      await fixture.db
        .prepare(
          mode === 'cachaca-failure'
            ? "CREATE TRIGGER atomic_fail BEFORE UPDATE ON cachaca BEGIN SELECT RAISE(ABORT, 'bottle failed'); END"
            : 'CREATE TRIGGER atomic_ignore BEFORE UPDATE ON cachaca BEGIN SELECT RAISE(IGNORE); END',
        )
        .run()
      const before = await state()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect((await save(data)).status).toBe(503)
      expect(await state()).toEqual(before)
    },
  )

  it('reordena de forma zero-based e segundo PUT é idempotente', async () => {
    const data = await load()
    data.chopes.reverse()
    const response = await save(data)
    expect(response.status).toBe(200)
    const saved = (await response.json()) as CatalogSnapshot
    expect(saved.chopes.map((p) => p.id)).toEqual(data.chopes.map((p) => p.id))
    expect(
      (await fixture.db.prepare('SELECT sort_order FROM products ORDER BY sort_order').all())
        .results,
    ).toEqual(Array.from({ length: 8 }, (_, i) => ({ sort_order: i })))
    expect(await (await save(saved)).json()).toEqual(saved)
  })

  it('GET→PUT com ordem igual preserva sortOrder esparso/empatado de PATCH', async () => {
    await fixture.db.prepare('UPDATE products SET sort_order = 50').run()
    const snapshot = await load()
    const before = await state()
    expect(await (await save(snapshot)).json()).toEqual(snapshot)
    expect(await state()).toEqual(before)
  })

  it('INSERT/DELETE nas duas entidades invalidam revisão, mesmo com conteúdo final igual; UPDATE idêntico não invalida', async () => {
    const initial = await load()
    await fixture.db.prepare('UPDATE products SET name = name, sort_order = sort_order').run()
    await fixture.db.prepare('UPDATE cachaca SET title = title').run()
    expect((await load()).revision).toBe(initial.revision)
    await fixture.db
      .prepare(
        'INSERT INTO products (id, name, description, price_30_cents, visible) VALUES (?, ?, ?, ?, ?)',
      )
      .bind('temporary', 'Temporary', '', 1, 0)
      .run()
    const inserted = await load()
    expect(inserted.revision).not.toBe(initial.revision)
    await fixture.db.prepare('DELETE FROM products WHERE id = ?').bind('temporary').run()
    const deleted = await load()
    expect(deleted.revision).not.toBe(inserted.revision)
    const bottle = await fixture.db.prepare('SELECT * FROM cachaca').first<{
      id: string
      title: string
      description: string
      bottle_ml: number
      price_cents: number
      visible: number
    }>()
    if (!bottle) throw new Error('Garrafa de teste ausente')
    await fixture.db.prepare('DELETE FROM cachaca').run()
    const empty = await load()
    expect(empty.cachacas).toEqual([])
    expect(empty.revision).not.toBe(deleted.revision)
    expect(await (await save(empty)).json()).toEqual(empty)
    await fixture.db
      .prepare(
        'INSERT INTO cachaca (id, title, description, bottle_ml, price_cents, visible) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        bottle.id,
        bottle.title,
        bottle.description,
        bottle.bottle_ml,
        bottle.price_cents,
        bottle.visible,
      )
      .run()
    expect((await load()).revision).not.toBe(empty.revision)
    expect((await save(initial)).status).toBe(409)
  })

  it('metadados ausentes fecham GET, PUT e PATCH efetivo sem alterar dados comerciais', async () => {
    const initial = await load()
    await fixture.db.prepare('DELETE FROM catalog_meta').run()
    const before = await state()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await handleCatalog(request('GET'), fixture.env)).status).toBe(503)
    expect((await save(initial)).status).toBe(503)
    const patch = new Request(`${TEST_ORIGIN}/api/admin/products/dronken`, {
      method: 'PATCH',
      headers: { Origin: TEST_ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Não pode persistir' }),
    })
    expect((await handleAdminPatch(patch, fixture.env, 'products', 'dronken')).status).toBe(503)
    expect(await state()).toEqual(before)
  })

  it('falha em leitura posterior ao comando também reverte toda a batch', async () => {
    const data = await load()
    data.chopes[0].name = 'Não persistir'
    const before = await state()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = new Proxy(fixture.db, {
      get(target, key, receiver) {
        if (key === 'batch')
          return (statements: D1PreparedStatement[]) =>
            target.batch([...statements, target.prepare('SELECT * FROM missing_snapshot_table')])
        return Reflect.get(target, key, receiver)
      },
    })
    expect(
      (
        await handleCatalog(request('PUT', data, `"${data.revision}"`), {
          ...fixture.env,
          DELEGAS_DB: db,
        })
      ).status,
    ).toBe(503)
    expect(await state()).toEqual(before)
  })

  it('ordem incompleta ignorada por trigger falha e reverte as outras linhas', async () => {
    const data = await load()
    data.chopes.reverse()
    const before = await state()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await fixture.db
      .prepare(
        "CREATE TRIGGER ignore_order BEFORE UPDATE OF sort_order ON products WHEN OLD.id = 'dronken' BEGIN SELECT RAISE(IGNORE); END",
      )
      .run()
    expect((await save(data)).status).toBe(503)
    expect(await state()).toEqual(before)
  })

  it('limite maior comporta catálogo completo e descrições UTF-8 extensas', async () => {
    const data = await load()
    for (const item of [...data.chopes, ...data.cachacas]) item.description = '🍺'.repeat(2000)
    const response = await save(data)
    expect(response.status).toBe(200)
    expect(((await response.json()) as CatalogSnapshot).chopes[0].description).toBe(
      data.chopes[0].description,
    )
  })

  it.each(['products', 'cachacas'] as const)(
    'PATCH individual efetivo em %s invalida revisão antiga; no-op não invalida',
    async (resource) => {
      const snapshot = await load()
      const id = resource === 'products' ? 'dronken' : 'cachaca'
      const body = resource === 'products' ? { pricesCents: { 30: 51001 } } : { priceCents: 3001 }
      const individual = () =>
        handleAdminPatch(
          new Request(`${TEST_ORIGIN}/api/admin/${resource}/${id}`, {
            method: 'PATCH',
            headers: { Origin: TEST_ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
          fixture.env,
          resource,
          id,
        )
      expect((await individual()).status).toBe(200)
      expect((await save(snapshot)).status).toBe(409)
      const next = await load()
      expect((await individual()).status).toBe(200)
      expect((await load()).revision).toBe(next.revision)
    },
  )

  it.each(['logout', 'disable', 'expiry', 'auth-version', 'origin'] as const)(
    'revogação %s entre guard e batch devolve 401 sem escrita',
    async (mode) => {
      const data = await load()
      data.chopes[0].name = 'Proibido'
      const before = await state()
      const db = new Proxy(fixture.db, {
        get(target, key, receiver) {
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              if (mode === 'logout')
                await handleLogout(authRequest('logout', { cookie }), fixture.env)
              if (mode === 'disable')
                await target.prepare('UPDATE admin_users SET active = 0').run()
              if (mode === 'expiry')
                await target
                  .prepare('UPDATE admin_sessions SET created_at = 0, expires_at = 1')
                  .run()
              if (mode === 'auth-version')
                await target.prepare('UPDATE admin_users SET auth_version = auth_version + 1').run()
              if (mode === 'origin')
                await target
                  .prepare('UPDATE admin_sessions SET origin = ?')
                  .bind('https://invalid.example')
                  .run()
              return target.batch(statements)
            }
          return Reflect.get(target, key, receiver)
        },
      })
      expect(
        (
          await handleCatalog(request('PUT', data, `"${data.revision}"`), {
            ...fixture.env,
            DELEGAS_DB: db,
          })
        ).status,
      ).toBe(401)
      expect(await state()).toEqual(before)
    },
  )

  it.each(['missing', 'extra', 'duplicate', 'wrong-entity'] as const)(
    'rejeita IDs %s sem mutação',
    async (mode) => {
      const data = await load()
      const before = await state()
      if (mode === 'missing') data.chopes.pop()
      if (mode === 'extra') data.chopes.push({ ...data.chopes[0], id: 'extra' })
      if (mode === 'duplicate') data.chopes[1].id = data.chopes[0].id
      if (mode === 'wrong-entity') data.chopes[0].id = 'cachaca'
      const response = await save(data)
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: { fields: unknown } }).error.fields).toBeDefined()
      expect(await state()).toEqual(before)
    },
  )

  it.each([null, 'r0', '*', 'W/"r0"', '"r00"', '"r0", "r0"', '"r9007199254740992"'])(
    'If-Match %s é recusado estritamente',
    async (match) => {
      const data = await load()
      const before = await state()
      expect((await handleCatalog(request('PUT', data, match), fixture.env)).status).toBe(
        match === null ? 428 : 400,
      )
      expect(await state()).toEqual(before)
    },
  )

  it('body/header divergentes, preços e produto visível sem preço são 400', async () => {
    const initial = await load()
    const before = await state()
    for (const modify of [
      (d: CatalogSnapshot) => {
        d.revision = 'r1'
      },
      (d: CatalogSnapshot) => {
        d.chopes[0].prices[30] = 0
      },
      (d: CatalogSnapshot) => {
        d.chopes[0].prices = { 30: null, 50: null }
      },
      (d: CatalogSnapshot) => {
        d.cachacas[0].prices.bottle = null
      },
      (d: CatalogSnapshot) => {
        d.chopes[0].name = '\ud800'
      },
    ]) {
      const data = structuredClone(initial)
      modify(data)
      expect((await save(data, `"${initial.revision}"`)).status).toBe(400)
    }
    expect(await state()).toEqual(before)
  })

  it('sessão ausente, origem inválida e métodos fecham acesso', async () => {
    const data = await load()
    const before = await state()
    expect(
      (await handleCatalog(request('GET', undefined, undefined, ''), fixture.env)).status,
    ).toBe(401)
    expect(
      (await handleCatalog(request('PUT', data, `"${data.revision}"`, ''), fixture.env)).status,
    ).toBe(401)
    const cross = request('PUT', data, `"${data.revision}"`)
    cross.headers.set('Origin', 'https://attacker.example')
    expect((await handleCatalog(cross, fixture.env)).status).toBe(403)
    for (const method of ['POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = await handleCatalog(request(method), fixture.env)
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, PUT')
      if (method === 'HEAD') expect(await response.text()).toBe('')
    }
    expect(await state()).toEqual(before)
  })
})
