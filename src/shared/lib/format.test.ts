import { describe, expect, it } from 'vitest'
import { formatBRL } from './format'

const normalize = (text: string) => text.replace(/ /g, ' ')

describe('formatBRL', () => {
  it('formata com centavos por padrão', () => {
    expect(normalize(formatBRL(490))).toBe('R$ 490,00')
  })

  it('omite centavos quando pedido', () => {
    expect(normalize(formatBRL(1510, { cents: false }))).toBe('R$ 1.510')
  })
})
