import { describe, expect, it } from 'vitest'
import { joinNames, lowestPrice, onlyLargeBarrel, visibleProducts } from './pricing'
import { products } from './products'
import type { Product } from './types'

const hidden: Product = {
  id: 'oculto',
  name: 'Oculto',
  description: 'Teste',
  prices: { 30: 100, 50: 200 },
  visible: false,
}

describe('pricing', () => {
  it('ignora produtos ocultos', () => {
    expect(visibleProducts([...products, hidden])).toHaveLength(products.length)
    expect(lowestPrice([...products, hidden], 30)).toBe(490)
  })

  it('encontra o menor preço de cada barril', () => {
    expect(lowestPrice(products, 30)).toBe(490)
    expect(lowestPrice(products, 50)).toBe(640)
  })

  it('retorna null quando nenhum produto vende o tamanho', () => {
    expect(lowestPrice([], 30)).toBeNull()
  })

  it('lista os produtos vendidos só em 50 L', () => {
    expect(onlyLargeBarrel(products).map((product) => product.name)).toEqual([
      'Brahma',
      'Kaiser',
      'Heineken',
    ])
  })

  it('junta nomes em português', () => {
    expect(joinNames(['Brahma', 'Kaiser', 'Heineken'])).toBe('Brahma, Kaiser e Heineken')
    expect(joinNames(['Brahma', 'Kaiser'])).toBe('Brahma e Kaiser')
    expect(joinNames(['Brahma'])).toBe('Brahma')
  })
})
