import { describe, expect, it } from 'vitest'
import { buildCatalog, changedIds, draftFrom, validate } from './draft'
import { createMockCatalog } from './mockData'
import {
  formatPriceText,
  MAX_PRICE_CENTS,
  maskPriceInput,
  parsePastedPrice,
  parsePriceText,
} from './price'

/** Simula o navegador: cada tecla acrescenta o caractere ao texto atual e a máscara recalcula. */
const typeKeys = (keys: string, start = '') =>
  [...keys].reduce((text, key) => maskPriceInput(text + key, text), start)
/** Backspace com o cursor no fim: o navegador remove o último caractere do texto exibido. */
const backspace = (text: string) => maskPriceInput(text.slice(0, -1), text)

describe('digitação em centavos, da direita para a esquerda', () => {
  it.each([
    ['4', '0,04'],
    ['49', '0,49'],
    ['490', '4,90'],
    ['4900', '49,00'],
    ['49000', '490,00'],
    ['125050', '1.250,50'],
    ['9999999', '99.999,99'],
  ])('digitar %s mostra %s', (keys, expected) => expect(typeKeys(keys)).toBe(expected))

  it('passo a passo: 4 → 0,04 → 0,49 → 4,90 → 49,00', () => {
    const steps: string[] = []
    let text = ''
    for (const key of '4900') {
      text = maskPriceInput(text + key, text)
      steps.push(text)
    }
    expect(steps).toEqual(['0,04', '0,49', '4,90', '49,00'])
  })

  it('zeros à esquerda não contam e zero sozinho continua vazio ("não vende")', () => {
    expect(typeKeys('0')).toBe('')
    expect(typeKeys('000')).toBe('')
    expect(typeKeys('0004')).toBe('0,04')
    expect(typeKeys('40')).toBe('0,40')
  })

  it('o oitavo dígito é recusado e o valor anterior permanece', () => {
    expect(typeKeys('99999991')).toBe('99.999,99')
    expect(typeKeys('1000000')).toBe('10.000,00')
    expect(maskPriceInput('99.999,991', '99.999,99')).toBe('99.999,99')
    expect(maskPriceInput('100000000', '1,00')).toBe('1,00')
  })

  it('letras, símbolos e espaços não entram; só dígitos contam', () => {
    expect(typeKeys('a4b9,c')).toBe('0,49')
    expect(maskPriceInput('R$ 490,00', '')).toBe('490,00')
    expect(maskPriceInput('４', '')).toBe('') // dígito de largura total não é aceito
  })
})

describe('apagar, selecionar e substituir', () => {
  it('Backspace remove o último dígito: 490,00 → 49,00 → 4,90 → 0,49 → 0,04 → vazio', () => {
    const steps: string[] = []
    let text = '490,00'
    while (text) {
      text = backspace(text)
      steps.push(text)
    }
    expect(steps).toEqual(['49,00', '4,90', '0,49', '0,04', ''])
  })

  it('Delete/Backspace sobre a vírgula não muda o valor', () => {
    expect(maskPriceInput('49000', '490,00')).toBe('490,00')
    expect(maskPriceInput('1.25050', '1.250,50')).toBe('1.250,50')
  })

  it('Ctrl+A e Delete limpam (null); Ctrl+A e dígito recomeça do zero', () => {
    expect(maskPriceInput('', '1.250,50')).toBe('')
    expect(maskPriceInput('5', '1.250,50')).toBe('0,05')
  })

  it('cortar parte do texto recalcula pelos dígitos que restam', () => {
    expect(maskPriceInput('1.250,5', '1.250,50')).toBe('125,05')
    expect(maskPriceInput(',50', '1.250,50')).toBe('0,50')
  })
})

