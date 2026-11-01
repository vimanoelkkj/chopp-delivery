import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Container } from '@/shared/ui/Container'
import styles from './PromoSection.module.css'

/** Promoção ainda não definida: título e texto são placeholders do design. */
export function PromoSection() {
  return (
    <section className={styles.section} aria-labelledby="promo-title">
      <Container className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Happy hour · promoções</p>
          <h2 id="promo-title" className={styles.title}>
            Condições Especiais para Eventos
          </h2>
          <p className={styles.text}>
            Chopeira elétrica profissional inclusa e instalação técnica em São João del-Rei e
            região. Consulte pacotes e datas para seu evento via WhatsApp.
          </p>
        </div>
        <WhatsAppButton message="promo" variant="dark" size="lg">
          Quero essa
        </WhatsAppButton>
      </Container>
    </section>
  )
}
