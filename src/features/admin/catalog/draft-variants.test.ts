import { describe, expect, it } from 'vitest'
import {
  buildSaveInput,
  changedKeys,
  draftFrom,
  isStandardRow,
  newVariantDraft,
  validate,
} from './draft'
import { createMockCatalog } from './mockData'

// F4A.5.3: variante nova em produto padrão (30/50 L) já persistido.
const setup = () => {
  const saved = createMockCatalog()
  const draft = draftFrom(saved)
  const key = draft.order.chopes[0]
  return { saved, draft, key }
}
const withNew = (label: string, volumeText: string, priceText = '300,00') => {
  const { saved, draft, key } = setup()
  const variant = { ...newVariantDraft(), label, volumeText, priceText }
  draft.items[key].variants.push(variant)
  return { saved, draft, key, variant }
}

describe('variante nova em produto padrão', () => {
  it('o produto deixa de ser linha da tabela, conta como alterado e os padrões seguem intactos', () => {
    const { saved, draft, key } = withNew('Barril de 20 L', '20')
    expect(isStandardRow(draft.items[key])).toBe(false)
    expect(changedKeys(saved, draft)).toEqual([key])
    expect(validate(draft)).toEqual({})
    const input = buildSaveInput(saved, draft).categories[0].items[0]
    expect(input).toMatchObject({ id: draft.items[key].id })
    expect(input.variants.map((v) => ('code' in v ? v.code : 'novo'))).toEqual(['30', '50', 'novo'])
    expect(input.variants[2]).toMatchObject({
      label: 'Barril de 20 L',
      volumeMl: 20000,
      priceCents: 30000,
    })
    // As persistidas seguem com o mesmo volume em ml e sem clientId.
    expect(input.variants[0]).toMatchObject({ code: '30', volumeMl: 30000 })
    expect('clientId' in input.variants[0]).toBe(false)
  })

  it('remover a variante ainda não salva devolve o produto à tabela, sem alterações', () => {
    const { saved, draft, key, variant } = withNew('Barril de 20 L', '20')
    draft.items[key].variants = draft.items[key].variants.filter((v) => v.key !== variant.key)
    expect(isStandardRow(draft.items[key])).toBe(true)
    expect(changedKeys(saved, draft)).toEqual([])
  })

  it('duplicata exata de uma variante persistida é recusada na variante nova', () => {
    for (const label of ['Barril de 30 L', '  barril  DE 30 l ']) {
      const { draft, key, variant } = withNew(label, '30')
      expect(validate(draft)[key][`label:${variant.key}`]).toBe(
        'Já existe uma variante com este rótulo e volume neste produto.',
      )
    }
  })

  it('duas variantes novas iguais entre si: erro na segunda', () => {
    const { draft, key, variant } = withNew('Promo', '20')
    const second = { ...newVariantDraft(), label: ' promo ', volumeText: '20', priceText: '10,00' }
    draft.items[key].variants.push(second)
    const errors = validate(draft)[key]
    expect(errors[`label:${variant.key}`]).toBeUndefined()
    expect(errors[`label:${second.key}`]).toContain('rótulo e volume')
  })

  it('mesmo volume com rótulos diferentes é válido', () => {
    const { draft } = withNew('Barril promocional 30 L', '30')
    expect(validate(draft)).toEqual({})
  })

  it('volume diferente com o mesmo rótulo é válido', () => {
    const { draft } = withNew('Barril de 30 L', '35')
    expect(validate(draft)).toEqual({})
  })

  it('catálogo original sem edições: nenhuma alteração e nenhum erro', () => {
    const { saved, draft } = setup()
    expect(changedKeys(saved, draft)).toEqual([])
    expect(validate(draft)).toEqual({})
  })
})
