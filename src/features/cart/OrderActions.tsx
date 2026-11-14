import { type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { CommercialPreviewContext } from '@/features/contact/CommercialPreviewContext'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Button } from '@/shared/ui/Button'
import { useCart } from './CartContext'
import type { CartLine } from './cart'
import styles from './OrderActions.module.css'

type OrderActionsProps = {
  /** Item + variante + preço em centavos (a quantidade vem do seletor). */
  line?: Omit<CartLine, 'quantity'>
  quantity: number
  /** Mensagem do pedido direto (comportamento anterior, preservado). */
  directMessage: string
  /** Texto acessível que identifica o produto (ex.: "Brahma, Barril de 30 L"). */
  subject: string
  /** Rótulo do botão de pedido direto quando não há carrinho (ex.: "Pedir"). */
  legacyLabel: ReactNode
  className?: string
}

/**
 * "Adicionar ao pedido" (principal) e "Pedir somente este produto" (secundário, WhatsApp direto).
 * Fora de um CartProvider, só existe o botão direto de antes.
 */
export function OrderActions({
  line,
  quantity,
  directMessage,
  subject,
  legacyLabel,
  className,
}: OrderActionsProps) {
  const cart = useCart()
  const preview = useContext(CommercialPreviewContext)
  const [added, setAdded] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!cart || !line)
    return (
      <WhatsAppButton customText={directMessage} variant="gold" className={className}>
        {legacyLabel}
      </WhatsAppButton>
    )

  const add = () => {
    cart.add({ ...line, quantity })
    setAdded(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setAdded(false), 2500)
  }

  return (
    <div className={[styles.actions, className].filter(Boolean).join(' ')}>
      <Button variant="gold" className={styles.add} disabled={preview} onClick={add}>
        Adicionar ao pedido
        <span className="visually-hidden">{` ${subject}`}</span>
      </Button>
      <WhatsAppButton customText={directMessage} variant="outline" className={styles.direct}>
        Pedir somente este produto
        <span className="visually-hidden">{` ${subject}`}</span>
      </WhatsAppButton>
      <span className={styles.added} role="status">
        {added ? 'Adicionado ao pedido.' : ''}
      </span>
    </div>
  )
}
