import { describe, expect, it, vi } from 'vitest'
import { buildSaveInput, type Draft, draftFrom, newItemDraft, newVariantDraft } from './draft'
import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { createHttpGateway } from './httpGateway'
import { createMockGateway } from './mockGateway'
import { limitViolation, performSave, recoverUncertain, SAVE_LIMITS } from './saveFlow'
import type { AdminCatalog, CategoryId, SaveInput } from './types'

/**
 * Contrato do PUT /api/admin/catalog/v2 da F3A.2 (server/catalog-expansion/validation.ts,
 * `validateExpanded`), reproduzido aqui chave a chave: o servidor usa `exact(...)` em cada nível e
 * recusa com 400 qualquer chave a mais ou a menos. Revisão independente: omitir `name` na
 * categoria recusava TODO salvamento.
 */
const keys = (value: object) => Object.keys(value).sort()
const CLIENT_REF = /^tmp:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function assertBackendBody(body: SaveInput, snapshot: AdminCatalog) {
  expect(keys(body)).toEqual(['categories', 'revision'])
  expect(body.revision).toBe(snapshot.revision)
  expect(body.categories).toHaveLength(snapshot.categories.length)
  body.categories.forEach((category, index) => {
    expect(keys(category)).toEqual(['id', 'items', 'name']) // exact(category, [id, name, items])
    expect(category.id).toBe(snapshot.categories[index].id)
    expect(category.name).toBe(snapshot.categories[index].name) // o do GET, sem edição
    for (const item of category.items) {
      const fresh = 'clientId' in item
      expect(keys(item)).toEqual(
        [fresh ? 'clientId' : 'id', 'name', 'description', 'visible', 'variants'].sort(),
      )
      if (fresh) expect((item as { clientId: string }).clientId).toMatch(CLIENT_REF)
      for (const variant of item.variants) {
        const isNew = 'clientId' in variant
        expect(keys(variant)).toEqual(
          [isNew ? 'clientId' : 'code', 'label', 'volumeMl', 'priceCents'].sort(),
        )
        if (isNew) expect((variant as { clientId: string }).clientId).toMatch(CLIENT_REF)
        expect(Number.isInteger(variant.priceCents ?? 1)).toBe(true)
        expect(variant.volumeMl === null || Number.isInteger(variant.volumeMl)).toBe(true)
      }
    }
  })
}

const setup = async () => {
  const saved = await createMockGateway(undefined, 0).load()
  return { saved, draft: draftFrom(saved) }
}

function addItem(draft: Draft, category: CategoryId, name: string, volume: string) {
  const item = newItemDraft(category)
  item.name = name
  item.variants[0] = {
    ...item.variants[0],
    label: 'Barril',
    volumeText: volume,
    priceText: '10,00',
  }
  draft.order[category].push(item.key)
  draft.items[item.key] = item
  return item
}

describe('contrato do corpo do PUT com o backend real', () => {
  it('sem alterações: corpo exato, com name de cada categoria vindo do snapshot', async () => {
    const { saved, draft } = await setup()
    const body = buildSaveInput(saved, draft)
    assertBackendBody(body, saved)
    expect(body.categories.map((c) => [c.id, c.name])).toEqual([
      ['chopes', 'Chopes'],
      ['cachacas', 'Cachaças'],
    ])
  })

  it('criando chope e cachaça (com variante extra) e editando existente: mesmas chaves exatas', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'Lagunitas', '20')
    const cachaca = addItem(draft, 'cachacas', 'Cachaça Ouro', '750')
    cachaca.variants.push({
      ...newVariantDraft(),
      label: 'Meia',
      volumeText: '350',
      priceText: '5,00',
    })
    draft.items.dronken.variants[0].priceText = '999,00'
    assertBackendBody(buildSaveInput(saved, draft), saved)
  })

  it('o JSON enviado pelo httpGateway é exatamente o SaveInput, com If-Match entre aspas', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'Lagunitas', '20')
    const input = buildSaveInput(saved, draft)
    const fetcher = vi.fn(async () => new Response('{}', { status: 400 }))
    await createHttpGateway({ fetch: fetcher })
      .save(input)
      .catch(() => undefined)
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual(input)
    assertBackendBody(JSON.parse(init.body as string), saved)
    expect(init.headers).toMatchObject({ 'If-Match': JSON.stringify(saved.revision) })
  })

  it('o mock recusa categoria com nome diferente do cadastrado (como o servidor real)', async () => {
    const gateway = createMockGateway(undefined, 0)
    const saved = await gateway.load()
    const input = buildSaveInput(saved, draftFrom(saved))
    input.categories[0].name = 'Outro nome'
    await expect(gateway.save(input)).rejects.toMatchObject({ code: 'rejected' })
  })
})

