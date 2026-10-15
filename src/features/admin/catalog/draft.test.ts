import { describe, expect, it } from 'vitest'
import {
  buildSaveInput,
  changedKeys,
  draftFrom,
  hasContent,
  isStandardRow,
  moveId,
  newClientId,
  newItemDraft,
  newVariantDraft,
  validate,
} from './draft'
import { createMockCatalog } from './mockData'

const fresh = () => {
  const saved = createMockCatalog()
  return { saved, draft: draftFrom(saved) }
}

/** Preenche um item novo válido (chope com uma variante de 20 L). */
function validNewItem(draft: ReturnType<typeof draftFrom>, category = 'chopes') {
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
  return item
}

describe('rascunho do catálogo', () => {
  it('começa sem alterações e sem erros; chaves estáveis e itens padrão na tabela', () => {
    const { saved, draft } = fresh()
    expect(changedKeys(saved, draft)).toEqual([])
    expect(validate(draft)).toEqual({})
    expect(draft.order.chopes).toHaveLength(8)
    expect(draft.order.cachacas).toEqual(['cachaca'])
    expect(draft.items.dronken.variants.map((v) => [v.key, v.priceText])).toEqual([
      ['30', '510,00'],
      ['50', '650,00'],
    ])
    expect(isStandardRow(draft.items.dronken)).toBe(true)
    expect(isStandardRow(draft.items.cachaca)).toBe(true)
  })

  it('detecta preço, visibilidade, posição, texto e variante nova em item persistido', () => {
    const { saved, draft } = fresh()
    draft.items.dronken.variants[0].priceText = '515,00'
    draft.items.kaiser.visible = false
    draft.order.chopes = moveId(draft.order.chopes, 'krug-bier', -1)
    draft.items.brahma.name = 'Brahma Duplo'
    draft.items['palato-beber'].variants.push(newVariantDraft())
    expect(changedKeys(saved, draft).sort()).toEqual(
      ['brahma', 'dronken', 'kaiser', 'krug-bier', 'palato-beber', 'villa-alema'].sort(),
    )
  })

  it('voltar ao valor salvo, mesmo digitado de outro jeito, não é alteração', () => {
    const { saved, draft } = fresh()
    draft.items.dronken.variants[0].priceText = '515,00'
    expect(changedKeys(saved, draft)).toEqual(['dronken'])
    draft.items.dronken.variants[0].priceText = '510,00'
    expect(changedKeys(saved, draft)).toEqual([])
  })
})

describe('produto novo e identidades temporárias', () => {
  it('nasce oculto, com clientId tmp:<UUID> estável e uma variante temporária', () => {
    const item = newItemDraft('chopes')
    expect(item.key).toMatch(/^tmp:[0-9a-f-]{36}$/)
    expect(item.id).toBeNull()
    expect(item.visible).toBe(false)
    expect(item.variants).toHaveLength(1)
    expect(item.variants[0].code).toBeNull()
    expect(item.variants[0].key).toMatch(/^tmp:/)
    expect(newClientId()).not.toBe(newClientId())
  })

  it('é contado como alteração pendente e fica no fim da categoria', () => {
    const { saved, draft } = fresh()
    const item = validNewItem(draft)
    expect(changedKeys(saved, draft)).toEqual([item.key])
    expect(draft.order.chopes.at(-1)).toBe(item.key)
    expect(isStandardRow(item)).toBe(false)
    expect(hasContent(newItemDraft('chopes'))).toBe(false)
    expect(hasContent(item)).toBe(true)
  })

  it('descartar (reconstruir do snapshot salvo) faz o cadastro sumir', () => {
    const { saved, draft } = fresh()
    const item = validNewItem(draft)
    expect(draftFrom(saved).items[item.key]).toBeUndefined()
    expect(draftFrom(saved).order.chopes).toHaveLength(8)
  })

  it('monta o pedido: persistidos com id/code, novos com clientId, na ordem do rascunho', () => {
    const { saved, draft } = fresh()
    const item = validNewItem(draft)
    draft.order.chopes = moveId(draft.order.chopes, item.key, -1)
    draft.items.dronken.variants[1].priceText = ''
    const input = buildSaveInput(saved, draft)
    expect(input.revision).toBe('1')
    const chopes = input.categories[0].items
    expect(chopes).toHaveLength(9)
    expect(chopes[7]).toMatchObject({ clientId: item.key, name: 'Lagunitas', visible: false })
    expect('id' in chopes[7]).toBe(false)
    expect(chopes[7].variants).toEqual([
      {
        clientId: item.variants[0].key,
        label: 'Barril de 20 L',
        volumeMl: 20000,
        priceCents: 42000,
      },
    ])
    expect(chopes[0]).toMatchObject({ id: 'dronken' })
    expect('clientId' in chopes[0]).toBe(false)
    expect(chopes[0].variants[1]).toMatchObject({ code: '50', priceCents: null })
    expect(input.categories[1].items[0]).toMatchObject({ id: 'cachaca' })
  })
})

