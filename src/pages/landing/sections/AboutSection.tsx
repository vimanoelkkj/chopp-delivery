import type { ReactNode } from 'react'
import { Container } from '@/shared/ui/Container'
import { KegCutout } from '@/shared/ui/KegCutout'
import { PublishedMedia } from '@/shared/ui/PublishedMedia'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './AboutSection.module.css'

export function AboutSection({
  editorial,
  mediaFallback,
  publishedMedia,
  sectionNumber,
}: {
  /** Mídia da publicação vigente; ausente no preview/rascunho. */
  publishedMedia?: { id: string; alt: string } | null
  sectionNumber?: string
  mediaFallback?: ReactNode
  editorial?: Pick<CmsContentsV2['about'], 'heading' | 'body'>
} = {}) {
  return (
    <section id="sobre" className={styles.section} aria-labelledby="sobre-title">
      <Container className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{sectionNumber ?? '04'} • Origem e compromisso</p>
          <h2 id="sobre-title" className={styles.title}>
            {editorial?.heading ?? <>O chopp como centro da sua celebração</>}
          </h2>
          <p className={styles.lead}>
            {editorial?.body ?? <>Entregamos chopp em barril e cachaça em garrafa.</>}
          </p>
          {editorial === undefined && (
            <p className={styles.text}>
              Operação exclusiva por delivery em Belo Horizonte e região.
            </p>
          )}
        </div>

        <div className={styles.mediaCard}>
          {mediaFallback ?? (
            <div className={styles.stage}>
              <PublishedMedia
                media={publishedMedia}
                profile="section"
                fit="cover"
                eager={false}
                fallback={
                  <KegCutout
                    photo="studio30"
                    alt="Barril de chopp em aço inox escovado"
                    eager={false}
                  />
                }
              />
            </div>
          )}
          <div className={styles.captionRow}>
            <span>Barris de chopp</span>
            <span className={styles.badge}>• Delivery</span>
          </div>
        </div>
      </Container>
    </section>
  )
}
