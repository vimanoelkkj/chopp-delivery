import { formatBRL } from '@/shared/lib/format'
import { reaisToCents } from '../../../shared/money'

/** Cada CTA de barril pede uma apresentação, sem seleção de quantidade na interface. */
export function buildBarrelOrderMessage(
  product: string,
  presentation: string,
  price: number | null | undefined,
): string {
  let validPrice = false
  if (typeof price === 'number' && price > 0) {
    try {
      validPrice = reaisToCents(price) > 0
    } catch {
      // Preços inválidos não são arredondados nem convertidos em valores fictícios.
    }
  }
  const priceText = validPrice
    ? `Preço unitário: ${formatBRL(price as number, { cents: !Number.isInteger(price) })}.`
    : 'Preço não informado; favor confirmar.'
  return `Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de ${product} (${presentation}). Quantidade: 1 unidade. ${priceText}`
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
