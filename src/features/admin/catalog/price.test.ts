import { describe, expect, it } from 'vitest'
import { formatPriceText, parsePriceText } from './price'

const cents = (text: string) => {
  const result = parsePriceText(text)
  return result.ok ? result.cents : result.message
}

describe('parsePriceText', () => {
  it.each([
    ['510,00', 51000],
    ['510', 51000],
    ['510,5', 51050],
    ['510.5', 51050],
    ['1.020,00', 102000],
    ['1.020', 102000],
    ['R$ 99.999,99', 9999999],
    ['  490,00 ', 49000],
    ['', null],
    ['   ', null],
  ])('aceita %j', (text, expected) => expect(cents(text)).toBe(expected))

  it.each(['abc', '5,123', '5,,0', '-10', '1e3', '0,00', '0', '100.000,00', '1.02.0,00'])(
    'recusa %j',
    (text) => expect(typeof cents(text)).toBe('string'),
  )
})

describe('formatPriceText', () => {
  it('formata centavos em pt-BR e deixa vazio quando não vende', () => {
    expect(formatPriceText(51000)).toBe('510,00')
    expect(formatPriceText(102050)).toBe('1.020,50')
    expect(formatPriceText(null)).toBe('')
    expect(formatPriceText(undefined)).toBe('')
  })

  it('é inverso de parsePriceText', () => {
    for (const value of [1, 99, 3000, 51000, 9999999])
      expect(cents(formatPriceText(value))).toBe(value)
  })
})
