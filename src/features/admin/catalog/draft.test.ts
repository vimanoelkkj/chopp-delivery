import { describe, expect, it } from 'vitest'
import { buildCatalog, changedIds, draftFrom, moveId, validate } from './draft'
import { createMockCatalog } from './mockData'

describe('rascunho do catálogo', () => {
  it('começa sem alterações e sem erros', () => {
    const saved = createMockCatalog()
    const draft = draftFrom(saved)
    expect(changedIds(saved, draft)).toEqual([])
    expect(validate(draft)).toEqual({})
    expect(buildCatalog(saved, draft)).toEqual(saved)
  })

  it('detecta preço, visibilidade e posição', () => {
    const saved = createMockCatalog()
    const draft = draftFrom(saved)
    draft.text.dronken['30'] = '515,00'
    draft.visible.kaiser = false
    draft.order.chopes = moveId(draft.order.chopes, 'krug-bier', -1)
    expect(changedIds(saved, draft).sort()).toEqual([
      'dronken',
      'kaiser',
      'krug-bier',
      'villa-alema',
    ])
  })

  it('voltar ao valor salvo, mesmo digitado de outro jeito, não é alteração', () => {
    const saved = createMockCatalog()
    const draft = draftFrom(saved)
    draft.text.dronken['30'] = '515'
    expect(changedIds(saved, draft)).toEqual(['dronken'])
    draft.text.dronken['30'] = '510,00'
    expect(changedIds(saved, draft)).toEqual([])
  })

  it('valida formato, zero e ausência total de preço em produto visível', () => {
    const draft = draftFrom(createMockCatalog())
    draft.text.dronken['30'] = 'abc'
    draft.text.brahma['50'] = ''
    draft.text.kaiser['50'] = '0,00'
    const errors = validate(draft)
    expect(errors.dronken?.['30']).toBeTruthy()
    expect(errors.brahma?.row).toBeTruthy()
    expect(errors.kaiser?.['50']).toBeTruthy()
    draft.visible.brahma = false
    expect(validate(draft).brahma).toBeUndefined()
  })

  it('exige preço da garrafa de cachaça', () => {
    const draft = draftFrom(createMockCatalog())
    draft.text.cachaca.bottle = ''
    expect(validate(draft).cachaca?.bottle).toBe('Informe o preço.')
  })

  it('monta o catálogo com centavos, null e a nova ordem', () => {
    const saved = createMockCatalog()
    const draft = draftFrom(saved)
    draft.text.dronken['30'] = '1.020,50'
    draft.text.dronken['50'] = ''
    draft.order.chopes = moveId(draft.order.chopes, 'dronken', 1)
    const next = buildCatalog(saved, draft)
    expect(next.chopes[1].id).toBe('dronken')
    expect(next.chopes[1].prices).toEqual({ '30': 102050, '50': null })
  })

  it('moveId respeita as bordas', () => {
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
  })
})
