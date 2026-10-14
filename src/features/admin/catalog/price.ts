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
