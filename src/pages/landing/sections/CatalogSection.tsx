import { CachacaBanner } from '@/features/catalog/CachacaBanner'
import { PriceTable } from '@/features/catalog/PriceTable'
import { visibleProducts } from '@/features/catalog/pricing'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import styles from './CatalogSection.module.css'

export function CatalogSection({ state, retry }: { state: CatalogState; retry: () => void }) {
  const count = state.status === 'ready' ? state.catalog.products.length : null
  return (
    <section id="chopes" className={styles.section} aria-labelledby="chopes-title">
      <Container className={styles.inner}>
        <div className={styles.top}>
          <SectionHeading eyebrow="01 · Conheça nossos chopes" id="chopes-title">
            Escolha
            <DesktopBreak />o seu
          </SectionHeading>
          <p className={styles.note}>
            {count === null
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
          {state.status === 'ready' && (
            <>
              {state.catalog.products.length > 0 ? (
                <PriceTable products={visibleProducts(state.catalog.products)} />
              ) : (
                <p role="status">Nenhum chope disponível no catálogo no momento.</p>
              )}
              {state.catalog.cachaca && <CachacaBanner item={state.catalog.cachaca} />}
            </>
          )}
        </div>
      </Container>
    </section>
  )
}
