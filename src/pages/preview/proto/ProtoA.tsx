import { useRef } from 'react'
import { BarrelCarousel3D } from '@/features/catalog/BarrelCarousel3D'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { SiteHeader } from '@/pages/landing/sections/SiteHeader'
import { StickyCta } from '@/pages/landing/sections/StickyCta'
import { formatBRL } from '@/shared/lib/format'
import { Container } from '@/shared/ui/Container'
import styles from './ProtoA.module.css'
import { ProtoLower, ProtoSwitcher, useProtoCatalog, useStickyVisibility } from './ProtoShared'

/** Proposta A: Conceito C refinado. Mesma identidade, Hero compacto e carrossel com card dominante. */
export function ProtoA() {
  const { state, retry, chopes, minPrice } = useProtoCatalog()
  const heroCta = useRef<HTMLDivElement>(null)
  const { finalCtaRef, stickyVisible } = useStickyVisibility(heroCta)

  return (
    <div id="topo" className={styles.page}>
      <SiteHeader />
      <main id="conteudo">
        <section className={styles.hero} aria-labelledby="proto-a-title">
          <Container className={styles.grid}>
            <div className={styles.copy}>
              <p className={styles.eyebrow}>Barris 30L &amp; 50L · Delivery</p>
              <h1 id="proto-a-title" className={styles.title}>
                O melhor do chopp.
                <span className={styles.accent}> Direto para o seu evento.</span>
              </h1>
              <p className={styles.lead}>
                Barris em aço inox com chopeira elétrica regulada. Entrega e instalação em São João
                del-Rei e região.
              </p>
            </div>

            <div className={styles.visual}>
              <img
                src="/images/kegs/keg-hero-50l.jpg"
                alt="Barril de chopp em aço inox escovado, 50 litros"
                className={styles.keg}
                loading="eager"
              />
              {minPrice !== null && (
                <p className={styles.pill}>
                  <span>Barris a partir de</span>
                  <strong>{formatBRL(minPrice)}</strong>
                </p>
              )}
            </div>

            <div className={styles.actions} ref={heroCta}>
              <WhatsAppButton message="order" size="lg" fullWidth>
                Pedir no WhatsApp
              </WhatsAppButton>
              <a href="#barris" className={styles.textLink}>
                Ver barris e volumes <span aria-hidden="true">↓</span>
              </a>
            </div>
          </Container>
        </section>

        <section id="barris" className={styles.barrels} aria-labelledby="proto-a-barris">
          <Container>
            <header className={styles.barrelsHead}>
              <p className={styles.eyebrow}>Vitrine</p>
              <h2 id="proto-a-barris" className={styles.h2}>
                Escolha seu barril
              </h2>
            </header>
            {state.status === 'ready' && chopes.length > 0 ? (
              <BarrelCarousel3D items={chopes} className={styles.carousel} />
            ) : (
              <p role="status" className={styles.status}>
                {state.status === 'loading'
                  ? 'Carregando vitrine de barris…'
                  : 'Vitrine de barris indisponível no momento.'}
              </p>
            )}
          </Container>
        </section>

        <ProtoLower state={state} retry={retry} finalCtaRef={finalCtaRef} />
      </main>
      <ProtoSwitcher current="a" />
      <StickyCta visible={stickyVisible} />
    </div>
  )
}
