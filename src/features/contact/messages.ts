import { formatCents, normalizeQuantity, orderTotalCents } from '@/shared/lib/quantity'

/** "Preço unitário: R$ X. Total: R$ Y." ou pedido de confirmação quando o preço é inválido. */
export function describeOrderPrice(
  price: number | null | undefined,
  quantity = 1,
  alwaysCents = false,
): string {
  const qty = normalizeQuantity(quantity)
  const total = orderTotalCents(price, qty)
  if (total === null) return 'Preço não informado; favor confirmar.'
  return `Preço unitário: ${formatCents(total / qty, alwaysCents)}. Total: ${formatCents(total, alwaysCents)}.`
}

/** Cada CTA de barril pede uma apresentação e a quantidade escolhida na interface (mínimo 1). */
export function buildBarrelOrderMessage(
  product: string,
  presentation: string,
  price: number | null | undefined,
  quantity = 1,
): string {
  const qty = normalizeQuantity(quantity)
  return `Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de ${product} (${presentation}). Quantidade: ${qty} ${qty === 1 ? 'unidade' : 'unidades'}. ${describeOrderPrice(price, qty)}`
}

/** Mensagens iniciais da conversa. Centralizadas para não espalhar texto pelos componentes. */
export const messages = {
  order: 'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir um chopp.',
  prices:
    'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de consultar os valores dos barris.',
  promo: 'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de saber da promoção.',
  contact: 'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de conversar.',
} as const

export type MessageKey = keyof typeof messages
