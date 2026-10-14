import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleProducts } from '../../functions/api/products'
import { cachaca, products } from '../../src/features/catalog/products'
import type { Catalog } from '../../src/features/catalog/types'

const schema = readFileSync('migrations/0001_catalog.sql', 'utf8')
const seed = readFileSync('migrations/0002_catalog_seed.sql', 'utf8')

describe('GET /api/products com D1 descartável', () => {
  let runtime: Miniflare
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>
  const read = (method = 'GET', query = '') =>
    handleProducts(new Request(`http://localhost/api/products${query}`, { method }), db)
  const apply = async (sql: string) => {
    await db.batch(
      sql
        .split(';')
        .filter((statement) => statement.trim())
        .map((statement) => db.prepare(statement)),
    )
  }

  beforeEach(async () => {
    runtime = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("test") } }',
      compatibilityDate: '2026-08-06',
      d1Databases: { DELEGAS_DB: 'delegas-handler-test' },
      d1Persist: false,
    })
    db = await runtime.getD1Database('DELEGAS_DB')
    await apply(schema)
    await apply(seed)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await runtime?.dispose()
  })

  it('preserva o contrato completo dos oito chopes, IDs string e cachaça', async () => {
    const response = await read()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ products, cachaca: { id: 'cachaca', ...cachaca } })
    expect(products.every((product) => typeof product.id === 'string')).toBe(true)
  })

  it('persiste centavos inteiros e preserva null para tamanhos não comercializados', async () => {
    expect(
      await db
        .prepare('SELECT price_30_cents, price_50_cents FROM products WHERE id = ?')
        .bind('dronken')
        .first(),
    ).toEqual({ price_30_cents: 51000, price_50_cents: 65000 })
    expect(
      await db
        .prepare('SELECT price_30_cents FROM products WHERE id = ?')
        .bind('brahma')
        .first('price_30_cents'),
    ).toBeNull()
    expect(await db.prepare('SELECT price_cents FROM cachaca').first('price_cents')).toBe(3000)
  })

  it('converte casas decimais sem arredondar na API', async () => {
    await db
      .prepare('UPDATE products SET price_30_cents = ?, price_50_cents = ? WHERE id = ?')
      .bind(49099, 29, 'dronken')
      .run()
    await db.prepare('UPDATE cachaca SET price_cents = ?').bind(3001).run()
    const data = (await (await read()).json()) as Catalog
    expect(data.products[0].prices).toEqual({ 30: 490.99, 50: 0.29 })
    expect(data.cachaca?.price).toBe(30.01)
  })

  it('oculta produtos e cachaça sem relacionar visibilidade a preço ou estoque', async () => {
    await db.prepare('UPDATE products SET visible = ? WHERE id = ?').bind(0, 'palato-beber').run()
    await db
      .prepare('UPDATE products SET price_30_cents = NULL, price_50_cents = NULL WHERE id = ?')
      .bind('dronken')
      .run()
    await db.prepare('UPDATE cachaca SET visible = ?').bind(0).run()
    const data = (await (await read()).json()) as Catalog
    expect(data.products).toHaveLength(7)
    expect(data.products.some((product: { id: string }) => product.id === 'palato-beber')).toBe(
      false,
    )
    expect(data.products[0].prices).toEqual({ 30: null, 50: null })
    expect(data.cachaca).toBeNull()
  })

  it('ordena por sort_order e usa ID como desempate estável', async () => {
    await db.prepare('UPDATE products SET sort_order = ?').bind(0).run()
    const data = (await (await read()).json()) as Catalog
    expect(data.products.map((product: { id: string }) => product.id)).toEqual(
      products.map((product) => product.id).sort(),
    )
  })

  it('reexecutar o seed não sobrescreve alterações administrativas', async () => {
    await db
      .prepare('UPDATE products SET name = ?, price_30_cents = ?, visible = ? WHERE id = ?')
      .bind('Nome alterado', 12345, 0, 'dronken')
      .run()
    await db.prepare('UPDATE cachaca SET price_cents = ?, visible = ?').bind(3101, 0).run()
    await apply(seed)
    expect(
      await db
        .prepare('SELECT name, price_30_cents, visible FROM products WHERE id = ?')
        .bind('dronken')
        .first(),
    ).toEqual({ name: 'Nome alterado', price_30_cents: 12345, visible: 0 })
    expect(await db.prepare('SELECT price_cents, visible FROM cachaca').first()).toEqual({
      price_cents: 3101,
      visible: 0,
    })
  })

  it('utiliza placeholders e bind; parâmetros da URL não são interpolados', async () => {
    const bindings: unknown[][] = []
    const prepare = vi.fn(
      (sql: string) =>
        new Proxy(db.prepare(sql), {
          get(target, key, receiver) {
            if (key === 'bind')
              return (...values: unknown[]) => {
                bindings.push(values)
                return target.bind(...values)
              }
            return Reflect.get(target, key, receiver)
          },
        }),
    )
    await handleProducts(
      new Request("http://localhost/api/products?visible=0&id=';DROP%20TABLE%20products;--"),
      { prepare, batch: db.batch.bind(db) },
    )
    expect(prepare).toHaveBeenCalledTimes(2)
    for (const [sql] of prepare.mock.calls) {
      expect(sql).toMatch(/WHERE visible = \?/)
      expect(sql).not.toMatch(/DROP/)
    }
    expect(bindings).toEqual([[1], [1]])
    expect(((await (await read()).json()) as Catalog).products).toHaveLength(8)
  })

  it('GET não escreve, mesmo após leituras repetidas', async () => {
    const snapshot = () =>
      db.batch([
        db.prepare('SELECT * FROM products ORDER BY id'),
        db.prepare('SELECT * FROM cachaca'),
      ])
    const before = (await snapshot()).map((result) => result.results)
    await read()
    await read()
    expect((await snapshot()).map((result) => result.results)).toEqual(before)
  })

  it('retorna erro genérico sem vazar SQL quando o banco falha', async () => {
    await db.prepare('DROP TABLE products').run()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await read()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'CATALOG_UNAVAILABLE', message: 'Catálogo indisponível no momento.' },
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(log).toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    'recusa %s sem consultar o banco',
    async (method) => {
      const prepare = vi.fn(db.prepare.bind(db))
      const response = await handleProducts({ method }, { prepare, batch: db.batch.bind(db) })
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET')
      expect(prepare).not.toHaveBeenCalled()
      if (method === 'HEAD') expect(await response.text()).toBe('')
    },
  )

  it('schema rejeita preços fracionários em centavos e negativos', async () => {
    for (const price of [1.5, -1]) {
      await expect(
        db
          .prepare('UPDATE products SET price_30_cents = ? WHERE id = ?')
          .bind(price, 'dronken')
          .run(),
      ).rejects.toThrow()
    }
  })
})
