import { describe, expect, it } from 'vitest'
import { newItemDraft } from './draft'
import { createMockCatalog } from './mockData'
import { type EditorAction, type EditorState, initial, reducer } from './useCatalogEditor'

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(reducer, state)
const loaded = () => run(initial, { type: 'loaded', catalog: createMockCatalog() })

describe('reducer do editor: cadastro no rascunho', () => {
  it('add-item acrescenta ao fim da categoria com a mesma chave (clientId) em ordem e mapa', () => {
    const item = newItemDraft('cachacas')
    const state = run(loaded(), { type: 'add-item', item })
    expect(state.draft?.order.cachacas).toEqual(['cachaca', item.key])
    expect(state.draft?.items[item.key]).toBe(item)
  })

  it('cancel-item remove só linhas temporárias; persistidas continuam', () => {
    const item = newItemDraft('chopes')
    const added = run(loaded(), { type: 'add-item', item })
    const cancelled = run(added, { type: 'cancel-item', key: item.key })
    expect(cancelled.draft?.order.chopes).toHaveLength(8)
    expect(cancelled.draft?.items[item.key]).toBeUndefined()
    const untouched = run(cancelled, { type: 'cancel-item', key: 'dronken' })
    expect(untouched.draft?.items.dronken).toBeDefined()
    expect(untouched.draft?.order.chopes).toHaveLength(8)
  })

  it('discard faz os cadastros não persistidos desaparecerem e limpa as marcações', () => {
    const item = newItemDraft('chopes')
    const state = run(
      loaded(),
      { type: 'add-item', item },
      { type: 'item-field', key: item.key, field: 'name', text: 'Novo' },
      { type: 'touch', path: `${item.key}:name` },
      { type: 'attempt' },
      { type: 'discard' },
    )
    expect(state.draft?.items[item.key]).toBeUndefined()
    expect(state.touched).toEqual({})
    expect(state.attempted).toBe(false)
  })

  it('edita campos, variantes e remove só variante temporária', () => {
    const item = newItemDraft('chopes')
    const variant = item.variants[0].key
    const state = run(
      loaded(),
      { type: 'add-item', item },
      { type: 'variant-field', key: item.key, variant, field: 'label', text: 'Barril 20 L' },
      { type: 'variant-field', key: item.key, variant, field: 'priceText', text: '4,20' },
      { type: 'blur-price', key: item.key, variant },
    )
    expect(state.draft?.items[item.key].variants[0]).toMatchObject({
      label: 'Barril 20 L',
      priceText: '4,20',
    })
    expect(state.touched[`${item.key}:price:${variant}`]).toBe(true)
    const kept = run(state, { type: 'remove-variant', key: 'dronken', variant: '30' })
    expect(kept.draft?.items.dronken.variants).toHaveLength(2) // persistida não sai por omissão
    const gone = run(state, { type: 'remove-variant', key: item.key, variant })
    expect(gone.draft?.items[item.key].variants).toHaveLength(0)
  })

  it('saved reconstrói o rascunho do snapshot salvo e zera conflito/marcações', () => {
    const catalog = createMockCatalog()
    const state = run(loaded(), { type: 'conflict' }, { type: 'saved', catalog })
    expect(state.conflict).toBe(false)
    expect(state.saving).toBe(false)
    expect(state.draft?.order.chopes).toHaveLength(8)
  })

  it('move reordena itens novos e existentes na mesma lista', () => {
    const item = newItemDraft('chopes')
    const state = run(
      loaded(),
      { type: 'add-item', item },
      { type: 'move', category: 'chopes', key: item.key, direction: -1 },
    )
    expect(state.draft?.order.chopes.slice(-2)).toEqual([item.key, 'chopp-de-vinho'])
  })
})
