import { describe, expect, it } from 'vitest'
import {
  type CatalogSnapshot,
  parseIfMatch,
  validateCatalog,
} from '../../server/admin-catalog/catalog-contract'

const valid = () => ({
  revision: 'r0',
  chopes: [
    { id: 'one', name: 'Produto', description: '', visible: true, prices: { 30: 1, 50: null } },
  ],
  cachacas: [
    { id: 'bottle', name: 'Garrafa', description: '', visible: true, prices: { bottle: 9999999 } },
  ],
})

describe('contrato do gateway de catálogo e precondição HTTP', () => {
  it.each(['"r0"', '"r1"', '"r9007199254740991"'])('aceita ETag forte canônica %s', (tag) =>
    expect(parseIfMatch(tag)).not.toBeNull(),
  )
  it.each([
    '',
    '"r-1"',
    '"r+1"',
    '"r1.0"',
    '"r01"',
    '"r1", "r2"',
    '"r1", "r1"',
    '*',
    'W/"r1"',
    'r1',
    '"r9007199254740992"',
  ])('rejeita ETag ambígua ou malformada %s', (tag) => expect(parseIfMatch(tag)).toBeNull())
  it.each([
    null,
    [],
    {},
    { ...valid(), extra: true },
    { ...valid(), chopes: 'invalid' },
    { ...valid(), chopes: [{ ...valid().chopes[0], prices: { bottle: 1 } }] },
    { ...valid(), chopes: [{ ...valid().chopes[0], prices: { 30: 0, 50: null } }] },
    { ...valid(), chopes: [{ ...valid().chopes[0], prices: { 30: Number.NaN, 50: null } }] },
    {
      ...valid(),
      chopes: [{ ...valid().chopes[0], prices: { 30: Number.POSITIVE_INFINITY, 50: null } }],
    },
    { ...valid(), chopes: [{ ...valid().chopes[0], prices: { 30: 10000000, 50: null } }] },
    { ...valid(), chopes: [{ ...valid().chopes[0], prices: { 30: null, 50: null } }] },
    { ...valid(), cachacas: [{ ...valid().cachacas[0], prices: { bottle: null } }] },
    { ...valid(), cachacas: [{ ...valid().cachacas[0], bottleMl: 1000 }] },
    { ...valid(), chopes: [{ ...valid().chopes[0], name: '\udfff' }] },
    { ...valid(), chopes: [{ ...valid().chopes[0], name: '\u200b' }] },
    { ...valid(), chopes: [{ ...valid().chopes[0], name: 'Produto\u202e' }] },
  ])('rejeita payload inválido com campos identificáveis: %j', (input) =>
    expect(validateCatalog(input, 'r0').fields).toBeDefined(),
  )
  it('valida snapshot completo e preserva null em produto oculto', () => {
    expect(validateCatalog(valid(), 'r0')).toEqual({ value: valid() })
    const hidden: CatalogSnapshot = valid()
    hidden.chopes[0].visible = false
    hidden.chopes[0].prices = { 30: null, 50: null }
    expect(validateCatalog(hidden, 'r0').fields).toBeUndefined()
  })
})
