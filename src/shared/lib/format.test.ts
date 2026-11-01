import { describe, expect, it } from 'vitest'
import { formatBRL, formatCatalogVolume } from './format'

const normalize = (text: string) => text.replace(/ /g, ' ')

describe('formatBRL', () => {
  it('formata com centavos por padrão', () => {
    expect(normalize(formatBRL(490))).toBe('R$ 490,00')
  })

  it('omite centavos quando pedido', () => {
    expect(normalize(formatBRL(1510, { cents: false }))).toBe('R$ 1.510')
  })
})

describe('formatCatalogVolume', () => {
  it('formata volumes obrigatórios sem arredondamento comercial', () => {
    expect(formatCatalogVolume(750)).toBe('750 ml')
    expect(formatCatalogVolume(1500)).toBe('1,5L')
    expect(formatCatalogVolume(1500, { compact: false })).toBe('1,5 L')
    expect(formatCatalogVolume(20000)).toBe('20L')
    expect(formatCatalogVolume(30000)).toBe('30L')
    expect(formatCatalogVolume(50000)).toBe('50L')
  })

  it('retorna string vazia para valores nulos ou inválidos', () => {
    expect(formatCatalogVolume(null)).toBe('')
    expect(formatCatalogVolume(undefined)).toBe('')
    expect(formatCatalogVolume(0)).toBe('')
  })
})
