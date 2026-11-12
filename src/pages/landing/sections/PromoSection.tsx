import { Container } from '@/shared/ui/Container'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './PromoSection.module.css'

/** Destaque apenas quando fornecido pelo editor; não existe campanha padrão ativa. */
export function PromoSection({
  editorial,
  headingId = 'promo-title',
}: {
  headingId?: string
  editorial?: Pick<CmsContentsV2['highlight'], 'heading' | 'body'>
} = {}) {
  if (!editorial) return null

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <Container className={styles.inner}>
        <div className={styles.copy}>
          <h2 id={headingId} className={styles.title}>
            {editorial.heading}
          </h2>
          <p className={styles.text}>{editorial.body}</p>
        </div>
      </Container>
    </section>
  )
}
