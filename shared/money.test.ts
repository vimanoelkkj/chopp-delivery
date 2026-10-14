import { describe, expect, it } from 'vitest'
import { centsToReais, reaisToCents } from './money'

describe('conversão monetária sem arredondamento', () => {
  it.each([
    [0, 0],
    [510, 51000],
    [0.29, 29],
    [1.01, 101],
    [490.99, 49099],
  ])('converte %s reais para %s centavos e de volta', (reais, cents) => {
    expect(reaisToCents(reais)).toBe(cents)
    expect(centsToReais(cents)).toBe(reais)
  })

  it.each([-1, 1.005, 0.001, Number.NaN, Number.POSITIVE_INFINITY, 1e20])(
    'rejeita reais inválidos: %s',
    (value) => expect(() => reaisToCents(value)).toThrow(),
  )

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejeita centavos inválidos: %s',
    (value) => expect(() => centsToReais(value)).toThrow(),
  )

  it('rejeita centavos que perderiam precisão ao retornar em reais', () => {
    expect(() => centsToReais(Number.MAX_SAFE_INTEGER)).toThrow()
  })
})
