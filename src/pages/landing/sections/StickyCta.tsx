import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import styles from './StickyCta.module.css'

type StickyCtaProps = {
  visible: boolean
}

/**
 * Barra fixa de WhatsApp, só no celular. Aparece quando os CTAs do Hero e do final saem da tela,
 * para não repetir o botão que já está à vista. Escondida, fica fora da ordem de foco (`inert`).
 */
export function StickyCta({ visible }: StickyCtaProps) {
  return (
    <div
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
