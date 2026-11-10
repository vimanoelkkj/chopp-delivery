import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleLogin } from '../../server/auth/handlers'
import { handleExpandedCatalog, handlePublicCatalog } from '../../server/catalog-expansion/handlers'
import { validateExpanded } from '../../server/catalog-expansion/validation'
import type { ExpandedCatalog, PublicCatalog } from '../../shared/catalog'
import { splitChopes } from '../../src/features/catalog/presentation'
import { authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'
import { expansionFixture } from './expansion-fixture'

// F4A.5.3: variantes em produtos persistidos, contra o D1 descartável do harness (nada remoto).
type Variant = Record<string, unknown>
function writable(snapshot: ExpandedCatalog) {
  return {
    revision: snapshot.revision,
    categories: snapshot.categories.map((c) => ({
      ...c,
      items: c.items.map(({ creationRef: _ref, variants, ...item }) => ({
        ...item,
        variants: variants.map(({ creationRef: _v, ...v }) => v) as Variant[],
      })),
    })),
  }
}
type Body = ReturnType<typeof writable>
const tmp = () => `tmp:${crypto.randomUUID()}`
const fresh = (label: string, volumeMl: number, priceCents: number | null) => ({
  clientId: tmp(),
  label,
  volumeMl,
  priceCents,
})
const dronken = (b: Body) =>
  b.categories[0].items.find((i) => i.id === 'dronken') as Body['categories'][0]['items'][0]

describe('F4A.5.3: variantes de produtos persistidos', () => {
  let f: Awaited<ReturnType<typeof expansionFixture>>
  let cookie: string
  const request = (method: string, body?: unknown, revision?: string) =>
    new Request(`${TEST_ORIGIN}/api/admin/catalog/v2`, {
      method,
      headers: {
        Origin: TEST_ORIGIN,
        Cookie: cookie,
        'Content-Type': 'application/json',
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const load = async () =>
    (await (await handleExpandedCatalog(request('GET'), f.env)).json()) as ExpandedCatalog
  const save = (body: Body, revision: string) =>
    handleExpandedCatalog(request('PUT', body, revision), f.env)
  const rows = async () =>
    (
      await f.db.batch(
        ['catalog_items', 'catalog_variants'].map((t) => f.db.prepare(`SELECT * FROM ${t}`)),
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
    await f?.runtime.dispose()
  })

  it('produto padrão 30/50 L recebe uma variante de 20 L; salva, recarrega e preserva identidades', async () => {
    const before = await load()
    const original = before.categories[0].items.find((i) => i.id === 'dronken')
    const body = writable(before)
    const ref = tmp()
    dronken(body).variants.push({
      clientId: ref,
      label: 'Barril de 20 L',
      volumeMl: 20000,
      priceCents: 30000,
    })
    const response = await save(body, before.revision)
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      created: { variants: { itemId: string; clientId: string; code: string }[] }
    }
    expect(result.created.variants).toHaveLength(1)
    const created = result.created.variants[0]
    expect(created).toMatchObject({ itemId: 'dronken', clientId: ref })
    expect(created.code).toMatch(/^v_/)

    const reloaded = (await load()).categories[0].items.find((i) => i.id === 'dronken')
    expect(reloaded?.variants.map((v) => v.code)).toEqual(['30', '50', created.code])
    // 30/50 L: identidade, rótulo, volume e preço intactos; a nova guarda a creationRef.
    expect(reloaded?.variants.slice(0, 2)).toEqual(original?.variants)
    expect(reloaded?.variants[2]).toMatchObject({
      label: 'Barril de 20 L',
      volumeMl: 20000,
      priceCents: 30000,
      creationRef: ref,
    })
    // O resto do catálogo continua igual.
    expect((await load()).categories[0].items.filter((i) => i.id !== 'dronken')).toEqual(
      before.categories[0].items.filter((i) => i.id !== 'dronken'),
    )
  })

  it('a variante nova chega à vitrine dinâmica: tabela 30/50 intacta e 20 L na lista complementar', async () => {
    const before = await load()
    const body = writable(before)
    dronken(body).variants.push(fresh('Barril de 20 L', 20000, 30000))
    expect((await save(body, before.revision)).status).toBe(200)
    const publicCatalog = (await (
      await handlePublicCatalog(new Request(`${TEST_ORIGIN}/api/catalog`), f.db)
    ).json()) as PublicCatalog
    const { table, extras } = splitChopes(publicCatalog.categories[0].items)
    expect(table.find((p) => p.id === 'dronken')?.prices).toEqual({ 30: 510, 50: 650 })
    expect(extras.map((i) => i.id)).toEqual(['dronken'])
    expect(extras[0].variants.map((v) => [v.label, v.priceCents])).toEqual([
      ['Barril de 20 L', 30000],
    ])
  })

  it('duplicata exata (rótulo normalizado + volume) é rejeitada sem gravar nada', async () => {
    const before = await load()
    const snapshot = await rows()
    for (const label of ['Barril de 30 L', '  barril   DE 30 l ']) {
      const body = writable(before)
      dronken(body).variants.push(fresh(label, 30000, 100))
      const response = await save(body, before.revision)
      expect(response.status, label).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('rótulo e volume')
    }
    // Duas variantes novas iguais entre si.
    const twins = writable(before)
    dronken(twins).variants.push(fresh('Promo', 20000, 100), fresh(' promo ', 20000, 200))
    expect((await save(twins, before.revision)).status).toBe(400)
    expect(await rows()).toEqual(snapshot)
  })

  it('mesmo volume com rótulos diferentes continua válido', async () => {
    const before = await load()
    const body = writable(before)
    dronken(body).variants.push(
      fresh('Barril promocional 30 L', 30000, 40000),
      fresh('Barril 30 litros', 30000, 45000),
    )
    expect((await save(body, before.revision)).status).toBe(200)
    const labels = (await load()).categories[0].items
      .find((i) => i.id === 'dronken')
      ?.variants.map((v) => v.label)
    expect(labels).toEqual([
      'Barril de 30 L',
      'Barril de 50 L',
      'Barril promocional 30 L',
      'Barril 30 litros',
    ])
  })

  it('variante persistida não pode ser excluída (CATALOG_IDENTITY) e nada é gravado', async () => {
    const before = await load()
    const snapshot = await rows()
    const body = writable(before)
    dronken(body).variants = dronken(body).variants.filter((v) => v.code !== '50')
    expect((await save(body, before.revision)).status).toBe(400)
    expect(await rows()).toEqual(snapshot)
  })

  it('revisão antiga devolve 409 sem sobrescrever o que outra sessão salvou', async () => {
    const base = await load()
    const first = writable(base)
    dronken(first).variants.push(fresh('Barril de 20 L', 20000, 30000))
    expect((await save(first, base.revision)).status).toBe(200)
    const afterFirst = await rows()
    const stale = writable(base)
    dronken(stale).variants.push(fresh('Barril de 25 L', 25000, 35000))
    expect((await save(stale, base.revision)).status).toBe(409)
    expect(await rows()).toEqual(afterFirst)
  })

  it('catálogo original: salvar sem edições não muda itens nem variantes', async () => {
    const before = await load()
    const snapshot = await rows()
    expect((await save(writable(before), before.revision)).status).toBe(200)
    expect(await rows()).toEqual(snapshot)
    expect((await load()).categories).toEqual(before.categories)
  })
})

describe('F4A.5.3: validador, dado legado', () => {
  const item = (variants: Record<string, unknown>[]) => ({
    revision: 'r1',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [{ id: 'p', name: 'P', description: '', visible: true, variants }],
      },
    ],
  })
  const persisted = (code: string, label: string) => ({
    code,
    label,
    volumeMl: 20000,
    priceCents: 100,
  })

  it('par só de variantes persistidas iguais não bloqueia (tolerância ao legado)', () => {
    const result = validateExpanded(
      item([persisted('a', 'Igual'), persisted('b', ' igual ')]),
      'r1',
    )
    expect(result.fields).toBeUndefined()
  })

  it('variante nova igual a uma persistida é recusada, com a mensagem legível no campo', () => {
    const result = validateExpanded(
      item([persisted('a', 'Igual'), fresh('igual', 20000, 100)]),
      'r1',
    )
    expect(Object.values(result.fields ?? {})).toContain(
      'Já existe uma variante com este rótulo e volume neste produto.',
    )
  })
})
