import { formatCents } from '@/shared/lib/quantity'
import { type CartLine, cartTotalCents, lineSubtotalCents } from './cart'

/** Mensagem estruturada do pedido. Valores em centavos; o total é estimado e o frete, a confirmar. */
export function buildCartMessage(lines: readonly CartLine[]): string {
  const items = lines.map(
    (line, i) =>
      `${i + 1}. ${line.name} (${line.label})\n   ${line.quantity} x ${formatCents(line.unitPriceCents, true)} = ${formatCents(lineSubtotalCents(line), true)}`,
  )
  return [
    'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de fazer este pedido:',
    '',
    ...items,
    '',
    `Total estimado: ${formatCents(cartTotalCents(lines), true)}`,
    'Frete: a confirmar.',
  ].join('\n')
}
