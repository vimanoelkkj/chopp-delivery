import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleAdminPatch } from '../../server/admin-catalog/handlers'
import { handleLogin } from '../../server/auth/handlers'
import { authFixture, authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'

describe('regressões P2 de texto e política comercial', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  let cookie: string
  const patch = (resource: 'products' | 'cachacas', body: unknown) =>
    handleAdminPatch(
      new Request(`${TEST_ORIGIN}/api/admin/${resource}/item`, {
        method: 'PATCH',
        headers: { Origin: TEST_ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      fixture.env,
      resource,
      resource === 'products' ? 'dronken' : 'cachaca',
    )
  const rows = async () =>
    (
      await fixture.db.batch([
        fixture.db.prepare('SELECT * FROM products ORDER BY id'),
        fixture.db.prepare('SELECT * FROM cachaca'),
      ])
    ).map((r) => r.results)
  beforeEach(async () => {
    fixture = await authFixture()
    await seedOwner(fixture.db)
    cookie =
      (await handleLogin(authRequest('login', { body: loginBody() }), fixture.env)).headers.get(
        'set-cookie',
      ) ?? ''
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })

  it.each([
    '\ud800',
    '\udfff',
    'abc\ud800def',
    '\u200b\u200d\ufeff',
    '\u3164',
    '\u2800',
    '\u0301',
    'Nome\u202eexe',
    'Nome\u2066x\u2069',
  ])('rejeita nome/título malformado, invisível ou bidi %j de forma repetível', async (name) => {
    const before = await rows()
    for (let i = 0; i < 2; i++) {
      expect((await patch('products', { name })).status).toBe(400)
      expect((await patch('cachacas', { title: name })).status).toBe(400)
    }
    expect(await rows()).toEqual(before)
  })

  it.each(['\ud800', 'Descrição\udfff', 'Descrição\u202eoculta'])(
    'rejeita descrição inválida %j sem substituição UTF-8',
    async (description) => {
      const before = await rows()
      expect((await patch('products', { description })).status).toBe(400)
      expect((await patch('cachacas', { description })).status).toBe(400)
      expect(await rows()).toEqual(before)
    },
  )

  it('preserva Unicode válido, emoji/ZWJ e descrição multilinha; segundo PATCH é no-op', async () => {
    const body = { name: 'Chope 👩‍🍳 ação', description: 'Ação\nlinha\t🍺' }
    const first = await patch('products', body)
    expect(first.status).toBe(200)
    expect(((await first.json()) as { changed: boolean }).changed).toBe(true)
    const second = await patch('products', body)
    expect(second.status).toBe(200)
    expect((await second.json()) as { changed: boolean; product: { name: string } }).toMatchObject({
      changed: false,
      product: { name: body.name },
    })
  })

  it.each([0, 10_000_000])('rejeita preço %s em ambas entidades', async (price) => {
    const before = await rows()
    expect((await patch('products', { pricesCents: { 30: price } })).status).toBe(400)
    expect((await patch('cachacas', { priceCents: price })).status).toBe(400)
    expect(await rows()).toEqual(before)
  })

  it('limites de 1 e 9999999 centavos são exatos e idempotentes', async () => {
    for (const price of [1, 9_999_999]) {
      const body = { pricesCents: { 30: price } }
      expect((await patch('products', body)).status).toBe(200)
      expect(((await (await patch('products', body)).json()) as { changed: boolean }).changed).toBe(
        false,
      )
      expect((await patch('cachacas', { priceCents: price })).status).toBe(200)
      expect(
        ((await (await patch('cachacas', { priceCents: price })).json()) as { changed: boolean })
          .changed,
      ).toBe(false)
    }
  })

  it('avalia estado final do PATCH parcial: visível exige preço, oculto aceita ambos null', async () => {
    const before = await rows()
    expect((await patch('products', { pricesCents: { 30: null, 50: null } })).status).toBe(400)
    expect(await rows()).toEqual(before)
    expect(
      (await patch('products', { visible: false, pricesCents: { 30: null, 50: null } })).status,
    ).toBe(200)
    expect((await patch('products', { visible: true })).status).toBe(400)
    expect((await patch('products', { visible: true, pricesCents: { 50: 1 } })).status).toBe(200)
    expect((await patch('products', { pricesCents: { 50: null } })).status).toBe(400)
    expect(
      (
        (await (await patch('products', { visible: true, pricesCents: { 50: 1 } })).json()) as {
          changed: boolean
        }
      ).changed,
    ).toBe(false)
  })

  it('dois PATCHs concorrentes não conseguem remover todos os preços de produto visível', async () => {
    const responses = await Promise.all([
      patch('products', { pricesCents: { 30: null } }),
      patch('products', { pricesCents: { 50: null } }),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
    const row = await fixture.db
      .prepare('SELECT price_30_cents, price_50_cents FROM products WHERE id = ?')
      .bind('dronken')
      .first<{ price_30_cents: number | null; price_50_cents: number | null }>()
    expect(row && (row.price_30_cents !== null || row.price_50_cents !== null)).toBe(true)
  })
})
