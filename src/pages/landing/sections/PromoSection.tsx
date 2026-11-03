import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Container } from '@/shared/ui/Container'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './PromoSection.module.css'

/** Promoção ainda não definida: título e texto são placeholders do design. */
export function PromoSection({
  editorial,
  headingId = 'promo-title',
}: {
  headingId?: string
  editorial?: Pick<CmsContentsV2['highlight'], 'heading' | 'body'>
} = {}) {
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <Container className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Happy hour · promoções</p>
          <h2 id={headingId} className={styles.title}>
            {editorial?.heading ?? <>Condições especiais para eventos</>}
          </h2>
          <p className={styles.text}>
            {editorial?.body ?? (
              <>
                Chopeira elétrica profissional inclusa e instalação técnica em São João del-Rei e
                região. Consulte pacotes e datas para seu evento via WhatsApp.
              </>
            )}
          </p>
        </div>
        <WhatsAppButton message="promo" variant="gold" size="lg">
          Quero essa
        </WhatsAppButton>
      </Container>
    </section>
  )
}
