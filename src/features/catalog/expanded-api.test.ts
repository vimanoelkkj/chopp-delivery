import { describe, expect, it } from 'vitest'
import type { PublicCatalog } from '../../../shared/catalog'
import { parseExpandedCatalog } from './expanded-api'

const payload = (): PublicCatalog => ({
  revision: 'opaque-token',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: [
        {
          id: 'old-id',
          name: 'Chope',
          description: '',
          visible: true,
          variants: [
            { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 51029 },
            { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: null },
          ],
        },
      ],
    },
    {
      id: 'cachacas',
      name: 'Cachaças',
      items: [
        {
          id: 'a',
          name: 'A',
          description: '',
          visible: true,
          variants: [{ code: 'bottle', label: 'Garrafa', volumeMl: 700, priceCents: 3001 }],
        },
        {
          id: 'b',
          name: 'B',
          description: '',
          visible: true,
          variants: [{ code: 'other', label: 'Garrafa especial', volumeMl: 750, priceCents: 3101 }],
        },
      ],
    },
    {
      id: 'future',
      name: 'Outra categoria',
      items: [
        {
          id: 'c',
          name: 'C',
          description: '',
          visible: true,
          variants: [{ code: 'single', label: 'Unidade', volumeMl: null, priceCents: 123 }],
        },
      ],
    },
  ],
})
describe('parser expansível público', () => {
  it('preserva todos os dados e revisão opaca; centavos não perdem precisão', () => {
    const input = payload(),
      parsed = parseExpandedCatalog(input)
    expect(parsed.expanded).toEqual(input)
    expect(parsed.products[0].prices).toEqual({ 30: 510.29, 50: null })
    expect(parsed.expanded.categories[1].items).toHaveLength(2)
  })
  it.each([
    'hidden',
    'duplicate',
    'fraction',
    'nan',
    'infinity',
    'negative',
    'no-variants',
    'no-price',
    'missing-category',
  ])('falha inteiro por %s', (mode) => {
    const input = payload(),
      item = input.categories[0].items[0]
    if (mode === 'hidden') item.visible = false
    if (mode === 'duplicate') item.variants.push({ ...item.variants[0] })
    if (mode === 'fraction') item.variants[0].priceCents = 1.1
    if (mode === 'nan') item.variants[0].priceCents = NaN
    if (mode === 'infinity') item.variants[0].priceCents = Infinity
    if (mode === 'negative') item.variants[0].volumeMl = -1
    if (mode === 'no-variants') item.variants = []
    if (mode === 'no-price') for (const v of item.variants) v.priceCents = null
    if (mode === 'missing-category') (input as unknown as { categories: unknown }).categories = null
    expect(() => parseExpandedCatalog(input)).toThrow()
  })
})