describe('validação por campo', () => {
  it('exige nome, rótulo, volume inteiro positivo e preço válido nos cadastros novos', () => {
    const { draft } = fresh()
    const item = newItemDraft('chopes')
    draft.order.chopes.push(item.key)
    draft.items[item.key] = item
    const key = item.variants[0].key
    const errors = validate(draft)[item.key]
    expect(errors.name).toBe('Informe o nome.')
    expect(errors[`label:${key}`]).toBe('Informe o rótulo.')
    expect(errors[`volume:${key}`]).toBeTruthy()
    for (const bad of ['0', '0,0', '-5', 'abc', '1e3', '1,2345', '1000000000']) {
      item.variants[0].volumeText = bad
      expect(validate(draft)[item.key][`volume:${key}`], bad).toBeTruthy()
    }
    item.variants[0].volumeText = '7,5'
    expect(validate(draft)[item.key][`volume:${key}`]).toBeUndefined()
  })

  it('limites de texto e variantes', () => {
    const { draft } = fresh()
    const item = validNewItem(draft)
    expect(validate(draft)[item.key]).toBeUndefined()
    item.name = 'a'.repeat(121)
    item.description = 'd'.repeat(2001)
    item.variants = []
    const errors = validate(draft)[item.key]
    expect(errors.name).toBeTruthy()
    expect(errors.description).toBeTruthy()
    expect(errors.variants).toBe('Inclua ao menos uma variante.')
  })

  it('item visível precisa de preço; oculto pode ficar sem; cachaça exige preço sempre', () => {
    const { draft } = fresh()
    const item = validNewItem(draft)
    item.variants[0].priceText = ''
    item.visible = true
    expect(validate(draft)[item.key].row).toBeTruthy()
    item.visible = false
    expect(validate(draft)[item.key]).toBeUndefined()
    const cachaca = validNewItem(draft, 'cachacas')
    cachaca.variants[0].priceText = ''
    expect(validate(draft)[cachaca.key][`price:${cachaca.variants[0].key}`]).toBe(
      'Informe o preço.',
    )
  })

  it('várias cachaças e várias variantes no mesmo rascunho', () => {
    const { saved, draft } = fresh()
    const a = validNewItem(draft, 'cachacas')
    const b = validNewItem(draft, 'cachacas')
    b.name = 'Cachaça Ouro'
    b.variants.push({
      ...newVariantDraft(),
      label: 'Garrafa 1 L',
      volumeText: '1000',
      priceText: '89,90',
    })
    expect(validate(draft)).toEqual({})
    const input = buildSaveInput(saved, draft)
    expect(input.categories[1].items).toHaveLength(3)
    expect(input.categories[1].items[2].variants).toHaveLength(2)
    expect(changedKeys(saved, draft).sort()).toEqual([a.key, b.key].sort())
  })
})

describe('moveId', () => {
  it('respeita as bordas', () => {
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
  })
})
