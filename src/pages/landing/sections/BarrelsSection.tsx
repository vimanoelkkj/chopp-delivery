import type { ReactNode } from 'react'
import { BarrelCarousel3D } from '@/features/catalog/BarrelCarousel3D'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { Container } from '@/shared/ui/Container'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './BarrelsSection.module.css'

export function BarrelsSection({
  state,
  editorial,
  renderItemMedia,
  sectionNumber,
}: {
  state: CatalogState
  sectionNumber?: string
  renderItemMedia?: (itemId: string) => ReactNode
  editorial?: Pick<CmsContentsV2['carousel'], 'heading' | 'lead'>
}) {
  const chopes =
    state.status === 'ready'
      ? (state.catalog.expanded.categories.find((c) => c.id === 'chopes')?.items ?? [])
      : []

  return (
    <section id="barris" className={styles.section} aria-labelledby="barris-title">
      <Container>
        <div className={styles.header}>
          <p className={styles.eyebrow}>{sectionNumber ?? '01'} • Vitrine Assinatura</p>
          <h2 id="barris-title" className={styles.title}>
            {editorial?.heading ?? <>Escolha seu Barril em 3D</>}
          </h2>
          <p className={styles.lead}>
            {editorial?.lead ?? (
              <>
                Navegue pelos barris reais da nossa câmara fria. Arraste horizontalmente ou use as
                setas para inspecionar detalhes, litragens e valores de cada cervejaria.
              </>
            )}
          </p>
        </div>

        {state.status === 'loading' && (
          <p role="status" className={styles.statusMessage}>
            Carregando vitrine de barris…
          </p>
        )}

        {state.status === 'error' && (
          <p className={styles.statusMessage}>Vitrine de barris indisponível no momento.</p>
        )}

        {state.status === 'ready' &&
          (chopes.length === 0 ? (
            <p role="status" className={styles.statusMessage}>
              Nenhum barril disponível no catálogo no momento.
            </p>
          ) : (
            <BarrelCarousel3D items={chopes} renderItemMedia={renderItemMedia} />
          ))}

        <div className={styles.specsGrid}>
          <div className={styles.specCard}>
            <span className={styles.specValue}>30 Litros</span>
            <span className={styles.specLabel}>
              Rende aprox. 60 copos de 500ml (ou 100 copos de 300ml)
            </span>
          </div>
          <div className={styles.specCard}>
            <span className={styles.specValue}>50 Litros</span>
            <span className={styles.specLabel}>
              Rende aprox. 100 copos de 500ml (ou 160 copos de 300ml)
            </span>
          </div>
          <div className={styles.specCard}>
            <span className={styles.specValue}>100% Inclusos</span>
            <span className={styles.specLabel}>
              Chopeira elétrica profissional 110V/220V e cilindro de CO2 regulado
            </span>
          </div>
          <div className={styles.specCard}>
            <span className={styles.specValue}>São João del-Rei</span>
            <span className={styles.specLabel}>
              Entrega, instalação técnica no local e recolhimento sem taxa oculta
            </span>
          </div>
        </div>
      </Container>
    </section>
  )
}
