export const MAX_PRICE_CENTS = 9_999_999 // R$ 99.999,99

export type PriceParse = { ok: true; cents: number | null } | { ok: false; message: string }

const money = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "510,00", "1.020,50", "510" e "510.5" viram centavos; vazio significa "não vende". */
export function parsePriceText(raw: string): PriceParse {
  const text = raw.replace(/^R\$/i, '').replace(/\s/g, '')
  if (text === '') return { ok: true, cents: null }
  let normalized: string | null = null
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text))
    normalized = text.replaceAll('.', '').replace(',', '.')
  else if (/^\d+(,\d{1,2})?$/.test(text)) normalized = text.replace(',', '.')
  else if (/^\d+\.\d{1,2}$/.test(text)) normalized = text
  if (normalized === null) return { ok: false, message: 'Use o formato 510,00.' }
  const [whole, fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (cents === 0) return { ok: false, message: 'Use um valor maior que zero ou deixe em branco.' }
  if (cents > MAX_PRICE_CENTS)
    return { ok: false, message: 'Valor acima do limite de R$ 99.999,99.' }
  return { ok: true, cents }
}

export function formatPriceText(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : money.format(cents / 100)
}

const MAX_DIGITS = String(MAX_PRICE_CENTS).length

/**
 * Máscara de digitação: os dígitos do campo viram centavos, da direita para a esquerda
 * ("4" → "0,04", "490" → "4,90", "125050" → "1.250,50"). Zero e vazio viram vazio ("não vende").
 * Passar do limite recusa a digitação e devolve `previous`. Só usa inteiros, nunca float.
 */
export function maskPriceInput(typed: string, previous: string): string {
  const digits = typed.replace(/\D/g, '').replace(/^0+/, '')
  if (digits === '') return ''
  if (digits.length > MAX_DIGITS || Number(digits) > MAX_PRICE_CENTS) return previous
  return formatPriceText(Number(digits))
}

export type PasteParse = { ok: true; cents: number } | { ok: false; message: string }

/**
 * Valor colado. Só entra o que tem uma leitura única: "R$ 490,00", "1.250,50", "490,5", "490.50".
 * Recusa o ambíguo: "490" (reais ou centavos?), "1.250" (milhar ou decimal?), "1,250",
 * "1,234.56" e qualquer mistura de separadores.
 */
export function parsePastedPrice(raw: string): PasteParse {
  const text = raw.trim().replace(/^R\$\s*/i, '')
  const match =
    /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,2})$/.exec(text) ?? /^(\d+)\.(\d{1,2})$/.exec(text)
  if (!match) return { ok: false, message: 'Valor ambíguo ou inválido. Cole no formato 490,00.' }
  const cents = Number(match[1].replaceAll('.', '')) * 100 + Number(match[2].padEnd(2, '0'))
  if (cents === 0) return { ok: false, message: 'Use um valor maior que zero.' }
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_CENTS)
    return { ok: false, message: 'Valor acima do limite de R$ 99.999,99.' }
  return { ok: true, cents }
}
