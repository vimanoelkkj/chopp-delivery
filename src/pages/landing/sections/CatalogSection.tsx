import { CachacaBanner } from '@/features/catalog/CachacaBanner'
import { PriceComparison } from '@/features/catalog/PriceComparison'
import { chopesNote, splitChopes } from '@/features/catalog/presentation'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { VariantCatalog } from '@/features/catalog/VariantCatalog'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './CatalogSection.module.css'

export function CatalogSection({
  state,
  retry,
  editorial,
  sectionNumber,
}: {
  state: CatalogState
  retry: () => void
  sectionNumber?: string
  editorial?: CmsContentsV2['catalog']
}) {
  const categories = state.status === 'ready' ? state.catalog.expanded.categories : []
  const chopes = categories.find((c) => c.id === 'chopes')?.items ?? []
  const count = state.status === 'ready' ? chopes.length : null
  const { table, extras } = splitChopes(chopes)

  return (
    <section id="chopes" className={styles.section} aria-labelledby="chopes-title">
      <Container className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>{sectionNumber ?? '02'} • Catálogo real</p>
            <h2 id="chopes-title" className={styles.title}>
              {editorial?.heading ?? <>Nossos chopes e litragens</>}
            </h2>
            <p className={styles.note}>{editorial?.intro ?? chopesNote(count)}</p>
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
                    <>
                      {table.length ? <PriceComparison products={table} /> : null}
                      {extras.length ? (
                        <VariantCatalog
                          items={extras}
                          orderable
                          inTable={new Set(table.map((p) => p.id))}
                        />
                      ) : null}
                    </>
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
                        id: i.id,
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
