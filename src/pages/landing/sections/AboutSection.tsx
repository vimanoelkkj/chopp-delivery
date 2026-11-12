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
            {editorial?.body ?? (
              <>
                Somos especialistas dedicados na cadeia do barril de chopp e também entregamos
                cachaça em garrafa. Mantemos nossa câmara fria estritamente controlada para que a
                carbonatação, a espuma cremosa e a frescura de cada cervejaria cheguem intactas ao
                seu evento.
              </>
            )}
          </p>
          {editorial === undefined && (
            <p className={styles.text}>
              O Chopp Delivery une a pontualidade da entrega local com equipamentos profissionais de
              refrigeração para fazer cada brinde memorável.
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
            <span>Barris em aço inoxidável padrão alimentício</span>
            <span className={styles.badge}>• Higienização rigorosa</span>
          </div>
        </div>
      </Container>
    </section>
  )
}
