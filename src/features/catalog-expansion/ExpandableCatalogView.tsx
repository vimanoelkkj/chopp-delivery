import type { CatalogState } from '@/features/catalog/useCatalog'
import { AgeNotice } from '@/features/compliance/AgeNotice'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import { CachacasShowcase } from './CachacasShowcase'
import styles from './ExpandableCatalogView.module.css'
import { ExpandablePriceTable } from './ExpandablePriceTable'
import { getVisibleCatalog, type PublicCatalogV2 } from './types'
import { type PublicCatalogState, usePublicCatalog } from './usePublicCatalog'

type Props = {
  catalog?: PublicCatalogV2 | null
  state?: CatalogState
  filterHidden?: boolean
  omitEmptyCategories?: boolean
  onRetry?: () => void
  id?: string
  titleId?: string
  showCompliance?: boolean
}

/** Explicit snapshots never mount the connected child, including loading/error snapshots. */
export function ExpandableCatalogView(props: Props) {
  if (props.state) {
    const state: PublicCatalogState =
      props.state.status === 'ready'
        ? { status: 'ready', catalog: props.state.catalog.expanded }
        : props.state
    return <CatalogPresentation {...props} snapshot={state} />
  }
  if (props.catalog != null) {
    return <CatalogPresentation {...props} snapshot={{ status: 'ready', catalog: props.catalog }} />
  }
  return <ConnectedCatalog {...props} />
}
function ConnectedCatalog(props: Props) {
  const { state, retry } = usePublicCatalog()
  return <CatalogPresentation {...props} snapshot={state} onRetry={props.onRetry ?? retry} />
}
function CatalogPresentation({
  snapshot,
  filterHidden = true,
  omitEmptyCategories = true,
  onRetry,
  id = 'catalogo-expansivel',
  titleId = 'catalogo-expansivel-title',
  showCompliance = true,
}: Props & { snapshot: PublicCatalogState }) {
  const categories =
    snapshot.status === 'ready'
      ? getVisibleCatalog(snapshot.catalog, { includeHidden: !filterHidden, omitEmptyCategories })
      : []
  const beerCount = categories.find((c) => c.id === 'chopes')?.items.length ?? 0
  return (
    <section
      id={id}
      className={styles.section}
      aria-labelledby={titleId}
      data-testid="expandable-catalog-view"
    >
      <Container className={styles.inner}>
        <div className={styles.top}>
          <SectionHeading eyebrow="01 · Conheça nossos chopes" id={titleId}>
            Escolha
            <DesktopBreak />o seu chopp
          </SectionHeading>
          {snapshot.status === 'ready' && (
            <p className={styles.note} data-testid="catalog-count-note">
              {beerCount > 0
                ? `${beerCount} ${beerCount === 1 ? 'opção' : 'opções'} de chopp com valores e apresentações disponíveis.`
                : 'Consulte nossa carta de chopes e bebidas especiais.'}
            </p>
          )}
        </div>
        {snapshot.status === 'loading' && (
          <div className={styles.statusBox} role="status">
            <p className={styles.statusText}>Carregando catálogo…</p>
          </div>
        )}
        {snapshot.status === 'error' && (
          <div className={styles.errorBox} role="alert">
            <p className={styles.errorText}>Catálogo indisponível no momento. Tente novamente.</p>
            <Button onClick={onRetry} variant="gold">
              Tentar novamente
            </Button>
          </div>
        )}
        {snapshot.status === 'ready' && (
          <>
            {beerCount === 0 && (
              <p role="status" className={styles.emptyNotice}>
                Nenhum chope disponível no catálogo no momento.
              </p>
            )}
            {categories.map(
              (category) =>
                (category.items.length > 0 || !omitEmptyCategories) && (
                  <div key={category.id} data-testid={`category-${category.id}-section`}>
                    {category.items.length === 0 ? (
                      <p className={styles.emptyNotice}>{category.name}: nenhum item visível.</p>
                    ) : category.id === 'cachacas' ? (
                      <CachacasShowcase items={category.items} />
                    ) : (
                      <>
                        {category.id !== 'chopes' && (
                          <h3 className={styles.categoryTitle}>{category.name}</h3>
                        )}
                        <ExpandablePriceTable
                          items={category.items}
                          volumeUnit={category.id === 'chopes' ? 'L' : 'ml'}
                          caption={
                            category.id === 'chopes'
                              ? undefined
                              : `Apresentações e valores de ${category.name}`
                          }
                        />
                      </>
                    )}
                  </div>
                ),
            )}
            <div className={styles.deliveryNotice} data-testid="delivery-notice">
              <div>
                <span className={styles.deliveryTitle}>Delivery e Retirada</span>
                <p className={styles.deliveryText}>
                  Escolha o chope ou cachaça, o tamanho e o horário. A gente entrega ou você retira.
                  Consulte condições para seu endereço.
                </p>
              </div>
            </div>
            {showCompliance && (
              <div className={styles.complianceWrapper}>
                <AgeNotice variant="hero" />
              </div>
            )}
          </>
        )}
      </Container>
    </section>
  )
}
