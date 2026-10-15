import { CachacaBanner } from '@/features/catalog/CachacaBanner'
import { standardChopes } from '@/features/catalog/expanded-api'
import { PriceTable } from '@/features/catalog/PriceTable'
import { visibleProducts } from '@/features/catalog/pricing'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { VariantCatalog } from '@/features/catalog/VariantCatalog'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
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
          <SectionHeading eyebrow="01 · Conheça nossos chopes" id="chopes-title">
            Escolha
            <DesktopBreak />o seu
          </SectionHeading>
          <p className={styles.note}>
            {!standard
              ? 'Consulte os valores e as apresentações disponíveis.'
              : count === null
                ? 'Consulte os valores dos barris de 30 e de 50 litros.'
                : `${count === 8 ? 'Oito' : count} ${count === 1 ? 'opção' : 'opções'} de chopp, com valores do barril de 30 e de 50 litros.`}
          </p>
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
                      <PriceTable products={visibleProducts(state.catalog.products)} />
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
                      item={{ title: i.name, description: i.description, variants: i.variants }}
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
