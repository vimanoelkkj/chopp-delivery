import { CachacaBanner } from '@/features/catalog/CachacaBanner'
import { standardChopes } from '@/features/catalog/expanded-api'
import { KegCardsGrid } from '@/features/catalog/KegCardsGrid'
import { PriceTable } from '@/features/catalog/PriceTable'
import { visibleProducts } from '@/features/catalog/pricing'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { VariantCatalog } from '@/features/catalog/VariantCatalog'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import styles from './CatalogSection.module.css'

export function CatalogSection({ state, retry }: { state: CatalogState; retry: () => void }) {
  const count = state.status === 'ready' ? state.catalog.products.length : null
  const categories = state.status === 'ready' ? state.catalog.expanded.categories : []
  const chopes = categories.find((c) => c.id === 'chopes')?.items ?? []
  const standard = standardChopes(chopes)

  return (
    <section id="chopes" className={styles.section} aria-labelledby="chopes-title">
      <Container className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>02 • Catálogo Real</p>
            <h2 id="chopes-title" className={styles.title}>
              Nossos Chopes &amp; Litragens
            </h2>
            <p className={styles.note}>
              {!standard
                ? 'Consulte os valores e as apresentações disponíveis diretamente da câmara fria.'
                : count === null
                  ? 'Consulte os valores dos barris de 30 e de 50 litros.'
                  : `${count === 8 ? 'Oito' : count} opções de chopp com valores verificados da câmara fria de São João del-Rei. Chopeira profissional inclusa.`}
            </p>
          </div>
        </div>

        <div>
          {state.status === 'loading' && <p role="status">Carregando catálogo…</p>}
          {state.status === 'error' && (
            <>
              <p role="alert">Catálogo indisponível no momento. Tente novamente.</p>
              <Button onClick={retry}>Tentar novamente</Button>
            </>
          )}
          {state.status === 'ready' &&
            categories.map((c) =>
              c.id === 'chopes' ? (
                <div key={c.id}>
                  {chopes.length ? (
                    standard ? (
                      <>
                        <KegCardsGrid products={visibleProducts(state.catalog.products)} />
                        <div className={styles.tableBlock}>
                          <div className={styles.tableHeader}>
                            <h3 className={styles.tableTitle}>Tabela Comparativa de Litragens</h3>
                            <p className={styles.tableSubtitle}>
                              Valores oficiais verificados por barril
                            </p>
                          </div>
                          <PriceTable products={visibleProducts(state.catalog.products)} />
                        </div>
                      </>
                    ) : (
                      <VariantCatalog items={chopes} />
                    )
                  ) : (
                    <p role="status">Nenhum chope disponível no catálogo no momento.</p>
                  )}
                </div>
              ) : c.id === 'cachacas' ? (
                <div key={c.id}>
                  {c.items.map((i) => (
                    <CachacaBanner
                      key={i.id}
                      item={{
                        title: i.name,
                        description: i.description,
                        variants: i.variants,
                      }}
                    />
                  ))}
                </div>
              ) : c.items.length > 0 ? (
                <div key={c.id}>
                  <h2>{c.name}</h2>
                  <VariantCatalog items={c.items} />
                </div>
              ) : null,
            )}
        </div>
      </Container>
    </section>
  )
}
