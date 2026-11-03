import '@fontsource/hanken-grotesk/latin-800'
import '@fontsource/hanken-grotesk/latin-900'
import { useRef, useState } from 'react'
import { BarrelCarousel3D } from '@/features/catalog/BarrelCarousel3D'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { SiteHeader } from '@/pages/landing/sections/SiteHeader'
import { StickyCta } from '@/pages/landing/sections/StickyCta'
import { PASTEL_THEME, useDocumentTheme } from '@/shared/lib/documentTheme'
import { formatBRL } from '@/shared/lib/format'
import { Container } from '@/shared/ui/Container'
import styles from './ProtoPastel.module.css'
import { ProtoLower, ProtoSwitcher, useProtoCatalog, useStickyVisibility } from './ProtoShared'
import {
  type Composition,
  Cutout,
  compositionFromLocation,
  compositions,
  cutoutMedia,
  cutouts,
  type Surface,
  surfaceFromLocation,
  surfaces,
} from './pastelKegs'
import { PastelLower } from './pastelSections'

/**
 * Experimento "Pastel Brewery" (somente DEV). Reaproveita todas as seções oficiais: a identidade
 * vem de tokens re-escopados em `.page` (ver ProtoPastel.module.css) e de um Hero próprio.
 */
export function ProtoPastel() {
  useDocumentTheme(PASTEL_THEME)
  const { state, retry, chopes, minPrice } = useProtoCatalog()
  const heroCta = useRef<HTMLDivElement>(null)
  const [surface] = useState<Surface>(surfaceFromLocation)
  const [composition] = useState<Composition>(compositionFromLocation)
  const { finalCtaRef, stickyVisible } = useStickyVisibility(heroCta)

  return (
    <div id="topo" className={styles.page} data-surface={surface} data-composition={composition}>
      <SiteHeader />
      <main id="conteudo">
        <section className={styles.hero} aria-labelledby="pastel-title">
          <Container className={styles.grid}>
            <div className={styles.copy}>
              <h1 id="pastel-title" className={styles.title}>
                O melhor do chopp, direto para o seu evento.
              </h1>
              <p className={styles.lead}>
                Barris de aço inox com chopeira elétrica regulada. Entrega e instalação em São João
                del-Rei e região.
              </p>
              <div className={styles.actions} ref={heroCta}>
                <WhatsAppButton message="order" size="lg">
                  Pedir no WhatsApp
                </WhatsAppButton>
                <a href="#barris" className={styles.textLink}>
                  Ver barris e volumes
                </a>
              </div>
            </div>

            <div className={styles.visual}>
              {cutouts.hero50 ? (
                <div className={styles.heroCutout}>
                  <Cutout
                    src={cutouts.hero50}
                    alt="Barril de chopp em aço inox escovado, 50 litros"
                  />
                </div>
              ) : (
                <img
                  src="/images/kegs/keg-hero-50l.jpg"
                  alt="Barril de chopp em aço inox escovado, 50 litros"
                  className={styles.keg}
                  loading="eager"
                />
              )}
              {minPrice !== null && (
                <p
                  className={[styles.price, cutouts.hero50 ? styles.priceDock : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span>Barris a partir de</span>
                  <strong>{formatBRL(minPrice)}</strong>
                </p>
              )}
            </div>
          </Container>
        </section>

        <section id="barris" className={styles.barrels} aria-labelledby="pastel-barris">
          <Container>
            <h2 id="pastel-barris" className={styles.h2}>
              Escolha seu barril
            </h2>
            {state.status === 'ready' && chopes.length > 0 ? (
              <BarrelCarousel3D
                items={chopes}
                className={styles.carousel}
                renderItemMedia={(id) =>
                  cutoutMedia(
                    id,
                    chopes.findIndex((c) => c.id === id),
                    `Barril de Chopp ${chopes.find((c) => c.id === id)?.name ?? ''} em Aço Inox`,
                  )
                }
              />
            ) : (
              <p role="status" className={styles.status}>
                {state.status === 'loading'
                  ? 'Carregando vitrine de barris…'
                  : 'Vitrine de barris indisponível no momento.'}
              </p>
            )}
          </Container>
        </section>

        {composition === 'refined' ? (
          <PastelLower state={state} retry={retry} finalCtaRef={finalCtaRef} />
        ) : (
          <ProtoLower state={state} retry={retry} finalCtaRef={finalCtaRef} />
        )}
      </main>
      <nav className={styles.surfaces} aria-label="Composição (somente desenvolvimento)">
        <span>Composição:</span>
        {compositions.map((c) => (
          <a
            key={c.id}
            href={`/__proto/pastel?composition=${c.id}`}
            aria-current={c.id === composition ? 'page' : undefined}
          >
            {c.label}
          </a>
        ))}
      </nav>
      {composition === 'current' && (
        <nav
          className={styles.surfaces}
          aria-label="Superfície dos barris (somente desenvolvimento)"
        >
          <span>Superfície:</span>
          {surfaces.map((s) => (
            <a
              key={s.id}
              href={`/__proto/pastel?surface=${s.id}`}
              aria-current={s.id === surface ? 'page' : undefined}
            >
              {s.label}
            </a>
          ))}
        </nav>
      )}
      <ProtoSwitcher current="pastel" />
      <StickyCta visible={stickyVisible} />
    </div>
  )
}
