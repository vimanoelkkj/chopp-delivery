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
