import { reaisToCents } from '../../../shared/money'
import { formatBRL } from './format'

export const MIN_ORDER_QUANTITY = 1
export const MAX_ORDER_QUANTITY = 99

/** Quantidade sempre inteira entre 1 e 99; qualquer outro valor volta para 1. */
export function normalizeQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return MIN_ORDER_QUANTITY
  return Math.min(MAX_ORDER_QUANTITY, Math.max(MIN_ORDER_QUANTITY, value))
}

/** Total em centavos (inteiros, sem ponto flutuante); `null` se o preço unitário for inválido. */
export function orderTotalCents(price: number | null | undefined, quantity: number): number | null {
  if (typeof price !== 'number' || price <= 0) return null
  try {
    const unit = reaisToCents(price)
    return unit > 0 ? unit * normalizeQuantity(quantity) : null
  } catch {
    return null
  }
}

/** Formata centavos inteiros; omite ",00" quando o valor é em reais cheios. */
export function formatCents(cents: number, alwaysCents = false): string {
  return formatBRL(cents / 100, { cents: alwaysCents || cents % 100 !== 0 })
}

/** Texto do total ("R$ 1.020,58") ou `null` quando o preço não é válido. */
export function formatOrderTotal(
  price: number | null | undefined,
  quantity: number,
  alwaysCents = false,
): string | null {
  const cents = orderTotalCents(price, quantity)
  return cents === null ? null : formatCents(cents, alwaysCents)
}
