const withCents = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const wholeReais = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

/** Formata em reais. Com `cents: false`, omite os centavos (ex.: "R$ 510"). */
export function formatBRL(value: number, { cents = true }: { cents?: boolean } = {}): string {
  return (cents ? withCents : wholeReais).format(value)
}

/**
 * Formata volumes em mililitros de forma exata, sem arredondamentos comerciais.
 * Exemplos:
 * - 750 -> "750 ml"
 * - 1500 -> "1,5L" (ou "1,5 L" com compact: false)
 * - 20000 -> "20L" (ou "20 L" com compact: false)
 * - 30000 -> "30L" (ou "30 L" com compact: false)
 * - 50000 -> "50L" (ou "50 L" com compact: false)
 */
export function formatCatalogVolume(
  ml: number | null | undefined,
  { compact = true }: { compact?: boolean } = {},
): string {
  if (ml === null || ml === undefined || ml <= 0) return ''
  if (ml < 1000) {
    return `${ml} ml`
  }
  const whole = Math.trunc(ml / 1000)
  const remainder = ml % 1000
  const space = compact ? '' : ' '
  if (remainder === 0) {
    return `${whole}${space}L`
  }
  const dec = String(remainder).padStart(3, '0').replace(/0+$/, '')
  return `${whole},${dec}${space}L`
}
