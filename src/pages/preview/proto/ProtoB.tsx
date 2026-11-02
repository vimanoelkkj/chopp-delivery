import { useRef } from 'react'
import { BarrelCarousel3D } from '@/features/catalog/BarrelCarousel3D'
import { SiteHeader } from '@/pages/landing/sections/SiteHeader'
import { formatBRL } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import styles from './ProtoB.module.css'
import { ProtoLower, ProtoSwitcher, useProtoCatalog, useStickyVisibility } from './ProtoShared'

/** Proposta B: editorial imersivo. O barril é o protagonista; menos texto e uma única ação inicial. */
export function ProtoB() {
  const { state, retry, chopes, minPrice } = useProtoCatalog()
  const heroCta = useRef<HTMLDivElement>(null)
  const { finalCtaRef } = useStickyVisibility(heroCta)

  return (
    <div id="topo" className={styles.page}>
      <SiteHeader />
      <main id="conteudo">
        <section className={styles.hero} aria-labelledby="proto-b-title">
          <span className={styles.ghost} aria-hidden="true">
            Barril
          </span>
          <div className={styles.stage} aria-hidden="false">
            <img
              src="/images/kegs/keg-hero-50l.jpg"
              alt="Barril de chopp em aço inox escovado, 50 litros"
              className={styles.keg}
              loading="eager"
            />
          </div>
          <Container className={styles.copy}>
            <p className={styles.eyebrow}>Chopp Delivery Delegas · 30L &amp; 50L</p>
            <h1 id="proto-b-title" className={styles.title}>
              <span>O melhor</span>
              <span>do chopp.</span>
              <span className={styles.accent}>Direto para o seu evento.</span>
            </h1>
            <div className={styles.cta} ref={heroCta}>
              <Button href="#barris" size="lg">
                Escolher meu barril{' '}
                <span aria-hidden="true" className={styles.arrow}>
                  ↓
                </span>
              </Button>
              {minPrice !== null && (
                <p className={styles.price}>
                  <span>a partir de</span>
                  <strong>{formatBRL(minPrice)}</strong>
                </p>
              )}
            </div>
          </Container>
        </section>

        <section id="barris" className={styles.barrels} aria-labelledby="proto-b-barris">
          <Container>
            <header className={styles.barrelsHead}>
              <span className={styles.index} aria-hidden="true">
                01
              </span>
              <h2 id="proto-b-barris" className={styles.h2}>
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
      <ProtoSwitcher current="b" />
    </div>
  )
}
