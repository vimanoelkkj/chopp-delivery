import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleLogin, handleLogout } from '../../server/auth/handlers'
import { handleExpandedCatalog, handlePublicCatalog } from '../../server/catalog-expansion/handlers'
import {
  buildSaveInput,
  draftFrom,
  newItemDraft,
  newVariantDraft,
} from '../../src/features/admin/catalog/draft'
import { createHttpGateway } from '../../src/features/admin/catalog/httpGateway'
import {
  performSave,
  rebaseAfterApplied,
  recoverUncertain,
} from '../../src/features/admin/catalog/saveFlow'
import { initial, reducer } from '../../src/features/admin/catalog/useCatalogEditor'
import { authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'
import { expansionFixture } from './expansion-fixture'

// Only the transport can fail. All responses and catalog state come from real handlers/D1.
describe('panel HTTP gateway with real F2/v2 handlers and disposable D1', () => {
  let f: Awaited<ReturnType<typeof expansionFixture>>
  beforeEach(async () => {
    f = await expansionFixture()
    await seedOwner(f.db)
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  async function client() {
    const login = await handleLogin(authRequest('login', { body: loginBody() }), f.env)
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(cookie).toContain('delegas_admin_local_session=')
    let fault: 'before' | 'after' | null = null
    let origin = TEST_ORIGIN
    const puts: { status: number; etag: string | null }[] = []
    const gateway = createHttpGateway({
      fetch: async (path, init) => {
        const request = new Request(`${TEST_ORIGIN}${path}`, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Cookie: cookie,
            Origin: origin,
          },
        })
        if (request.method === 'PUT' && fault === 'before') {
          fault = null
          puts.push({ status: 0, etag: request.headers.get('If-Match') })
          throw new TypeError('connection lost before dispatch')
        }
        const response = await handleExpandedCatalog(request, f.env)
        if (request.method === 'PUT') {
          puts.push({ status: response.status, etag: request.headers.get('If-Match') })
          if (fault === 'after') {
            fault = null
            throw new TypeError('connection lost after commit')
          }
        }
        return response
      },
    })
    return {
      gateway,
      cookie,
      puts,
      fail: (where: typeof fault) => {
        fault = where
      },
      setOrigin: (value: string) => {
        origin = value
      },
    }
  }
  const state = async () =>
    (
      await f.db.batch(
        ['catalog_items', 'catalog_variants', 'catalog_meta'].map((table) =>
          f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`),
        ),
      )
    ).map((result) => result.results)
  const priceInDb = () =>
    f.db
      .prepare('SELECT price_cents FROM catalog_variants WHERE item_id=? AND code=?')
      .bind('dronken', '30')
      .first('price_cents')

  it('A/B/M: login, panel-built PUT/If-Match, exact decimal cents and subsequent GET', async () => {
    const c = await client(),
      base = await c.gateway.load(),
      draft = draftFrom(base)
    draft.items.dronken.variants[0].priceText = '510,29'
    const result = await performSave(c.gateway, base, draft)
    expect(result.kind).toBe('saved')
    expect(c.puts).toEqual([{ status: 200, etag: JSON.stringify(base.revision) }])
    expect(await priceInDb()).toBe(51029)
    expect((await c.gateway.load()).categories[0].items[0].variants[0].priceCents).toBe(51029)
  })

  it('C/D/E/L: creations get definitive IDs, multiple sizes, 700 ml, null and public filtering', async () => {
    const c = await client(),
      base = await c.gateway.load(),
      draft = draftFrom(base)
    const chope = newItemDraft('chopes'),
      bottle = newItemDraft('cachacas')
    chope.name = 'Chope real'
    chope.visible = true
    Object.assign(chope.variants[0], {
      label: 'Barril 20 L',
      volumeText: '20',
      priceText: '123,45',
    })
    chope.variants.push({
      ...newVariantDraft(),
      label: 'Barril 7,5 L',
      volumeText: '7,5',
      priceText: '',
    })
    bottle.name = 'Cachaca real'
    bottle.visible = true
    Object.assign(bottle.variants[0], {
      label: 'Garrafa 700 ml',
      volumeText: '700',
      priceText: '25,01',
    })
    for (const item of [chope, bottle]) {
      draft.items[item.key] = item
      draft.order[item.categoryId].push(item.key)
    }
    const saved = await performSave(c.gateway, base, draft)
    expect(saved.kind).toBe('saved')
    if (saved.kind !== 'saved') throw new Error(saved.kind)
    expect(saved.result.created.items).toHaveLength(2)
    const next = await c.gateway.load()
    const real = next.categories[0].items.find((item) => item.creationRef === chope.key)
    expect(real?.id).not.toBe(chope.key)
    expect(real?.variants.map((v) => [v.volumeMl, v.priceCents])).toEqual([
      [20000, 12345],
      [7500, null],
    ])
    expect(
      next.categories[1].items.find((item) => item.creationRef === bottle.key)?.variants[0]
        .volumeMl,
    ).toBe(700)
    const persisted = await f.db
      .prepare(
        'SELECT volume_ml, price_cents FROM catalog_variants WHERE item_id=? ORDER BY sort_order',
      )
      .bind(real?.id)
      .all()
    expect(persisted.results).toEqual([
      { volume_ml: 20000, price_cents: 12345 },
      { volume_ml: 7500, price_cents: null },
    ])
    const hidden = draftFrom(next)
    hidden.items[chope.key].visible = false
    expect((await performSave(c.gateway, next, hidden)).kind).toBe('saved')
    expect(
      (await c.gateway.load()).categories[0].items.find((item) => item.id === real?.id)?.visible,
    ).toBe(false)
    const publicData = (await (
      await handlePublicCatalog(new Request(`${TEST_ORIGIN}/api/catalog`), f.db)
    ).json()) as { categories: { items: { id: string }[] }[] }
    expect(publicData.categories[0].items.some((item) => item.id === real?.id)).toBe(false)
  })

  it('F: concurrent real sessions accept one write and conflict the stale revision', async () => {
    const a = await client(),
      b = await client(),
      base = await a.gateway.load()
    const da = draftFrom(base),
      db = draftFrom(base)
    da.items.dronken.name = 'Session A'
    db.items.dronken.name = 'Session B'
    const results = await Promise.all([
      performSave(a.gateway, base, da),
      performSave(b.gateway, base, db),
    ])
    expect(results.map((r) => r.kind).sort()).toEqual(['conflict', 'saved'])
    expect([...a.puts, ...b.puts].map((p) => p.status).sort()).toEqual([200, 409])
  })

  it.each(['logout', 'expired'] as const)(
    'G: %s refuses mutations without DB changes',
    async (mode) => {
      const c = await client(),
        base = await c.gateway.load(),
        draft = draftFrom(base)
      draft.items.dronken.name = 'Must not persist'
      if (mode === 'logout')
        expect(
          (await handleLogout(authRequest('logout', { cookie: c.cookie }), f.env)).status,
        ).toBe(200)
      else await f.db.prepare('UPDATE admin_sessions SET created_at=1, expires_at=2').run()
      const before = await state()
      expect((await performSave(c.gateway, base, draft)).kind).toBe('unauthenticated')
      expect(await state()).toEqual(before)
    },
  )

  it('H: invalid Origin is forbidden, with no mutation or uncertain retry', async () => {
    const c = await client(),
      base = await c.gateway.load(),
      draft = draftFrom(base),
      before = await state()
    draft.items.dronken.name = 'Forbidden'
    c.setOrigin('https://attacker.invalid')
    expect((await performSave(c.gateway, base, draft)).kind).toBe('forbidden')
    expect(c.puts[0].status).toBe(403)
    expect(await state()).toEqual(before)
  })

  it.each(['before', 'after'] as const)(
    'I/J: lost %s commit reconciles only by GET',
    async (where) => {
      const c = await client(),
        base = await c.gateway.load(),
        draft = draftFrom(base)
      draft.items.dronken.variants[0].priceText = '600,39'
      c.fail(where)
      const outcome = await performSave(c.gateway, base, draft)
      expect(outcome.kind).toBe('uncertain')
      if (outcome.kind !== 'uncertain') throw new Error(outcome.kind)
      expect((await recoverUncertain(c.gateway, outcome.input)).kind).toBe(
        where === 'after' ? 'applied' : 'not-applied',
      )
      expect(c.puts).toHaveLength(1)
      expect(await priceInDb()).toBe(where === 'after' ? 60039 : 51000)
      expect(draft.items.dronken.variants[0].priceText).toBe('600,39')
    },
  )

  it.each(['new item', 'existing item'] as const)(
    'K: %s, lost response, later edits and second save preserve ml and identities',
    async (parent) => {
      const c = await client(),
        base = await c.gateway.load(),
        draft = draftFrom(base)
      const item = parent === 'new item' ? newItemDraft('chopes') : draft.items.dronken
      if (parent === 'new item') {
        item.name = 'New chope'
        draft.items[item.key] = item
        draft.order.chopes.push(item.key)
      }
      const variant = parent === 'new item' ? item.variants[0] : newVariantDraft()
      if (parent === 'existing item') item.variants.push(variant)
      Object.assign(variant, { label: 'Barril 20 L', volumeText: '20', priceText: '123,45' })
      c.fail('after')
      const sent = await performSave(c.gateway, base, draft)
      expect(sent.kind).toBe('uncertain')
      if (sent.kind !== 'uncertain') throw new Error(sent.kind)
      item.name = 'Edited after uncertain attempt'
      variant.priceText = '127,89'
      const recovery = await recoverUncertain(c.gateway, sent.input)
      expect(recovery.kind).toBe('applied')
      if (recovery.kind !== 'applied') throw new Error(recovery.kind)
      const rebased = rebaseAfterApplied(sent.input, base, draft, recovery.snapshot)
      expect(rebased).not.toBeNull()
      if (!rebased) throw new Error('Missing rebased draft')
      const next = await performSave(c.gateway, recovery.snapshot, rebased)
      expect(next.kind).toBe('saved')
      expect(c.puts).toHaveLength(2)
      expect(
        await f.db
          .prepare('SELECT volume_ml, price_cents FROM catalog_variants WHERE creation_ref=?')
          .bind(variant.key)
          .first(),
      ).toEqual({ volume_ml: 20000, price_cents: 12789 })
      expect(
        (await c.gateway.load()).categories[0].items.find(
          (i) => i.id === rebased?.items[item.key].id,
        )?.name,
      ).toBe(item.name)
    },
  )

  it('uncertain creation cannot be removed/discarded before reconciliation, while later price edits remain possible', async () => {
    const c = await client(),
      base = await c.gateway.load(),
      draft = draftFrom(base),
      item = newItemDraft('chopes')
    item.name = 'Pending'
    Object.assign(item.variants[0], { label: '20 L', volumeText: '20', priceText: '100,00' })
    draft.items[item.key] = item
    draft.order.chopes.push(item.key)
    const pending = {
      ...initial,
      load: { status: 'ready' as const, saved: base },
      draft,
      uncertain: buildSaveInput(base, draft),
    }
    for (const state of [pending, { ...pending, uncertain: null, saving: true }]) {
      for (const action of [
        { type: 'cancel-item' as const, key: item.key },
        { type: 'remove-variant' as const, key: item.key, variant: item.variants[0].key },
        { type: 'discard' as const },
        {
          type: 'variant-field' as const,
          key: item.key,
          variant: item.variants[0].key,
          field: 'label' as const,
          text: 'Later label',
        },
        {
          type: 'variant-field' as const,
          key: item.key,
          variant: item.variants[0].key,
          field: 'volumeText' as const,
          text: '25',
        },
      ])
        expect(reducer(state, action)).toBe(state)
    }
    expect(
      reducer(pending, {
        type: 'variant-field',
        key: item.key,
        variant: item.variants[0].key,
        field: 'priceText',
        text: '110,00',
      }).draft?.items[item.key].variants[0].priceText,
    ).toBe('110,00')
  })
})
