import { describe, expect, it } from 'vitest'
import { buildSaveInput, draftFrom, newItemDraft, newVariantDraft } from './draft'
import { AdminApiError } from './gateway'
import { createMockGateway, readMockMode } from './mockGateway'
import type { AdminCatalog } from './types'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error) => (error instanceof AdminApiError ? error.code : 'other'),
  )

const chopes = (catalog: AdminCatalog) => catalog.categories[0].items
const price = (catalog: AdminCatalog, id: string, variant: number) =>
  chopes(catalog).find((item) => item.id === id)?.variants[variant].priceCents

/** Rascunho com um chope novo válido, pronto para salvar. */
function withNewItem(loaded: AdminCatalog, category = 'chopes') {
  const draft = draftFrom(loaded)
  const item = newItemDraft(category)
  item.name = 'Lagunitas'
  item.description = 'IPA'
  item.variants[0] = {
    ...item.variants[0],
    label: 'Barril de 20 L',
    volumeText: '20',
    priceText: '420,00',
  }
  draft.order[category].push(item.key)
  draft.items[item.key] = item
  return { draft, item }
}

describe('mock gateway: mesmo contrato que a F3A.2 precisa cumprir', () => {
  it('load devolve cópia: editar o resultado não altera o armazenado', async () => {
    const gateway = createMockGateway(undefined, 0)
    const first = await gateway.load()
    chopes(first)[0].variants[0].priceCents = 1
    expect(price(await gateway.load(), 'dronken', 0)).toBe(51000)
  })

  it('save avança a revisão e a nova base é aceita; no-op preserva a revisão', async () => {
    const gateway = createMockGateway(undefined, 0)
    const loaded = await gateway.load()
    const noop = await gateway.save(buildSaveInput(loaded, draftFrom(loaded)))
    expect(noop.catalog.revision).toBe(loaded.revision)
    const draft = draftFrom(loaded)
    draft.items.dronken.variants[0].priceText = '515,00'
    const saved = await gateway.save(buildSaveInput(loaded, draft))
    expect(saved.catalog.revision).not.toBe(loaded.revision)
    expect(price(saved.catalog, 'dronken', 0)).toBe(51500)
    draft.items.dronken.variants[0].priceText = '520,00'
    const again = await gateway.save(buildSaveInput(saved.catalog, draft))
    expect(price(again.catalog, 'dronken', 0)).toBe(52000)
  })

  it('save com base desatualizada falha com conflict e não grava nada', async () => {
    const gateway = createMockGateway(undefined, 0)
    const stale = await gateway.load()
    const draft = draftFrom(stale)
    draft.items.dronken.variants[0].priceText = '515,00'
    await gateway.save(buildSaveInput(stale, draft)) // outra sessão salva primeiro
    const { draft: second } = withNewItem(stale)
    second.items.kaiser.variants[1].priceText = '1,00'
    expect(await code(gateway.save(buildSaveInput(stale, second)))).toBe('conflict')
    const current = await gateway.load()
    expect(price(current, 'dronken', 0)).toBe(51500)
    expect(price(current, 'kaiser', 1)).toBe(89000)
    expect(chopes(current)).toHaveLength(8)
  })

  it('cadastro: IDs definitivos item_<UUID>/v_<UUID>, creationRef e mapas clientId → id', async () => {
    const gateway = createMockGateway(undefined, 0)
    const loaded = await gateway.load()
    const { draft, item } = withNewItem(loaded)
    const result = await gateway.save(buildSaveInput(loaded, draft))
    expect(result.created.items).toEqual([
      { clientId: item.key, id: expect.stringMatching(/^item_[0-9a-f-]{36}$/) },
    ])
    const [{ id }] = result.created.items
    expect(result.created.variants).toEqual([
      {
        itemId: id,
        clientId: item.variants[0].key,
        code: expect.stringMatching(/^v_[0-9a-f-]{36}$/),
      },
    ])
    const saved = chopes(result.catalog).at(-1)
    expect(saved).toMatchObject({ id, creationRef: item.key, name: 'Lagunitas', visible: false })
    expect(saved?.variants[0]).toMatchObject({
      creationRef: item.variants[0].key,
      volumeMl: 20000,
      priceCents: 42000,
    })
    // Reconciliação: reconstruir o rascunho do snapshot mantém a chave (clientId) e traz o id novo.
    const next = draftFrom(result.catalog)
    expect(next.items[item.key]).toMatchObject({ id, key: item.key })
    expect(next.order.chopes.at(-1)).toBe(item.key)
  })

  it('várias cachaças e variantes extras em itens persistidos', async () => {
    const gateway = createMockGateway(undefined, 0)
    const loaded = await gateway.load()
    const { draft } = withNewItem(loaded, 'cachacas')
    const extra = newVariantDraft()
    Object.assign(extra, { label: 'Meio barril', volumeText: '25', priceText: '300,00' })
    draft.items.dronken.variants.push(extra)
    const result = await gateway.save(buildSaveInput(loaded, draft))
    expect(result.catalog.categories[1].items).toHaveLength(2)
    expect(chopes(result.catalog)[0].variants).toHaveLength(3)
    expect(result.created.variants).toHaveLength(2)
  })

  it('clientId já persistido reaparecendo como novo é recusado, sem duplicar', async () => {
    const gateway = createMockGateway(undefined, 0)
    const loaded = await gateway.load()
    const { draft } = withNewItem(loaded)
    const input = buildSaveInput(loaded, draft)
    const first = await gateway.save(input)
    const replay = buildSaveInput(first.catalog, draftFrom(first.catalog))
    // Retry cego do mesmo pedido: base antiga ⇒ conflito (nunca cria de novo).
    expect(await code(gateway.save(input))).toBe('conflict')
    // Mesmo clientId como "novo" sobre a base atual ⇒ recusado.
    replay.categories[0].items.push({
      ...(input.categories[0].items.at(-1) as (typeof input.categories)[0]['items'][0]),
    })
    expect(await code(gateway.save(replay))).toBe('rejected')
    expect(chopes(await gateway.load())).toHaveLength(9)
  })

  it('omitir itens ou variantes persistidos, ou item novo sem variantes, é recusado', async () => {
    const gateway = createMockGateway(undefined, 0)
    const loaded = await gateway.load()
    const omitItem = buildSaveInput(loaded, draftFrom(loaded))
    omitItem.categories[0].items.pop()
    expect(await code(gateway.save(omitItem))).toBe('rejected')
    const omitVariant = buildSaveInput(loaded, draftFrom(loaded))
    omitVariant.categories[0].items[0].variants.pop()
    expect(await code(gateway.save(omitVariant))).toBe('rejected')
    const { draft, item } = withNewItem(loaded)
    draft.items[item.key].variants = []
    expect(await code(gateway.save(buildSaveInput(loaded, draft)))).toBe('rejected')
    expect(chopes(await gateway.load())).toHaveLength(8)
  })

  it('modo conflict simula outra sessão uma única vez; recarregar resolve', async () => {
    const gateway = createMockGateway('conflict', 0)
    const loaded = await gateway.load()
    const { draft } = withNewItem(loaded)
    expect(await code(gateway.save(buildSaveInput(loaded, draft)))).toBe('conflict')
    const reloaded = await gateway.load()
    expect(price(reloaded, 'dronken', 0)).toBe(53000)
    expect(chopes(reloaded)).toHaveLength(8)
    const next = withNewItem(reloaded)
    expect(chopes((await gateway.save(buildSaveInput(reloaded, next.draft))).catalog)).toHaveLength(
      9,
    )
  })

  it('outros modos: erro, sessão expirada e vazio', async () => {
    const base = await createMockGateway(undefined, 0).load()
    const input = buildSaveInput(base, draftFrom(base))
    expect(await code(createMockGateway('save-error', 0).save(input))).toBe('unavailable')
    expect(await code(createMockGateway('expired', 0).save(input))).toBe('unauthenticated')
    const gateway = createMockGateway('error', 0)
    expect(await code(gateway.load())).toBe('unavailable')
    expect(await code(gateway.load())).toBe('ok')
    const empty = await createMockGateway('empty', 0).load()
    expect(empty.categories.map((c) => [c.id, c.items.length])).toEqual([
      ['chopes', 0],
      ['cachacas', 0],
    ])
  })

  it('readMockMode só aceita cenários conhecidos', () => {
    expect(readMockMode('?mock=conflict')).toBe('conflict')
    expect(readMockMode('?mock=nada')).toBeUndefined()
    expect(readMockMode('')).toBeUndefined()
  })
})