describe('limites do PUT conferidos antes de enviar', () => {
  const sent = () => {
    const calls: SaveInput[] = []
    const inner = createMockGateway(undefined, 0)
    const gateway: AdminCatalogGateway = {
      load: (signal) => inner.load(signal),
      save: (input) => {
        calls.push(input)
        return inner.save(input)
      },
    }
    return { gateway, calls }
  }

  it('9 variantes num produto: bloqueia, sem chamar o servidor, rascunho intacto', async () => {
    const { saved, draft } = await setup()
    const item = addItem(draft, 'chopes', 'Muitas', '5')
    while (item.variants.length < 9)
      item.variants.push({
        ...newVariantDraft(),
        label: `V${item.variants.length}`,
        volumeText: '5',
        priceText: '1,00',
      })
    const { gateway, calls } = sent()
    const outcome = await performSave(gateway, saved, draft)
    expect(outcome).toEqual({
      kind: 'limit',
      message: 'Cada produto aceita no máximo 8 variantes.',
    })
    expect(calls).toHaveLength(0)
    expect(item.variants).toHaveLength(9)
  })

  it('exatamente 8 variantes por produto passa', async () => {
    const { saved, draft } = await setup()
    const item = addItem(draft, 'chopes', 'Oito', '5')
    while (item.variants.length < 8)
      item.variants.push({
        ...newVariantDraft(),
        label: `V${item.variants.length}`,
        volumeText: '5',
        priceText: '1,00',
      })
    expect(limitViolation(buildSaveInput(saved, draft))).toBeNull()
  })

  it('129 produtos: bloqueia; 128 passa', async () => {
    const { saved, draft } = await setup()
    let total = 9 // 8 chopes + 1 cachaça do mock
    while (total < SAVE_LIMITS.items) {
      addItem(draft, 'chopes', `P${total}`, '5')
      total++
    }
    expect(limitViolation(buildSaveInput(saved, draft))).toBeNull()
    addItem(draft, 'chopes', 'P129', '5')
    expect(limitViolation(buildSaveInput(saved, draft))).toBe(
      'O catálogo aceita no máximo 128 produtos.',
    )
  })

  it('513 variantes no total: bloqueia mesmo com ≤ 8 por produto e ≤ 128 produtos', async () => {
    const { saved, draft } = await setup()
    // 9 itens do mock têm 17 variantes (8×2 + 1). Cria 62 itens de 8 variantes: 17 + 496 = 513.
    for (let n = 0; n < 62; n++) {
      const item = addItem(draft, 'chopes', `G${n}`, '5')
      while (item.variants.length < 8)
        item.variants.push({
          ...newVariantDraft(),
          label: `V${item.variants.length}`,
          volumeText: '5',
          priceText: '1,00',
        })
    }
    expect(limitViolation(buildSaveInput(saved, draft))).toBe(
      'O catálogo aceita no máximo 512 variantes no total.',
    )
  })

  it('128 KiB: no teto passa, um byte a mais bloqueia', async () => {
    const { saved, draft } = await setup()
    const base = buildSaveInput(saved, draft)
    const size = (input: SaveInput) => new TextEncoder().encode(JSON.stringify(input)).length
    const pad = (n: number) => {
      const input = structuredClone(base)
      input.categories[0].items[0].description = 'a'.repeat(n)
      return input
    }
    const room = SAVE_LIMITS.bytes - size(pad(0))
    expect(size(pad(room))).toBe(SAVE_LIMITS.bytes)
    expect(limitViolation(pad(room))).toBeNull()
    expect(limitViolation(pad(room + 1))).toMatch(/128 KiB/)
  })

  it('conta bytes UTF-8, não caracteres', async () => {
    const { saved, draft } = await setup()
    const input = buildSaveInput(saved, draft)
    input.categories[0].items[0].description = 'é'.repeat(SAVE_LIMITS.bytes / 2)
    expect(limitViolation(input)).toMatch(/128 KiB/)
  })
})

