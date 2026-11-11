import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleLogin } from '../../server/auth/handlers'
import { sqlFailureTag } from '../../server/catalog-expansion/diagnostics'
import { handleExpandedCatalog } from '../../server/catalog-expansion/handlers'
import type { ExpandedCatalog } from '../../shared/catalog'
import { applyTestMigration, authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'
import { expansionFixture } from './expansion-fixture'

vi.setConfig({ testTimeout: 120_000 })

// P0 SQLITE_ERROR 7500 no D1 remoto: o gatilho catalog_write_command (0005) estourava o limite de complexidade
// do D1. A 0014 troca só os três UPDATE ... FROM (WITH ... MATERIALIZED ...) de reordenação.
const MIGRATION = '0014_catalog_write_trigger_lighter_ordering.sql'
const read = (file: string) => readFileSync(`migrations/${file}`, 'utf8')

function triggerStatements(sql: string): string[] {
  const start = sql.indexOf('CREATE TRIGGER catalog_write_command')
  const body = sql.slice(sql.indexOf('BEGIN', start) + 5, sql.indexOf('\nEND;', start))
  const out: string[] = []
  let current: string[] = []
  for (const line of body.split('\n')) {
    if (line.trim().startsWith('--') && current.length === 0) continue
    current.push(line)
    if (/;\s*$/.test(line) && !line.trim().startsWith('--')) {
      out.push(
        current
          .filter((l) => !l.trim().startsWith('--'))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      current = []
    }
  }
  return out
}
const raises = (sql: string) =>
  [...sql.matchAll(/RAISE\(ABORT,\s*'([A-Z_]+)'\)/g)].map((m) => m[1]).sort()
const ORDERING = [14, 16, 18] // índices (0-based) dos statements de reordenação

describe('0014: contrato do gatilho catalog_write_command', () => {
  const old = triggerStatements(read('0005_catalog_expansion.sql'))
  const next = triggerStatements(read(MIGRATION))

  it('mantém 27 statements e troca somente os três de reordenação', () => {
    expect(old).toHaveLength(27)
    expect(next).toHaveLength(27)
    old.forEach((statement, index) => {
      if (ORDERING.includes(index)) expect(next[index]).not.toBe(statement)
      else expect(next[index]).toBe(statement)
    })
  })

  it('causa do 7500: nenhum UPDATE ... FROM (WITH ... MATERIALIZED) restou no programa do gatilho', () => {
    expect(old.filter((s) => /FROM \(WITH desired AS MATERIALIZED/.test(s))).toHaveLength(3)
    expect(
      next.filter((s) => /MATERIALIZED|WITH desired|\bSET sort_order = d\.target FROM\b/.test(s)),
    ).toEqual([])
    for (const index of ORDERING)
      expect(next[index]).toMatch(
        /^UPDATE catalog_(categories|items|variants) SET sort_order = \(SELECT json_extract/,
      )
  })

  it('preserva todos os códigos de erro e a contagem de RAISE', () => {
    expect(raises(read(MIGRATION))).toEqual(
      raises(
        read('0005_catalog_expansion.sql').slice(
          read('0005_catalog_expansion.sql').indexOf('CREATE TRIGGER catalog_write_command'),
          read('0005_catalog_expansion.sql').indexOf(
            '\nEND;',
            read('0005_catalog_expansion.sql').indexOf('CREATE TRIGGER catalog_write_command'),
          ),
        ),
      ),
    )
    expect(new Set(raises(read(MIGRATION)))).toEqual(
      new Set([
        'CATALOG_SCHEMA_UNAVAILABLE',
        'CATALOG_IDENTITY',
        'CATALOG_INCOMPLETE',
        'CATALOG_RULE',
        'CATALOG_UNAUTHORIZED',
        'CATALOG_META_UNAVAILABLE',
      ]),
    )
  })

  it('é aditiva: só recria o gatilho com o mesmo nome e não toca em tabelas ou dados', () => {
    const sql = read(MIGRATION).replace(/^--.*$/gm, '')
    expect(
      sql
        .match(/^(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE)\b[^\n]*/gm)
        ?.filter((l) => !/^(UPDATE catalog_)/.test(l))
        .slice(0, 2),
    ).toEqual([
      'DROP TRIGGER catalog_write_command;',
      'CREATE TRIGGER catalog_write_command INSTEAD OF UPDATE ON catalog_write',
    ])
    expect(sql).not.toMatch(/\b(CREATE|DROP|ALTER) (TABLE|VIEW|INDEX)\b/)
    expect((sql.match(/CREATE TRIGGER/g) ?? []).length).toBe(1)
  })
})

type Db = D1Database
type Cmd = {
  categories: { id: string; name: string; position: number }[]
  items: {
    id: string
    isNew: boolean
    creationRef: string | null
    categoryId: string
    name: string
    description: string
    visible: boolean
    position: number
  }[]
  variants: {
    itemId: string
    code: string
    isNew: boolean
    creationRef: string | null
    label: string
    volumeMl: number | null
    priceCents: number | null
    position: number
  }[]
}
type Row = Record<string, unknown>
const all = async (db: Db, sql: string) => (await db.prepare(sql).all<Row>()).results

async function readCmd(db: Db): Promise<Cmd> {
  const categories = await all(db, 'SELECT id,name FROM catalog_categories ORDER BY sort_order,id')
  const cmd: Cmd = { categories: [], items: [], variants: [] }
  let ci = 0
  for (const category of categories) {
    cmd.categories.push({ id: String(category.id), name: String(category.name), position: ci++ })
    const items = await all(
      db,
      `SELECT * FROM catalog_items WHERE category_id='${category.id}' ORDER BY sort_order,id`,
    )
    items.forEach((item, position) => {
      cmd.items.push({
        id: String(item.id),
        isNew: false,
        creationRef: null,
        categoryId: String(category.id),
        name: String(item.name),
        description: String(item.description),
        visible: item.visible === 1,
        position,
      })
    })
  }
  for (const item of cmd.items) {
    const variants = await all(
      db,
      `SELECT * FROM catalog_variants WHERE item_id='${item.id}' ORDER BY sort_order,code`,
    )
    variants.forEach((v, position) => {
      cmd.variants.push({
        itemId: item.id,
        code: String(v.code),
        isNew: false,
        creationRef: null,
        label: String(v.label),
        volumeMl: v.volume_ml as number | null,
        priceCents: v.price_cents as number | null,
        position,
      })
    })
  }
  return cmd
}
const state = async (db: Db) => ({
  meta: await all(db, 'SELECT * FROM catalog_meta'),
  categories: await all(db, 'SELECT * FROM catalog_categories ORDER BY id'),
  items: await all(db, 'SELECT * FROM catalog_items ORDER BY id'),
  variants: await all(db, 'SELECT * FROM catalog_variants ORDER BY item_id,code'),
})
const ref = () => `tmp:${crypto.randomUUID()}`

type Fx = Awaited<ReturnType<typeof expansionFixture>>
async function fixture(migrated: boolean) {
  const f = await expansionFixture()
  try {
    if (migrated) {
      await applyTestMigration(f.db, MIGRATION)
      await f.db.prepare('INSERT INTO d1_migrations VALUES (?)').bind(MIGRATION).run()
    }
    await seedOwner(f.db)
    const cookie =
      (await handleLogin(authRequest('login', { body: loginBody() }), f.env)).headers.get(
        'set-cookie',
      ) ?? ''
    const session = (
      await all(f.db, 'SELECT token_hash,user_id,origin FROM admin_sessions LIMIT 1')
    )[0]
    return { f, cookie, session }
  } catch (error) {
    await f.runtime.dispose()
    throw error
  }
}
async function save(db: Db, cmd: unknown, revision: number, session: Row) {
  try {
    const r = await db
      .prepare(
        'UPDATE catalog_write SET payload=?, session_hash=?, user_id=?, origin=? WHERE singleton=1 AND revision=? RETURNING 1 AS accepted',
      )
      .bind(JSON.stringify(cmd), session.token_hash, session.user_id, session.origin, revision)
      .all()
    return { rows: r.results.length }
  } catch (error) {
    return {
      error: (/CATALOG_[A-Z_]+/.exec(String(error instanceof Error ? error.message : error)) ?? [
        'OUTRO',
      ])[0],
    }
  }
}
const revisionOf = async (db: Db) =>
  Number((await all(db, 'SELECT revision FROM catalog_meta'))[0].revision)

describe('0014: equivalência com o gatilho da 0005 (D1 Miniflare, comparação lado a lado)', () => {
  const open: Fx[] = []
  afterEach(async () => {
    await Promise.all(open.splice(0).map((f) => f.runtime.dispose()))
  })
  const pair = async () => {
    const [a, b] = await Promise.all([fixture(false), fixture(true)])
    open.push(a.f, b.f)
    return [a, b] as const
  }
  const chopes = (cmd: Cmd) => cmd.items.filter((i) => i.categoryId === 'chopes')

  type Scenario = [string, (cmd: Cmd) => void, string?]
  const scenarios: Scenario[] = [
    ['sem alterações', () => {}],
    [
      'editar preço',
      (c) => {
        const v = c.variants.find((x) => x.priceCents !== null)
        if (v?.priceCents) v.priceCents += 100
      },
    ],
    [
      'editar nome e descrição',
      (c) => {
        chopes(c)[1].name += ' (edit)'
        chopes(c)[1].description = 'x'
      },
    ],
    [
      'ocultar item',
      (c) => {
        chopes(c)[2].visible = false
      },
    ],
    [
      'reordenar dois itens',
      (c) => {
        const [a, b] = chopes(c)
        ;[a.position, b.position] = [b.position, a.position]
      },
    ],
    [
      'inverter todos os itens de chopes',
      (c) => {
        const l = chopes(c)
        l.forEach((i, n) => {
          i.position = l.length - 1 - n
        })
      },
    ],
    [
      'inverter categorias',
      (c) => {
        c.categories.forEach((x, n) => {
          x.position = c.categories.length - 1 - n
        })
      },
    ],
    [
      'reordenar variantes',
      (c) => {
        const v = c.variants.filter((x) => x.itemId === chopes(c)[0].id)
        ;[v[0].position, v[1].position] = [v[1].position, v[0].position]
      },
    ],
    [
      'criar item oculto com variante',
      (c) => {
        const id = `item_${crypto.randomUUID()}`
        c.items.push({
          id,
          isNew: true,
          creationRef: ref(),
          categoryId: 'chopes',
          name: 'Novo',
          description: 'x',
          visible: false,
          position: chopes(c).length,
        })
        c.variants.push({
          itemId: id,
          code: `v_${crypto.randomUUID()}`,
          isNew: true,
          creationRef: ref(),
          label: 'Teste',
          volumeMl: 20000,
          priceCents: 100,
          position: 0,
        })
      },
    ],
    [
      'criar item no meio da ordem',
      (c) => {
        const id = `item_${crypto.randomUUID()}`
        for (const i of chopes(c)) if (i.position >= 1) i.position += 1
        c.items.push({
          id,
          isNew: true,
          creationRef: ref(),
          categoryId: 'chopes',
          name: 'No meio',
          description: 'x',
          visible: true,
          position: 1,
        })
        c.variants.push({
          itemId: id,
          code: `v_${crypto.randomUUID()}`,
          isNew: true,
          creationRef: ref(),
          label: 'T',
          volumeMl: 1000,
          priceCents: 5,
          position: 0,
        })
      },
    ],
    [
      'adicionar variante',
      (c) => {
        c.variants.push({
          itemId: chopes(c)[0].id,
          code: `v_${crypto.randomUUID()}`,
          isNew: true,
          creationRef: ref(),
          label: 'Extra',
          volumeMl: 10000,
          priceCents: 9,
          position: 2,
        })
      },
    ],
    // erros do próprio gatilho (cada um precisa deixar o estado intacto nos dois bancos)
    [
      'identidade: item removido',
      (c) => {
        c.items.pop()
      },
    ],
    [
      'identidade: item movido de categoria',
      (c) => {
        c.items[0].categoryId = 'cachacas'
      },
    ],
    [
      'identidade: variante removida',
      (c) => {
        c.variants.pop()
      },
    ],
    [
      'regra: item visível sem preço, após statements aplicados',
      (c) => {
        const v = c.variants.find((x) => x.priceCents)
        if (v?.priceCents) v.priceCents += 7
        const victim = chopes(c).find(
          (i) => i.visible && c.variants.some((x) => x.itemId === i.id && x.priceCents),
        )
        for (const x of c.variants.filter((y) => y.itemId === victim?.id)) x.priceCents = null
        const id = `item_${crypto.randomUUID()}`
        c.items.push({
          id,
          isNew: true,
          creationRef: ref(),
          categoryId: 'chopes',
          name: 'Rollback',
          description: 'x',
          visible: false,
          position: 99,
        })
        c.variants.push({
          itemId: id,
          code: `v_${crypto.randomUUID()}`,
          isNew: true,
          creationRef: ref(),
          label: 'v',
          volumeMl: 1,
          priceCents: 1,
          position: 0,
        })
      },
    ],
  ]

  it.each(scenarios)(
    '%s: resultado e estado idênticos ao gatilho original',
    async (_name, mutate) => {
      const [a, b] = await pair()
      const [ca, cb] = [await readCmd(a.f.db), await readCmd(b.f.db)]
      mutate(ca)
      mutate(cb)
      // ids novos diferem entre os dois bancos; normaliza para comparar apenas o resultado estrutural
      const ra = await save(a.f.db, ca, await revisionOf(a.f.db), a.session)
      const rb = await save(b.f.db, cb, await revisionOf(b.f.db), b.session)
      expect(rb).toEqual(ra)
      const norm = async (db: Db) => {
        const s = await state(db)
        const ids = (s.items as Row[])
          .map((i) => String(i.id))
          .filter((id) => id.startsWith('item_'))
        const text = JSON.stringify(s)
        return ids
          .reduce((acc, id, n) => acc.replaceAll(id, `NEW${n}`), text)
          .replace(/v_[0-9a-f-]{36}/g, 'VNEW')
          .replace(/tmp:[0-9a-f-]{36}/g, 'REF')
      }
      expect(await norm(b.f.db)).toBe(await norm(a.f.db))
    },
  )

  it('erros do gatilho não deixam rastros (revisão, itens e variantes intactos) na 0014', async () => {
    const { f, session } = (await pair())[1]
    const before = await state(f.db)
    for (const [name, mutate] of scenarios.filter(
      ([n]) => n.startsWith('identidade') || n.startsWith('regra'),
    )) {
      const cmd = await readCmd(f.db)
      mutate(cmd)
      const result = await save(f.db, cmd, await revisionOf(f.db), session)
      expect(result.error, name).toMatch(/CATALOG_(IDENTITY|INCOMPLETE|RULE)/)
      expect(await state(f.db), name).toEqual(before)
    }
  })

  it('revisão defasada e sessão inválida: nada é gravado (0 linhas / CATALOG_UNAUTHORIZED)', async () => {
    const { f, session } = (await pair())[1]
    const before = await state(f.db)
    const cmd = await readCmd(f.db)
    const priced = cmd.variants.find((v) => v.priceCents !== null)
    if (priced?.priceCents == null) throw new Error('seed sem variante com preço')
    priced.priceCents += 1
    expect(await save(f.db, cmd, (await revisionOf(f.db)) - 1, session)).toEqual({ rows: 0 })
    expect(
      await save(f.db, cmd, await revisionOf(f.db), { ...session, token_hash: 'f'.repeat(64) }),
    ).toEqual({ error: 'CATALOG_UNAUTHORIZED' })
    expect(await state(f.db)).toEqual(before)
  })

  it('posições não contíguas na mesma ordem relativa não geram revisão (mesma regra da 0005)', async () => {
    const [a, b] = await pair()
    for (const { f } of [a, b]) {
      await f.db
        .prepare(
          "UPDATE catalog_items SET sort_order = sort_order * 10 + 5 WHERE category_id='chopes'",
        )
        .run()
    }
    const [ra, rb] = [await revisionOf(a.f.db), await revisionOf(b.f.db)]
    expect(rb).toBe(ra)
    for (const x of [a, b]) {
      const cmd = await readCmd(x.f.db)
      const r = await save(x.f.db, cmd, await revisionOf(x.f.db), x.session)
      expect(r).toEqual({ rows: 1 })
    }
    expect(await revisionOf(b.f.db)).toBe(await revisionOf(a.f.db))
    expect(await revisionOf(b.f.db)).toBe(rb)
    expect((await state(b.f.db)).items).toEqual((await state(a.f.db)).items)
  })

  it('empate de sort_order desempata por id e a nova ordem é regravada igual nos dois', async () => {
    const [a, b] = await pair()
    for (const { f } of [a, b])
      await f.db.prepare("UPDATE catalog_items SET sort_order = 3 WHERE category_id='chopes'").run()
    for (const x of [a, b]) {
      const cmd = await readCmd(x.f.db)
      const l = cmd.items.filter((i) => i.categoryId === 'chopes')
      l.forEach((i, n) => {
        i.position = l.length - 1 - n
      })
      expect(await save(x.f.db, cmd, await revisionOf(x.f.db), x.session)).toEqual({ rows: 1 })
    }
    expect((await state(b.f.db)).items).toEqual((await state(a.f.db)).items)
    expect(await revisionOf(b.f.db)).toBe(await revisionOf(a.f.db))
  })

  it('catalog_ready continua verdadeiro e o preflight enxerga o gatilho após a 0014', async () => {
    const { f } = (await pair())[1]
    expect((await all(f.db, 'SELECT count(*) AS n FROM catalog_ready'))[0].n).toBe(1)
    expect(
      (
        await all(
          f.db,
          "SELECT name FROM sqlite_schema WHERE type='trigger' AND name='catalog_write_command'",
        )
      ).length,
    ).toBe(1)
  })
})

describe('0014: PUT /api/admin/catalog/v2 pelo handler real', () => {
  const open: Fx[] = []
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(open.splice(0).map((f) => f.runtime.dispose()))
  })
  const writable = (s: ExpandedCatalog) => ({
    revision: s.revision,
    categories: s.categories.map((c) => ({
      ...c,
      items: c.items.map(({ creationRef: _r, variants, ...item }) => ({
        ...item,
        variants: variants.map(({ creationRef: _v, ...v }) => v),
      })),
    })),
  })
  async function ready() {
    const x = await fixture(true)
    open.push(x.f)
    const req = (method: string, body?: unknown, revision?: string) =>
      new Request(`${TEST_ORIGIN}/api/admin/catalog/v2`, {
        method,
        headers: {
          Origin: TEST_ORIGIN,
          Cookie: x.cookie,
          'Content-Type': 'application/json',
          ...(revision ? { 'If-Match': `"${revision}"` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const load = async () =>
      (await (await handleExpandedCatalog(req('GET'), x.f.env)).json()) as ExpandedCatalog
    const put = (body: unknown, revision: string) =>
      handleExpandedCatalog(req('PUT', body, revision), x.f.env)
    return { ...x, load, put, req }
  }

  it('cria produto, edita preço, reordena e responde 409 para revisão defasada', async () => {
    const { f, load, put } = await ready()
    let snapshot = await load()
    const before = snapshot.revision
    const body = writable(snapshot) as ReturnType<typeof writable> & {
      categories: { items: unknown[] }[]
    }
    body.categories[0].items.push({
      clientId: ref(),
      name: 'ZZ TESTE',
      description: 'x',
      visible: false,
      variants: [{ clientId: ref(), label: 'Teste 20 L', volumeMl: 20000, priceCents: 100 }],
    })
    const created = await put(body, before)
    expect(created.status).toBe(200)
    snapshot = ((await created.json()) as { catalog: ExpandedCatalog }).catalog
    expect(snapshot.categories[0].items.at(-1)?.name).toBe('ZZ TESTE')
    const reorder = writable(snapshot)
    reorder.categories[0].items.reverse()
    const reordered = await put(reorder, snapshot.revision)
    expect(reordered.status).toBe(200)
    const stale = await put({ ...writable(snapshot), revision: before }, before)
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe(
      'CATALOG_CONFLICT',
    )
    expect((await load()).categories[0].items.map((i) => i.id)).toEqual(
      reorder.categories[0].items.map((i) => i.id),
    )
    expect((await all(f.db, 'SELECT count(*) AS n FROM catalog_items'))[0].n).toBe(10)
  })

  it('payload inválido é recusado e o banco permanece idêntico (rollback)', async () => {
    const { f, load, put } = await ready()
    const snapshot = await load()
    const before = await state(f.db)
    const missing = writable(snapshot)
    missing.categories[0].items.pop()
    const response = await put(missing, snapshot.revision)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await state(f.db)).toEqual(before)
  })

  it('falha inesperada do D1 vira 503 com diagnóstico sanitizado (sem consulta, payload ou credencial)', async () => {
    const { f, load, req } = await ready()
    const snapshot = await load()
    const secret = "INSERT INTO t VALUES('tok_SECRET','Bearer abc.def') -- SQLITE_ERROR"
    const failing = new Proxy(f.db, {
      get(target, property) {
        if (property === 'batch')
          return async () => {
            throw new Error(
              `D1_ERROR: ${secret}: VIEWs and/or subqueries nested too deep: SQLITE_ERROR [code: 7500]`,
            )
          }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handleExpandedCatalog(
      req('PUT', writable(snapshot), snapshot.revision),
      { ...f.env, DELEGAS_DB: failing as D1Database },
    )
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'CATALOG_UNAVAILABLE',
    )
    expect(spy).toHaveBeenCalledWith(
      'ADMIN_CATALOG_V2_UNAVAILABLE',
      'SQLITE_ERROR code=7500 NESTED_TOO_DEEP',
    )
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).not.toMatch(/SECRET|Bearer|INSERT|payload/i)
  })
})

describe('sqlFailureTag', () => {
  it('extrai apenas códigos de lista fechada', () => {
    expect(
      sqlFailureTag(
        new Error('x: VIEWs and/or subqueries nested too deep: SQLITE_ERROR [code: 7500]'),
      ),
    ).toBe('SQLITE_ERROR code=7500 NESTED_TOO_DEEP')
    expect(sqlFailureTag(new Error('D1_ERROR: CATALOG_META_UNAVAILABLE: SQLITE_CONSTRAINT'))).toBe(
      'CATALOG_META_UNAVAILABLE SQLITE_CONSTRAINT CONSTRAINT',
    )
    expect(sqlFailureTag('texto livre com senha=abc')).toBe('UNKNOWN')
    expect(sqlFailureTag(undefined)).toBe('UNKNOWN')
  })
  it('nunca repete trechos arbitrários da mensagem', () => {
    const tag = sqlFailureTag(
      new Error(
        "INSERT INTO usuarios VALUES ('a@b.c','hash') SQLITE_ERROR token=abc123 [code: 7500]",
      ),
    )
    expect(tag).toBe('SQLITE_ERROR code=7500')
    expect(tag).not.toMatch(/INSERT|usuarios|a@b|hash|token|abc123/)
    expect(sqlFailureTag(new Error(`CATALOG_${'X'.repeat(80)}`)).length).toBeLessThan(60)
  })
})
