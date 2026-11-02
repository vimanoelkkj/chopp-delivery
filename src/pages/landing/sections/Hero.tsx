import type { Ref } from 'react'
import { lowestPrice } from '@/features/catalog/pricing'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { AgeNotice } from '@/features/compliance/AgeNotice'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './Hero.module.css'

type HeroProps = {
  editorial?: Pick<CmsContentsV2['hero'], 'heading' | 'summary'>
  state?: CatalogState
  ctaRef?: Ref<HTMLDivElement>
}

export function Hero({ state, ctaRef, editorial }: HeroProps) {
  // Deriva o menor preço real da API dinamicamente (A04 / P1-D)
  const products = state?.status === 'ready' ? state.catalog.products : []
  const min50Price = products.length > 0 ? lowestPrice(products, 50) : null
  const minPrice = min50Price ?? (products.length > 0 ? lowestPrice(products, 30) : null)

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <Container className={styles.grid}>
        <div className={styles.leftCol}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            <span>Chopp Delivery Especial • Barris 30L & 50L</span>
          </div>

          <h1 id="hero-title" className={styles.title}>
            {editorial?.heading ?? (
              <>
                O melhor do chopp.
                <br />
                <span className={styles.accentGradient}>Direto para o seu evento.</span>
              </>
            )}
          </h1>

          <p className={styles.text}>
            {editorial?.summary ?? (
              <>
                Barris em aço inox escovado das melhores cervejarias artesanais e tradicionais.
                Receba com chopeira elétrica regulada pronta para servir. Entrega e instalação
                profissional em São João del-Rei e região.
              </>
            )}
          </p>

          <div className={styles.actions} ref={ctaRef}>
            <WhatsAppButton message="order">Pedir no WhatsApp</WhatsAppButton>
            <Button href="#barris" variant="outline">
              Explorar Barris 3D
            </Button>
            <Button href="#chopes" variant="outline">
              Ver Tabela & Preços
            </Button>
          </div>

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

          <AgeNotice variant="hero" />
        </div>

        <div className={styles.heroVisual}>
          <img
            src="/images/kegs/keg-hero-50l.jpg"
            alt="Barril de Chopp de Inox Escovado 50 Litros com Iluminação Cinematográfica"
            className={styles.kegImg}
            loading="eager"
          />

          <div className={styles.floatingPill}>
            <div>
              <span className={styles.pillLabel}>Protagonista</span>
              <p className={styles.pillTitle}>
                {min50Price !== null ? 'Barril Artesanal 50 Litros' : 'Barris em Aço Inox'}
              </p>
              <p className={styles.pillSub}>
                {min50Price !== null
                  ? 'Rendimento aprox: 100 copos de 500ml'
                  : 'Entrega e instalação profissional inclusas'}
              </p>
            </div>
            {minPrice !== null && (
              <div className={styles.pillPrice}>A partir de {formatBRL(minPrice)}</div>
            )}
          </div>
        </div>
      </Container>
    </section>
  )
}
