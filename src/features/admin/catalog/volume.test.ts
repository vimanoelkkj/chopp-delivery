import { describe, expect, it } from 'vitest'
import { VOLUME_MAX_ML } from './types'
import { formatVolume, parseVolume, sanitizeVolumeInput, volumeUnit } from './volume'

const ml = (text: string, unit: 'L' | 'ml') => {
  const result = parseVolume(text, unit)
  return result.ok ? result.ml : result.message
}

describe('unidade por categoria', () => {
  it('chopes em litros; cachaças e categorias futuras em ml', () => {
    expect(volumeUnit('chopes')).toBe('L')
    expect(volumeUnit('cachacas')).toBe('ml')
    expect(volumeUnit('outra')).toBe('ml')
  })
})

describe('litros → ml exatos (só inteiros)', () => {
  it.each([
    ['20', 20000],
    ['30', 30000],
    ['50', 50000],
    ['7,5', 7500],
    ['7.5', 7500],
    ['0,33', 330],
    ['0,001', 1],
    ['1,25', 1250],
    ['  20  ', 20000],
    ['100000', 100_000_000],
  ])('%s L = %i ml', (text, expected) => expect(ml(text, 'L')).toBe(expected))

  it.each([
    '',
    '0',
    '0,0',
    '0,000',
    '-1',
    '1,2345',
    '1,',
    ',5',
    'abc',
    '1e3',
    '2 0',
    '1,5,5',
    '1000000',
  ])('recusa %j', (text) => expect(typeof ml(text, 'L')).toBe('string'))

  it('sem erro de ponto flutuante nos casos clássicos (0,1 + 0,2; 1,005; 4,35)', () => {
    expect(ml('0,3', 'L')).toBe(300)
    expect(ml('1,005', 'L')).toBe(1005)
    expect(ml('4,35', 'L')).toBe(4350)
    expect(ml('8,2', 'L')).toBe(8200)
  })

  it('limite superior exato', () => {
    expect(ml('100000', 'L')).toBe(VOLUME_MAX_ML)
    expect(ml('100000,001', 'L')).toBe('Volume acima do limite.')
  })
})

describe('ml inteiros', () => {
  it.each([
    ['700', 700],
    ['750', 750],
    ['1000', 1000],
    ['1', 1],
  ])('%s ml', (text, expected) => expect(ml(text, 'ml')).toBe(expected))

  it.each(['', '0', '00', '-5', '7,5', '1.000', 'abc', '1e3'])('recusa %j', (text) =>
    expect(typeof ml(text, 'ml')).toBe('string'),
  )

  it('acima do limite', () => {
    expect(ml(String(VOLUME_MAX_ML), 'ml')).toBe(VOLUME_MAX_ML)
    expect(ml(String(VOLUME_MAX_ML + 1), 'ml')).toBe('Volume acima do limite.')
  })
})

describe('digitação e exibição', () => {
  it('litros: dígitos, um separador e até 3 casas; ml: só dígitos', () => {
    expect(sanitizeVolumeInput('7,5abc', 'L')).toBe('7,5')
    expect(sanitizeVolumeInput('1.2.3', 'L')).toBe('1,23')
    expect(sanitizeVolumeInput('1,23456', 'L')).toBe('1,234')
    expect(sanitizeVolumeInput('-20', 'L')).toBe('20')
    expect(sanitizeVolumeInput('7,5', 'ml')).toBe('75')
    expect(sanitizeVolumeInput('1.000 ml', 'ml')).toBe('1000')
  })

  it('formata ml exatos de volta (ida e volta com o parser)', () => {
    expect(formatVolume(30000, 'L')).toBe('30 L')
    expect(formatVolume(7500, 'L')).toBe('7,5 L')
    expect(formatVolume(330, 'L')).toBe('0,33 L')
    expect(formatVolume(1, 'L')).toBe('0,001 L')
    expect(formatVolume(700, 'ml')).toBe('700 ml')
    for (const value of [1, 330, 7500, 20000, 50000, 100_000_000]) {
      const shown = formatVolume(value, 'L').replace(' L', '')
      expect(ml(shown, 'L')).toBe(value)
    }
  })
})