describe('colar', () => {
  it.each([
    ['R$ 490,00', 49000],
    ['R$490,00', 49000],
    ['R$ 490,00', 49000],
    ['  490,00  ', 49000],
    ['1.250,50', 125050],
    ['R$ 1.250,50', 125050],
    ['99.999,99', 9999999],
    ['490,5', 49050],
    ['490,50', 49050],
    ['490.50', 49050],
    ['490.5', 49050],
    ['0,01', 1],
    ['1250,50', 125050],
  ])('aceita %j como %i centavos, sem perder os centavos', (text, cents) => {
    expect(parsePastedPrice(text)).toEqual({ ok: true, cents })
    expect(maskPriceInput(String(cents), '')).toBe(formatPriceText(cents))
  })

  it.each([
    '490', // reais ou centavos?
    'R$ 490',
    '1.250', // milhar ou decimal?
    '1,250', // milhar americano ou decimal com 3 casas?
    '1,234.56', // formato americano
    '1.234.567', // só milhares
    '1.25.0,00', // separadores fora do lugar
    '4,9,0',
    '490,',
    ',50',
    '-5,00',
    'abc',
    '490,00 reais',
    '4 90,00',
    '',
  ])('recusa %j por ser ambíguo ou inválido', (text) => {
    expect(parsePastedPrice(text).ok).toBe(false)
  })

  it('recusa zero e valores acima do limite, com mensagem', () => {
    expect(parsePastedPrice('0,00')).toEqual({ ok: false, message: 'Use um valor maior que zero.' })
    expect(parsePastedPrice('100.000,00')).toEqual({
      ok: false,
      message: 'Valor acima do limite de R$ 99.999,99.',
    })
    expect(parsePastedPrice('99.999,99').ok).toBe(true)
  })
})

describe('regras de negócio sobre o texto mascarado', () => {
  it('conversão exata para centavos: sem ponto flutuante, ida e volta', () => {
    for (const cents of [1, 9, 10, 99, 100, 29, 49099, 123456, 9999998, MAX_PRICE_CENTS]) {
      const shown = formatPriceText(cents)
      expect(parsePriceText(shown)).toEqual({ ok: true, cents })
      expect(maskPriceInput(shown, '')).toBe(shown)
    }
    expect(parsePriceText('0,29')).toEqual({ ok: true, cents: 29 })
    expect(parsePriceText('490,99')).toEqual({ ok: true, cents: 49099 })
  })

  it('limites: 1 centavo é o mínimo e 9.999.999 o máximo; zero e acima são inválidos', () => {
    expect(parsePriceText('0,01')).toEqual({ ok: true, cents: 1 })
    expect(parsePriceText('99.999,99')).toEqual({ ok: true, cents: 9999999 })
    expect(parsePriceText('0,00').ok).toBe(false)
    expect(parsePriceText('100.000,00').ok).toBe(false)
    expect(parsePriceText('-1,00').ok).toBe(false)
  })

  it('vazio é null: barril não vendido; cachaça sem preço é erro', () => {
    expect(parsePriceText('')).toEqual({ ok: true, cents: null })
    const draft = draftFrom(createMockCatalog())
    draft.text.brahma['30'] = typeKeys('0')
    draft.text.cachaca.bottle = ''
    const errors = validate(draft)
    expect(errors.brahma).toBeUndefined()
    expect(errors.cachaca?.bottle).toBe('Informe o preço.')
  })

  it('produto visível precisa de ao menos um tamanho com preço; oculto não precisa', () => {
    const saved = createMockCatalog()
    const draft = draftFrom(saved)
    draft.text.brahma['50'] = ''
    expect(validate(draft).brahma?.row).toBeTruthy()
    draft.text.brahma['30'] = typeKeys('1')
    expect(validate(draft).brahma).toBeUndefined()
    draft.text.brahma['30'] = ''
    draft.visible.brahma = false
    expect(validate(draft).brahma).toBeUndefined()
  })

  it('o texto mascarado vira centavos inteiros ou null no catálogo salvo', () => {
    const saved = createMockCatalog()
    const draft = draftFrom(saved)
    draft.text.dronken['30'] = typeKeys('125050')
    draft.text.dronken['50'] = typeKeys('0')
    const next = buildCatalog(saved, draft)
    expect(next.chopes[0].prices).toEqual({ '30': 125050, '50': null })
  })

  it('digitar de volta o valor salvo não conta como alteração pendente', () => {
    const saved = createMockCatalog()
    const draft = draftFrom(saved)
    draft.text.dronken['30'] = typeKeys('51500')
    expect(changedIds(saved, draft)).toEqual(['dronken'])
    draft.text.dronken['30'] = typeKeys('51000')
    expect(changedIds(saved, draft)).toEqual([])
    draft.text.dronken['50'] = typeKeys('')
    expect(changedIds(saved, draft)).toEqual(['dronken'])
  })
})
