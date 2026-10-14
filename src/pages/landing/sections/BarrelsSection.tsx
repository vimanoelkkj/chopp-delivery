import { joinNames, lowestPrice, onlyLargeBarrel } from '@/features/catalog/pricing'
import type { BarrelSize, Product } from '@/features/catalog/types'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { PhotoPlaceholder } from '@/shared/ui/PhotoPlaceholder'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import styles from './BarrelsSection.module.css'

const usage: Record<BarrelSize, string> = {
  30: 'Para reuniões e churrascos menores.',
  50: 'Para festas e eventos.',
}

function startingAt(products: Product[], size: BarrelSize): string {
  const price = lowestPrice(products, size)
  return price === null ? '' : ` A partir de ${formatBRL(price)}.`
}

export function BarrelsSection({ state }: { state: CatalogState }) {
  const products = state.status === 'ready' ? state.catalog.products : []
  const largeOnly = onlyLargeBarrel(products).map((product) => product.name)

  return (
    <section id="barris" className={styles.section} aria-labelledby="barris-title">
      <Container className={styles.inner}>
        <PhotoPlaceholder
          className={styles.photo}
          caption="barris de 30 e 50 L lado a lado, aço escovado"
        />
        <div className={styles.copy}>
          <SectionHeading eyebrow="02 · Barris" id="barris-title">
            Dois
            <DesktopBreak />
            tamanhos
          </SectionHeading>
          <ul className={styles.sizes}>
            {([30, 50] as const).map((size) => (
              <li key={size} className={styles.size}>
                <span className={styles.liters}>{size} L</span>
                <span className={styles.usage}>
                  {usage[size]}
                  {startingAt(products, size)}
                </span>
              </li>
            ))}
          </ul>
          {state.status !== 'ready' && (
            <p className={styles.note}>
              {state.status === 'loading'
                ? 'Carregando preços…'
                : 'Preços indisponíveis no momento.'}
            </p>
          )}
          {largeOnly.length > 0 && (
            <p className={styles.note}>{joinNames(largeOnly)} só em barril de 50 L.</p>
          )}
          <div>
            <WhatsAppButton message="prices" variant="gold">
              Consultar valores
            </WhatsAppButton>
          </div>
        </div>
      </Container>
    </section>
  )
}
