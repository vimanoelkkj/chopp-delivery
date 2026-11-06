import type { ReactNode, Ref } from 'react'
import { lowestPrice } from '@/features/catalog/pricing'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { AgeNotice } from '@/features/compliance/AgeNotice'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import { Container } from '@/shared/ui/Container'
import { KegCutout } from '@/shared/ui/KegCutout'
import { PublishedMedia } from '@/shared/ui/PublishedMedia'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './Hero.module.css'

type HeroProps = {
  carouselHref?: string | null
  mediaFallback?: ReactNode
  /** Mídia da publicação vigente; ausente no preview/rascunho, que nunca consulta o endpoint público. */
  publishedMedia?: { id: string; alt: string } | null
  editorial?: Pick<CmsContentsV2['hero'], 'heading' | 'summary'>
  state?: CatalogState
  ctaRef?: Ref<HTMLDivElement>
}

export function Hero({
  state,
  ctaRef,
  editorial,
  carouselHref = '#barris',
  mediaFallback,
  publishedMedia,
}: HeroProps) {
  // Deriva o menor preço real da API dinamicamente (A04 / P1-D)
  const products = state?.status === 'ready' ? state.catalog.products : []
  const min50Price = products.length > 0 ? lowestPrice(products, 50) : null
  const minPrice = min50Price ?? (products.length > 0 ? lowestPrice(products, 30) : null)

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <Container className={styles.grid}>
        <div className={styles.copy}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            <span>Chopp Delivery Especial • Barris 30L & 50L</span>
          </div>

          <h1 id="hero-title" className={styles.title}>
            {editorial?.heading ?? (
              <>
                O melhor do chopp.
                <br />
                <span className={styles.accent}>Direto para o seu evento.</span>
              </>
            )}
          </h1>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.kegStage}>
            <PublishedMedia
              media={publishedMedia}
              profile="hero"
              fit="contain"
              fallback={
                mediaFallback ?? (
                  <KegCutout photo="hero50" alt="Barril de chopp em aço inox escovado, 50 litros" />
                )
              }
            />
          </div>

          {minPrice !== null && (
            <div className={styles.floatingPill}>
              <span className={styles.pillLabel}>
                {min50Price !== null ? 'Barril 50 Litros' : 'Barris em Aço Inox'}
              </span>
              <div className={styles.pillPrice}>A partir de {formatBRL(minPrice)}</div>
            </div>
          )}
        </div>

        <div className={styles.actions} ref={ctaRef}>
          <WhatsAppButton message="order" size="lg" fullWidth>
            Pedir no WhatsApp
          </WhatsAppButton>
          <div className={styles.secondaryLinks}>
            {carouselHref !== null && (
              <a href={carouselHref} className={styles.textLink}>
                Explorar Barris 3D
              </a>
            )}
            <a href="#chopes" className={styles.textLink}>
              Ver Tabela & Preços
            </a>
          </div>
        </div>

        <p className={styles.text}>
          {editorial?.summary ?? (
            <>
              Barris em aço inox escovado das melhores cervejarias artesanais e tradicionais. Receba
              com chopeira elétrica regulada pronta para servir. Entrega e instalação profissional
              em São João del-Rei e região.
            </>
          )}
        </p>

        <div className={styles.trustBadges}>
          <div>
            <div className={styles.badgeValue}>30L & 50L</div>
            <div className={styles.badgeLabel}>Barris de aço inox escovado</div>
          </div>
          <div>
            <div className={styles.badgeValue}>100% Instalação</div>
            <div className={styles.badgeLabel}>Chopeira elétrica 110V/220V inclusa</div>
          </div>
          <div>
            <div className={styles.badgeValue}>Zero Retirada</div>
            <div className={styles.badgeLabel}>Entregamos e recolhemos no local</div>
          </div>
        </div>

        <div className={styles.age}>
          <AgeNotice variant="hero" />
        </div>
      </Container>
    </section>
  )
}