describe('403 (origem/CSRF) x 400 (validação) x 503 (resultado incerto)', () => {
  const via = (status: number) =>
    createHttpGateway({ fetch: async () => new Response('{}', { status }) })

  it('403 vira forbidden e performSave devolve forbidden (não rejected, não incerto)', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'X', '5')
    expect((await performSave(via(403), saved, draft)).kind).toBe('forbidden')
  })

  it('400 / 428 / 410 continuam rejected', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'X', '5')
    for (const status of [400, 428, 410])
      expect((await performSave(via(status), saved, draft)).kind).toBe('rejected')
  })

  it('401 e 409 continuam unauthenticated / conflict', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'X', '5')
    expect((await performSave(via(401), saved, draft)).kind).toBe('unauthenticated')
    expect((await performSave(via(409), saved, draft)).kind).toBe('conflict')
  })

  it('503 (e demais 5xx) no PUT é resultado INCERTO: pode ter sido gravado antes do erro', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'X', '5')
    for (const status of [500, 502, 503, 504]) {
      const outcome = await performSave(via(status), saved, draft)
      expect(outcome.kind).toBe('uncertain')
      if (outcome.kind === 'uncertain') expect(outcome.input).toEqual(buildSaveInput(saved, draft))
    }
  })

  it('503 depois do commit: recuperação por GET confirma, com UM único PUT e sem reenvio', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'Lagunitas', '20')
    const inner = createMockGateway('lost-response', 0)
    const base = await inner.load()
    let puts = 0
    const gateway: AdminCatalogGateway = {
      load: (signal) => inner.load(signal),
      save: async (input) => {
        puts++
        try {
          return await inner.save(input) // grava…
        } catch {
          throw new AdminApiError('unavailable') // …e o cliente vê 503
        }
      },
    }
    const outcome = await performSave(gateway, base, draft)
    expect(outcome.kind).toBe('uncertain')
    if (outcome.kind !== 'uncertain') return
    const recovery = await recoverUncertain(gateway, outcome.input)
    expect(recovery.kind).toBe('applied')
    expect(puts).toBe(1) // a recuperação só lê
    expect(saved.revision).toBe(base.revision)
  })

  it('503 sem gravar: not-applied, e ainda assim nenhum reenvio automático', async () => {
    const { saved, draft } = await setup()
    addItem(draft, 'chopes', 'X', '5')
    let puts = 0
    let loads = 0
    const inner = createMockGateway(undefined, 0)
    const gateway: AdminCatalogGateway = {
      load: (signal) => {
        loads++
        return inner.load(signal)
      },
      save: async () => {
        puts++
        throw new AdminApiError('unavailable')
      },
    }
    const outcome = await performSave(gateway, saved, draft)
    if (outcome.kind !== 'uncertain') throw new Error(outcome.kind)
    expect((await recoverUncertain(gateway, outcome.input)).kind).toBe('not-applied')
    expect([puts, loads]).toEqual([1, 1])
  })
})
