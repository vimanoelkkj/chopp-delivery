import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleProducts } from '../../functions/api/products'
import type {
  CachacaMutationResponse,
  CachacasResponse,
  ProductsResponse,
} from '../../server/admin-catalog/contracts'
import { handleAdminList, handleAdminPatch } from '../../server/admin-catalog/handlers'
import { PATCH_BODY_TIMEOUT_MS } from '../../server/admin-catalog/validation'
import { handleLogin, handleLogout } from '../../server/auth/handlers'
import { hashPassword } from '../../server/auth/password'
import type { Catalog } from '../../src/features/catalog/types'
import {
  authFixture,
  authRequest,
  loginBody,
  seedOwner,
  TEST_ORIGIN,
  TEST_PASSWORD,
  TEST_PEPPER,
} from './auth-fixture'

type Resource = 'products' | 'cachacas'
type ErrorResponse = { error: { code: string; fields?: Record<string, string> } }
const json = async <T>(response: Response): Promise<T> => (await response.json()) as T

describe('catálogo administrativo com handlers reais e D1 descartável', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  let cookie: string
  const request = (
    resource: Resource,
    method = 'GET',
    body?: string,
    options: { cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
  ) => {
    const headers = new Headers({ 'Content-Type': 'application/json', ...options.headers })
    headers.set('Cookie', options.cookie ?? cookie)
    if (options.origin !== null) headers.set('Origin', options.origin ?? TEST_ORIGIN)
    return new Request(`${TEST_ORIGIN}/api/admin/${resource}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    })
  }
  const list = (resource: Resource, options?: Parameters<typeof request>[3]) =>
    handleAdminList(request(resource, 'GET', undefined, options), fixture.env, resource)
  const patch = (
    resource: Resource,
    id: string,
    data: unknown,
    options?: Parameters<typeof request>[3],
  ) =>
    handleAdminPatch(
      request(resource, 'PATCH', JSON.stringify(data), options),
      fixture.env,
      resource,
      id,
    )
  const snapshot = async () =>
    (
      await fixture.db.batch([
        fixture.db.prepare('SELECT * FROM products ORDER BY id'),
        fixture.db.prepare('SELECT * FROM cachaca ORDER BY id'),
        fixture.db.prepare('SELECT * FROM admin_sessions ORDER BY token_hash'),
        fixture.db.prepare('SELECT * FROM admin_login_limits ORDER BY key'),
      ])
    ).map((result) => result.results)
  const publicCatalog = async () =>
    json<Catalog>(await handleProducts({ method: 'GET' }, fixture.db))

  beforeEach(async () => {
    fixture = await authFixture()
    await seedOwner(fixture.db)
    const login = await handleLogin(authRequest('login', { body: loginBody() }), fixture.env)
    expect(login.status).toBe(200)
    cookie = login.headers.get('set-cookie') ?? ''
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    await fixture?.runtime.dispose()
  })

  it('GET inclui os oito chopes, cachaça oculta, centavos, IDs string e ordem estável sem escrita', async () => {
    await fixture.db.prepare('UPDATE products SET visible = 0, sort_order = 0').run()
    await fixture.db.prepare('UPDATE cachaca SET visible = 0').run()
    const before = await snapshot()
    const products = await list('products')
    expect(products.status).toBe(200)
    expect(products.headers.get('cache-control')).toBe('no-store')
    expect(products.headers.get('access-control-allow-origin')).toBeNull()
    const data = await json<ProductsResponse>(products)
    expect(data.products).toHaveLength(8)
    expect(data.products.map((item: { id: string }) => item.id)).toEqual([
      'brahma',
      'chopp-de-vinho',
      'dronken',
      'heineken',
      'kaiser',
      'krug-bier',
      'palato-beber',
      'villa-alema',
    ])
    expect(data.products.find((item: { id: string }) => item.id === 'brahma')).toEqual({
      id: 'brahma',
      name: 'Brahma',
      description: 'Chopp',
      pricesCents: { 30: null, 50: 89000 },
      visible: false,
      sortOrder: 0,
    })
    const cachacas = await list('cachacas')
    expect(cachacas.status).toBe(200)
    expect(await cachacas.json()).toEqual({
      cachacas: [
        {
          id: 'cachaca',
          title: 'Temos cachaça',
          description: 'Conservada em barril de umburana com jequitibá rosa',
          bottleMl: 700,
          priceCents: 3000,
          visible: false,
        },
      ],
    })
    await list('products')
    expect(await snapshot()).toEqual(before)
  })

  it.each(['products', 'cachacas'] as const)(
    'nega GET/PATCH %s sem autenticação, com cookie inválido, sessão expirada e revogada',
    async (resource) => {
      const id = resource === 'products' ? 'dronken' : 'cachaca'
      const data = resource === 'products' ? { name: 'Novo' } : { title: 'Novo' }
      const unchanged = await fixture.db
        .prepare(`SELECT * FROM ${resource === 'products' ? 'products' : 'cachaca'} WHERE id = ?`)
        .bind(id)
        .first()
      for (const invalid of ['', 'delegas_admin_local_session=invalid']) {
        expect((await list(resource, { cookie: invalid })).status).toBe(401)
        expect((await patch(resource, id, data, { cookie: invalid })).status).toBe(401)
      }
      await fixture.db.prepare('UPDATE admin_sessions SET created_at = 0, expires_at = 1').run()
      expect((await list(resource)).status).toBe(401)
      expect((await patch(resource, id, data)).status).toBe(401)
      await fixture.db.prepare('DELETE FROM admin_sessions').run()
      expect((await list(resource)).status).toBe(401)
      expect((await patch(resource, id, data)).status).toBe(401)
      expect(
        await fixture.db
          .prepare(`SELECT * FROM ${resource === 'products' ? 'products' : 'cachaca'} WHERE id = ?`)
          .bind(id)
          .first(),
      ).toEqual(unchanged)
    },
  )

  it.each(['products', 'cachacas'] as const)(
    'PATCH %s exige CSRF mesmo com cookie; Referer válido é aceito',
    async (resource) => {
      const id = resource === 'products' ? 'dronken' : 'cachaca'
      const data = resource === 'products' ? { name: 'Novo' } : { title: 'Novo' }
      const before = await snapshot()
      for (const origin of [null, 'null', 'https://attacker.example'])
        expect((await patch(resource, id, data, { origin })).status).toBe(403)
      expect(
        (await patch(resource, id, data, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
      ).toBe(403)
      expect(await snapshot()).toEqual(before)
      expect(
        (
          await patch(resource, id, data, {
            origin: null,
            headers: { Referer: `${TEST_ORIGIN}/admin` },
          })
        ).status,
      ).toBe(200)
    },
  )

  it.each(['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])(
    'método %s é recusado sem consultar o banco',
    async (method) => {
      const env = {
        ...fixture.env,
        DELEGAS_DB: new Proxy(fixture.db, {
          get(target, key, receiver) {
            if (key === 'prepare')
              return () => {
                throw new Error('Não deve consultar')
              }
            return Reflect.get(target, key, receiver)
          },
        }),
      }
      for (const resource of ['products', 'cachacas'] as const) {
        const read = await handleAdminList(request(resource, method), env, resource)
        const write = await handleAdminPatch(request(resource, method), env, resource, 'missing')
        expect(read.status).toBe(405)
        expect(write.status).toBe(405)
        expect(read.headers.get('allow')).toBe('GET')
        expect(write.headers.get('allow')).toBe('PATCH')
        if (method === 'HEAD') {
          expect(await read.text()).toBe('')
          expect(await write.text()).toBe('')
        }
      }
    },
  )

  it('edições parciais persistem preços/ordem/visibilidade sem rebuild e mantêm contrato público', async () => {
    const response = await patch('products', 'dronken', {
      name: 'Nome editado',
      description: 'Descrição editada',
      pricesCents: { 30: 49099, 50: 29 },
      sortOrder: 9,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      changed: true,
      product: {
        id: 'dronken',
        name: 'Nome editado',
        description: 'Descrição editada',
        pricesCents: { 30: 49099, 50: 29 },
        visible: true,
        sortOrder: 9,
      },
    })
    await patch('products', 'palato-beber', { visible: false })
    const bottle = await patch('cachacas', 'cachaca', {
      title: 'Título editado',
      description: 'Nova descrição',
      priceCents: 3001,
    })
    expect(bottle.status).toBe(200)
    expect((await json<CachacaMutationResponse>(bottle)).cachaca).toMatchObject({
      priceCents: 3001,
      bottleMl: 700,
      visible: true,
    })
    const catalog = await publicCatalog()
    expect(catalog.products).toHaveLength(7)
    expect(catalog.products.at(-1)).toMatchObject({
      id: 'dronken',
      name: 'Nome editado',
      prices: { 30: 490.99, 50: 0.29 },
    })
    expect(catalog.cachaca?.price).toBe(30.01)
    await patch('cachacas', 'cachaca', { visible: false })
    expect((await publicCatalog()).cachaca).toBeNull()
    expect((await json<CachacasResponse>(await list('cachacas'))).cachacas[0].visible).toBe(false)
  })

  it('null controla somente tamanho comercializado; preços omitidos e visibilidade são preservados', async () => {
    expect((await patch('products', 'brahma', { pricesCents: { 50: 89001 } })).status).toBe(200)
    let catalog = await publicCatalog()
    expect(catalog.products.find((p: { id: string }) => p.id === 'brahma')?.prices).toEqual({
      30: null,
      50: 890.01,
    })
    expect(
      (await patch('products', 'dronken', { visible: false, pricesCents: { 30: null, 50: null } }))
        .status,
    ).toBe(200)
    catalog = await publicCatalog()
    expect(catalog.products.find((p: { id: string }) => p.id === 'dronken')).toBeUndefined()
    expect(
      (await json<ProductsResponse>(await list('products'))).products.find(
        (p) => p.id === 'dronken',
      ),
    ).toMatchObject({
      visible: false,
      pricesCents: { 30: null, 50: null },
    })
    expect((await patch('products', 'brahma', { pricesCents: { 30: 1 } })).status).toBe(200)
    expect(
      (await publicCatalog()).products.find((p: { id: string }) => p.id === 'brahma')?.prices,
    ).toEqual({ 30: 0.01, 50: 890.01 })
  })

  it.each(['products', 'cachacas'] as const)(
    'registro %s inexistente é 404; operação idêntica é 200 changed:false sem UPDATE efetivo',
    async (resource) => {
      const id = resource === 'products' ? 'dronken' : 'cachaca'
      const table = resource === 'products' ? 'products' : 'cachaca'
      const data =
        resource === 'products'
          ? { name: 'Dronken', pricesCents: { 30: 51000 } }
          : { title: 'Temos cachaça', priceCents: 3000 }
      await fixture.db.prepare('CREATE TABLE write_events (id INTEGER)').run()
      await fixture.db
        .prepare(
          `CREATE TRIGGER record_writes AFTER UPDATE ON ${table} BEGIN INSERT INTO write_events VALUES (1); END`,
        )
        .run()
      const missing = await patch(resource, 'missing', data)
      expect(missing.status).toBe(404)
      expect((await json<ErrorResponse>(missing)).error.code).toBe('NOT_FOUND')
      const same = await patch(resource, id, data)
      expect(same.status).toBe(200)
      expect((await json<{ changed: boolean }>(same)).changed).toBe(false)
      expect(
        await fixture.db.prepare('SELECT COUNT(*) AS count FROM write_events').first('count'),
      ).toBe(0)
    },
  )

  it.each([
    {},
    null,
    [],
    { id: 'other' },
    { stock: 1 },
    { name: '' },
    { name: '   ' },
    { name: '\u0000a' },
    { name: 'a'.repeat(121) },
    { description: false },
    { description: 'a'.repeat(2001) },
    { visible: 1 },
    { sortOrder: -1 },
    { sortOrder: 1.5 },
    { sortOrder: 2147483648 },
    { pricesCents: {} },
    { pricesCents: [] },
    { pricesCents: { 20: 1 } },
    { pricesCents: { 30: '100' } },
    { pricesCents: { 30: -1 } },
    { pricesCents: { 50: 1.005 } },
    { pricesCents: { 30: Number.MAX_SAFE_INTEGER } },
    { pricesCents: { 50: Number.MAX_SAFE_INTEGER + 1 } },
  ])('rejeita PATCH de produto inválido sem efeitos: %j', async (data) => {
    const before = await snapshot()
    const response = await patch('products', 'dronken', data)
    expect(response.status).toBe(400)
    const error = (await json<ErrorResponse>(response)).error
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.fields).toBeDefined()
    expect(await snapshot()).toEqual(before)
  })

  it.each([
    { title: '\u0000' },
    { title: '' },
    { bottleMl: 800 },
    { sortOrder: 1 },
    { priceCents: null },
    { priceCents: -1 },
    { priceCents: 0.29 },
    { priceCents: '3000' },
  ])('rejeita PATCH de cachaça inválido: %j', async (data) => {
    const before = await snapshot()
    expect((await patch('cachacas', 'cachaca', data)).status).toBe(400)
    expect(await snapshot()).toEqual(before)
  })

  it.each([
    '{',
    'NaN',
    '{"pricesCents":{"30":NaN}}',
    '{"pricesCents":{"30":Infinity}}',
    '{"pricesCents":{"30":1e999}}',
    JSON.stringify({ description: 'a'.repeat(20000) }),
  ])('corpo hostil não escreve: %s', async (body) => {
    const before = await snapshot()
    const response = await handleAdminPatch(
      request('products', 'PATCH', body),
      fixture.env,
      'products',
      'dronken',
    )
    expect(response.status).toBe(400)
    expect(await snapshot()).toEqual(before)
  })

  it('tipo de mídia inválido é recusado; tamanho real prevalece sobre Content-Length', async () => {
    const before = await snapshot()
    expect(
      (
        await patch(
          'products',
          'dronken',
          { name: 'Novo' },
          { headers: { 'Content-Type': 'text/plain' } },
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await handleAdminPatch(
          request('products', 'PATCH', JSON.stringify({ description: 'a'.repeat(20000) }), {
            headers: { 'Content-Length': '1' },
          }),
          fixture.env,
          'products',
          'dronken',
        )
      ).status,
    ).toBe(400)
    expect(await snapshot()).toEqual(before)
  })

  it('handler recusa UTF-8 inválido sem efeitos no D1', async () => {
    const before = await snapshot()
    const invalid = new Request(request('products', 'PATCH'), { body: new Uint8Array([0xff]) })
    expect((await handleAdminPatch(invalid, fixture.env, 'products', 'dronken')).status).toBe(400)
    expect(await snapshot()).toEqual(before)
  })

  it('handler expira corpo parado e não aguarda cancelamento, sem efeitos no D1', async () => {
    const before = await snapshot()
    let reading: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      reading = resolve
    })
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          reading()
        },
        cancel,
      },
      { highWaterMark: 0 },
    )
    const pending = new Request(request('products', 'PATCH'), {
      body,
      duplex: 'half',
    } as RequestInit)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const response = handleAdminPatch(pending, fixture.env, 'products', 'dronken')
      await started
      await vi.advanceTimersByTimeAsync(PATCH_BODY_TIMEOUT_MS)
      expect((await response).status).toBe(400)
      expect(cancel).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
    expect(await snapshot()).toEqual(before)
  })

  it('valores e ID maliciosos são parâmetros; SQL sempre contém a prova no UPDATE', async () => {
    const sqls: string[] = []
    const bindings: unknown[][] = []
    const db = new Proxy(fixture.db, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) => {
            sqls.push(sql)
            return new Proxy(target.prepare(sql), {
              get(statement, member, statementReceiver) {
                if (member === 'bind')
                  return (...values: unknown[]) => {
                    bindings.push(values)
                    return statement.bind(...values)
                  }
                return Reflect.get(statement, member, statementReceiver)
              },
            })
          }
        return Reflect.get(target, key, receiver)
      },
    })
    const malicious = "x'; DROP TABLE products;--"
    expect(
      (
        await handleAdminPatch(
          request('products', 'PATCH', JSON.stringify({ name: malicious })),
          { ...fixture.env, DELEGAS_DB: db },
          'products',
          'dronken',
        )
      ).status,
    ).toBe(200)
    const update = sqls.find((sql) => sql.startsWith('UPDATE products')) ?? ''
    expect(update).toMatch(/s\.token_hash = \? AND u\.id = \? AND u\.active = 1/)
    expect(update).toContain('s.auth_version = u.auth_version')
    expect(update).toContain("unixepoch('subsec')")
    expect(update).not.toContain(malicious)
    expect(bindings.some((values) => values.includes(malicious))).toBe(true)
    expect(
      (
        await handleAdminPatch(
          request('products', 'PATCH', JSON.stringify({ visible: false })),
          { ...fixture.env, DELEGAS_DB: db },
          'products',
          malicious,
        )
      ).status,
    ).toBe(404)
    expect((await publicCatalog()).products).toHaveLength(8)
  })

  it.each(
    (['products', 'cachacas'] as const).flatMap((resource) =>
      (['logout', 'disable', 'version', 'expiry', 'password', 'origin'] as const).flatMap(
        (change) =>
          (['change', 'same', 'missing'] as const).map((intent) => ({ resource, change, intent })),
      ),
    ),
  )(
    'revogação $change entre guard e UPDATE nega $intent em $resource',
    async ({ resource, change, intent }) => {
      const table = resource === 'products' ? 'products' : 'cachaca'
      const recordId = resource === 'products' ? 'dronken' : 'cachaca'
      const before = await fixture.db
        .prepare(`SELECT * FROM ${table} WHERE id = ?`)
        .bind(recordId)
        .first()
      const db = new Proxy(fixture.db, {
        get(target, key, receiver) {
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              if (change === 'logout')
                await handleLogout(authRequest('logout', { cookie }), fixture.env)
              if (change === 'disable')
                await target.prepare('UPDATE admin_users SET active = 0').run()
              if (change === 'version')
                await target.prepare('UPDATE admin_sessions SET auth_version = 0').run()
              if (change === 'expiry')
                await target
                  .prepare('UPDATE admin_sessions SET created_at = 0, expires_at = 1')
                  .run()
              if (change === 'password')
                await target
                  .prepare('UPDATE admin_users SET password_hash = ?')
                  .bind(await hashPassword(TEST_PASSWORD, TEST_PEPPER))
                  .run()
              if (change === 'origin')
                await target
                  .prepare('UPDATE admin_sessions SET origin = ?')
                  .bind('https://attacker.example')
                  .run()
              return target.batch(statements)
            }
          return Reflect.get(target, key, receiver)
        },
      })
      const response = await handleAdminPatch(
        request(
          resource,
          'PATCH',
          JSON.stringify(
            resource === 'products'
              ? { name: intent === 'same' ? 'Dronken' : 'Proibido' }
              : { title: intent === 'same' ? 'Temos cachaça' : 'Proibido' },
          ),
        ),
        { ...fixture.env, DELEGAS_DB: db },
        resource,
        intent === 'missing' ? 'missing' : recordId,
      )
      expect(response.status).toBe(401)
      expect(
        await fixture.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(recordId).first(),
      ).toEqual(before)
    },
  )

  it('PATCHs realmente paralelos com logout respeitam o instante autorizado e não permitem novas escritas', async () => {
    const [writes, logout] = await Promise.all([
      Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          patch('products', 'dronken', { pricesCents: { 30: 51001 + i } }),
        ),
      ),
      handleLogout(authRequest('logout', { cookie }), fixture.env),
    ])
    expect(logout.status).toBe(200)
    const successful: number[] = [51000]
    for (const response of writes) {
      expect([200, 401]).toContain(response.status)
      if (response.status === 200)
        successful.push(
          (await json<{ product: { pricesCents: { 30: number } } }>(response)).product
            .pricesCents[30],
        )
    }
    expect(successful).toContain(
      await fixture.db
        .prepare('SELECT price_30_cents FROM products WHERE id = ?')
        .bind('dronken')
        .first('price_30_cents'),
    )
    const before = await snapshot()
    expect((await patch('products', 'dronken', { name: 'Depois do logout' })).status).toBe(401)
    expect(await snapshot()).toEqual(before)
  })

  it.each(['products', 'cachacas'] as const)(
    'revogação entre guard e GET %s não divulga dados',
    async (resource) => {
      const db = new Proxy(fixture.db, {
        get(target, key, receiver) {
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              await handleLogout(authRequest('logout', { cookie }), fixture.env)
              return target.batch(statements)
            }
          return Reflect.get(target, key, receiver)
        },
      })
      const response = await handleAdminList(
        request(resource),
        { ...fixture.env, DELEGAS_DB: db },
        resource,
      )
      expect(response.status).toBe(401)
      expect(await json<ErrorResponse>(response)).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'Autenticação necessária.' },
      })
    },
  )

  it.each(['products', 'cachacas'] as const)(
    'falha depois do UPDATE %s reverte a transação inteira, sem vazar SQL',
    async (resource) => {
      const before = await snapshot()
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const db = new Proxy(fixture.db, {
        get(target, key, receiver) {
          if (key === 'batch')
            return (statements: D1PreparedStatement[]) =>
              target.batch([
                ...statements,
                target.prepare('SELECT * FROM table_that_does_not_exist'),
              ])
          return Reflect.get(target, key, receiver)
        },
      })
      const response = await handleAdminPatch(
        request(
          resource,
          'PATCH',
          JSON.stringify(
            resource === 'products'
              ? { name: 'Não pode persistir' }
              : { title: 'Não pode persistir' },
          ),
        ),
        { ...fixture.env, DELEGAS_DB: db },
        resource,
        resource === 'products' ? 'dronken' : 'cachaca',
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({
        error: {
          code: 'ADMIN_CATALOG_UNAVAILABLE',
          message: 'Catálogo administrativo indisponível no momento.',
        },
      })
      expect(log).toHaveBeenCalledWith('ADMIN_CATALOG_UNAVAILABLE')
      expect(await snapshot()).toEqual(before)
    },
  )

  it.each(['products', 'cachacas'] as const)(
    'UPDATE %s ignorado pelo banco não é confundido com operação idêntica',
    async (resource) => {
      const before = await snapshot()
      const table = resource === 'products' ? 'products' : 'cachaca'
      await fixture.db
        .prepare(
          `CREATE TRIGGER ignore_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
        )
        .run()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(
        (
          await patch(
            resource,
            resource === 'products' ? 'dronken' : 'cachaca',
            resource === 'products' ? { name: 'Mudança ignorada' } : { title: 'Mudança ignorada' },
          )
        ).status,
      ).toBe(503)
      expect(await snapshot()).toEqual(before)
    },
  )

  it('falha de tabela em GET/PATCH fecha acesso com 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await fixture.db.prepare('DROP TABLE cachaca').run()
    expect((await list('cachacas')).status).toBe(503)
    expect((await patch('cachacas', 'cachaca', { title: 'Novo' })).status).toBe(503)
  })
})
