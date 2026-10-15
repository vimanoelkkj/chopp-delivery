import { AgeNotice } from '@/features/compliance/AgeNotice'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import { CachacasShowcase } from './CachacasShowcase'
import styles from './ExpandableCatalogView.module.css'
import { ExpandablePriceTable } from './ExpandablePriceTable'
import type { PublicCatalogV2 } from './types'
import { getVisibleCatalog } from './types'
import { usePublicCatalog } from './usePublicCatalog'

type ExpandableCatalogViewProps = {
  /** Catálogo explícito opcional (usado em testes ou simulação DEV). Se omitido, consome GET /api/catalog real. */
  catalog?: PublicCatalogV2 | null
  filterHidden?: boolean
  omitEmptyCategories?: boolean
  onRetry?: () => void
}

export function ExpandableCatalogView({
  catalog: explicitCatalog,
  filterHidden = true,
  omitEmptyCategories = true,
  onRetry,
}: ExpandableCatalogViewProps) {
  const { state: apiState, retry: apiRetry } = usePublicCatalog()

  // Se catalog foi passado explicitamente (ex: fixture ou mock em teste), usa direto
  const isExplicit = explicitCatalog !== undefined && explicitCatalog !== null
  const currentCatalog = isExplicit
    ? explicitCatalog
    : apiState.status === 'ready'
      ? apiState.catalog
      : null
  const isLoading = !isExplicit && apiState.status === 'loading'
  const isError = !isExplicit && apiState.status === 'error'
  const handleRetry = onRetry ?? apiRetry

  if (isLoading) {
    return (
      <section
        id="catalogo-expansivel"
        className={styles.section}
        aria-labelledby="catalogo-expansivel-title"
        data-testid="expandable-catalog-view"
      >
        <Container className={styles.inner}>
          <div className={styles.top}>
            <SectionHeading eyebrow="01 · Conheça nossos chopes" id="catalogo-expansivel-title">
              Escolha
              <DesktopBreak />o seu chopp
            </SectionHeading>
          </div>
          <div className={styles.statusBox} role="status">
            <p className={styles.statusText}>Carregando catálogo…</p>
          </div>
        </Container>
      </section>
    )
  }

  if (isError || !currentCatalog) {
    return (
      <section
        id="catalogo-expansivel"
        className={styles.section}
        aria-labelledby="catalogo-expansivel-title"
        data-testid="expandable-catalog-view"
      >
        <Container className={styles.inner}>
          <div className={styles.top}>
            <SectionHeading eyebrow="01 · Conheça nossos chopes" id="catalogo-expansivel-title">
              Escolha
              <DesktopBreak />o seu chopp
            </SectionHeading>
          </div>
          <div className={styles.errorBox} role="alert">
            <p className={styles.errorText}>Catálogo indisponível no momento. Tente novamente.</p>
            <Button onClick={handleRetry} variant="gold">
              Tentar novamente
            </Button>
          </div>
        </Container>
      </section>
    )
  }

  const visibleCategories = getVisibleCatalog(currentCatalog, {
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
          <SectionHeading eyebrow="01 · Conheça nossos chopes" id="catalogo-expansivel-title">
            Escolha
            <DesktopBreak />o seu chopp
          </SectionHeading>
          <p className={styles.note} data-testid="catalog-count-note">
            {beerCount > 0
              ? `${beerCount} ${beerCount === 1 ? 'opção' : 'opções'} de chopp com valores e apresentações disponíveis.`
              : 'Consulte nossa carta de chopes e bebidas especiais.'}
          </p>
        </div>

        {chopesCategory && chopesCategory.items.length > 0 ? (
          <div data-testid="category-chopes-section">
            <ExpandablePriceTable items={chopesCategory.items} />
          </div>
        ) : (
          <p role="status" className={styles.emptyNotice} data-testid="chopes-empty-notice">
            Nenhum chope disponível no catálogo no momento.
          </p>
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
