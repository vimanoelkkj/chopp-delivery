import { AgeNotice } from '@/features/compliance/AgeNotice'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import { CachacasShowcase } from './CachacasShowcase'
import styles from './ExpandableCatalogView.module.css'
import { ExpandablePriceTable } from './ExpandablePriceTable'
import type { PublicCatalogV2 } from './types'
import { getVisibleCatalog } from './types'

type ExpandableCatalogViewProps = {
  catalog: PublicCatalogV2
  filterHidden?: boolean
  omitEmptyCategories?: boolean
}

export function ExpandableCatalogView({
  catalog,
  filterHidden = true,
  omitEmptyCategories = true,
}: ExpandableCatalogViewProps) {
  const visibleCategories = getVisibleCatalog(catalog, {
    includeHidden: !filterHidden,
    omitEmptyCategories,
  })

  const chopesCategory = visibleCategories.find((c) => c.id === 'chopes')
  const cachacasCategory = visibleCategories.find((c) => c.id === 'cachacas')
  const otherCategories = visibleCategories.filter((c) => c.id !== 'chopes' && c.id !== 'cachacas')

  const beerCount = chopesCategory ? chopesCategory.items.length : 0

  return (
    <section
      id="catalogo-expansivel"
      className={styles.section}
      aria-labelledby="catalogo-expansivel-title"
      data-testid="expandable-catalog-view"
    >
      <Container className={styles.inner}>
        <div className={styles.top}>
          <SectionHeading eyebrow="01 · Catálogo Expandido v2" id="catalogo-expansivel-title">
            Escolha
            <DesktopBreak />o seu chopp
          </SectionHeading>
          <p className={styles.note} data-testid="catalog-count-note">
            {beerCount > 0
              ? `${beerCount} opções artesanais e tradicionais disponíveis com múltiplos tamanhos de barril.`
              : 'Consulte nossa carta de chopes e bebidas especiais.'}
          </p>
        </div>

        {chopesCategory && chopesCategory.items.length > 0 && (
          <div data-testid="category-chopes-section">
            <ExpandablePriceTable items={chopesCategory.items} />
          </div>
        )}

        {cachacasCategory && cachacasCategory.items.length > 0 && (
          <div data-testid="category-cachacas-section">
            <CachacasShowcase items={cachacasCategory.items} />
          </div>
        )}

        {otherCategories.map((cat) => (
          <div
            key={cat.id}
            data-testid={`category-${cat.id}-section`}
            style={{ marginTop: '2.5rem' }}
          >
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                color: 'var(--color-cream)',
                fontSize: '1.5rem',
                marginBottom: '1rem',
              }}
            >
              {cat.name}
            </h3>
            <ExpandablePriceTable items={cat.items} />
          </div>
        ))}

        <div className={styles.deliveryNotice} data-testid="delivery-notice">
          <div>
            <span className={styles.deliveryTitle}>Delivery e Retirada</span>
            <p className={styles.deliveryText}>
              Escolha o chope ou cachaça, o tamanho e o horário. A gente entrega ou você retira.
              Consulte condições para seu endereço.
            </p>
          </div>
        </div>

        <div className={styles.complianceWrapper}>
          <AgeNotice variant="hero" />
        </div>
      </Container>
    </section>
  )
}
