import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { handleLogin } from '../../server/auth/handlers'
import { handleExpandedCatalog } from '../../server/catalog-expansion/handlers'
import { EXPANSION_LIMITS, validateExpanded } from '../../server/catalog-expansion/validation'
import type { ExpandedCatalog } from '../../shared/catalog'
import { authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'
import { expansionFixture } from './expansion-fixture'

it('orçamento real: 128 itens / 512 variantes em D1, leitura completa e no-op', async () => {
  const f = await expansionFixture()
  try {
    await seedOwner(f.db)
    const cookie =
      (await handleLogin(authRequest('login', { body: loginBody() }), f.env)).headers.get(
        'set-cookie',
      ) ?? ''
    const req = (method: string, body?: unknown, revision?: string) =>
      new Request(`${TEST_ORIGIN}/api/admin/catalog/v2`, {
        method,
        headers: {
          Origin: TEST_ORIGIN,
          Cookie: cookie,
          'Content-Type': 'application/json',
          ...(revision ? { 'If-Match': `"${revision}"` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const initial = (await (
      await handleExpandedCatalog(req('GET'), f.env)
    ).json()) as ExpandedCatalog
    const body = {
      revision: initial.revision,
      categories: initial.categories.map((c) => ({
        ...c,
        items: c.items.map(({ creationRef: _ref, variants, ...i }) => ({
          ...i,
          variants: variants.map(({ creationRef: _ref, ...v }) => v),
        })),
      })),
    } as { revision: string; categories: { id: string; name: string; items: unknown[] }[] }
    for (let n = 9; n < 128; n++)
      body.categories[0].items.push({
        clientId: `tmp:${crypto.randomUUID()}`,
        name: `Chope ${n}`,
        description: '',
        visible: true,
        variants: [],
      })
    let total = 17
    for (const c of body.categories)
      for (const raw of c.items) {
        const i = raw as { variants: unknown[] }
        while (i.variants.length < 4 && total < 512) {
          i.variants.push({
            clientId: `tmp:${crypto.randomUUID()}`,
            label: 'Barril',
            volumeMl: 20000,
            priceCents: 51029,
          })
          total++
        }
      }
    // 128 * 4 = 512, including original variants.
    expect(total).toBe(512)
    // Also exercise the per-item ceiling in the same real transaction.
    const first = body.categories[0].items[0] as { variants: unknown[] }
    for (let n = 0; n < 4; n++)
      first.variants.push({
        clientId: `tmp:${crypto.randomUUID()}`,
        label: 'Barril',
        volumeMl: 20000,
        priceCents: 51029,
      })
    const tail = body.categories[0].items.slice(-2) as { variants: unknown[] }[]
    tail[0].variants.pop()
    tail[1].variants.splice(1)
    expect(first.variants).toHaveLength(8)
    // Exercise the byte ceiling too, with valid multibyte descriptions.
    for (const raw of body.categories[0].items) {
      const i = raw as { description: string }
      const remaining =
        EXPANSION_LIMITS.bytes - new TextEncoder().encode(JSON.stringify(body)).length
      if (remaining <= 0) break
      i.description = '🍺'.repeat(Math.min(2000, Math.floor(remaining / 4)))
    }
    const padding = EXPANSION_LIMITS.bytes - new TextEncoder().encode(JSON.stringify(body)).length
    const last = body.categories[0].items.at(-1) as { description: string }
    last.description += 'a'.repeat(padding)
    const bytes = new TextEncoder().encode(JSON.stringify(body)).length
    expect(bytes).toBe(EXPANSION_LIMITS.bytes)
    const durations: number[] = []
    const db = new Proxy(f.db, {
      get(target, key, receiver) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements)
            durations.push(results.reduce((n, r) => n + r.meta.duration, 0))
            return results
          }
        return Reflect.get(target, key, receiver)
      },
    })
    const start = performance.now()
    const response = await handleExpandedCatalog(req('PUT', body, initial.revision), {
      ...f.env,
      DELEGAS_DB: db,
    })
    expect(response.status).toBe(200)
    const saved = ((await response.json()) as { catalog: ExpandedCatalog }).catalog
    expect(saved.categories.flatMap((c) => c.items)).toHaveLength(128)
    expect(saved.categories.flatMap((c) => c.items.flatMap((i) => i.variants))).toHaveLength(512)
    const noop = {
      revision: saved.revision,
      categories: saved.categories.map((c) => ({
        ...c,
        items: c.items.map(({ creationRef: _ref, variants, ...i }) => ({
          ...i,
          variants: variants.map(({ creationRef: _ref, ...v }) => v),
        })),
      })),
    }
    const again = await handleExpandedCatalog(req('PUT', noop, saved.revision), {
      ...f.env,
      DELEGAS_DB: db,
    })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { catalog: ExpandedCatalog }).catalog).toEqual(saved)
    const oversized = new Request(req('PUT', body, saved.revision), {
      body: `${JSON.stringify(body)} `,
    })
    expect((await handleExpandedCatalog(oversized, f.env)).status).toBe(400)
    await writeFile(
      join(tmpdir(), 'delegas-f3a2-budget.json'),
      JSON.stringify(
        {
          bytes,
          items: 128,
          variants: 512,
          maxVariantsPerItem: 8,
          sqlDurationsMs: durations,
          elapsedMs: performance.now() - start,
        },
        null,
        2,
      ),
    )
  } finally {
    await f.runtime.dispose()
  }
})

it('orçamentos estruturais rejeitam excesso sem truncar e aceitam oito variantes', () => {
  const variant = () => ({
    clientId: `tmp:${crypto.randomUUID()}`,
    label: 'Barril',
    volumeMl: 20000,
    priceCents: 100,
  })
  const item = (count = 8) => ({
    clientId: `tmp:${crypto.randomUUID()}`,
    name: 'Chope',
    description: '',
    visible: true,
    variants: Array.from({ length: count }, variant),
  })
  const body = (items: unknown[]) => ({
    revision: 'r1',
    categories: [{ id: 'chopes', name: 'Chopes', items }],
  })
  expect(validateExpanded(body([item()]), 'r1').fields).toBeUndefined()
  expect(validateExpanded(body([item(9)]), 'r1').fields).toBeDefined()
  expect(
    validateExpanded(body(Array.from({ length: 129 }, () => item(1))), 'r1').fields,
  ).toBeDefined()
  expect(
    validateExpanded(body(Array.from({ length: 65 }, () => item(8))), 'r1').fields,
  ).toBeDefined()
})
