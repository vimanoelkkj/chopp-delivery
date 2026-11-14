import { useCart } from '@/features/cart/CartContext'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import styles from './StickyCta.module.css'

type StickyCtaProps = {
  visible: boolean
}

/**
 * Barra fixa de WhatsApp, só no celular. Aparece quando os CTAs do Hero e do final saem da tela,
 * para não repetir o botão que já está à vista. Escondida, fica fora da ordem de foco (`inert`).
 */
export function StickyCta({ visible: requested }: StickyCtaProps) {
  // Com itens no pedido, o FAB do carrinho substitui o WhatsApp flutuante.
  const cartLines = useCart()?.lines.length ?? 0
  const visible = requested && cartLines === 0
  return (
    <div
      id="whatsapp-flutuante"
      className={[styles.bar, visible ? styles.shown : ''].filter(Boolean).join(' ')}
      inert={!visible}
      data-testid="sticky-cta"
      data-visible={visible}
    >
      <WhatsAppButton message="order" size="lg" noticePlacement="above">
        Pedir no WhatsApp
      </WhatsAppButton>
    </div>
  )
}
