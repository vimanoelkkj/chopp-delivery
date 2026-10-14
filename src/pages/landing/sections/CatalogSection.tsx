import { CachacaBanner } from '@/features/catalog/CachacaBanner'
import { PriceTable } from '@/features/catalog/PriceTable'
import { visibleProducts } from '@/features/catalog/pricing'
import { cachaca, products } from '@/features/catalog/products'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import styles from './CatalogSection.module.css'

export function CatalogSection() {
  return (
    <section id="chopes" className={styles.section} aria-labelledby="chopes-title">
      <Container className={styles.inner}>
        <div className={styles.top}>
          <SectionHeading eyebrow="01 · Conheça nossos chopes" id="chopes-title">
            Escolha
            <DesktopBreak />o seu
          </SectionHeading>
          <p className={styles.note}>
            Oito opções de chopp, com valores do barril de 30 e de 50 litros.
          </p>
        </div>
        <div>
          <PriceTable products={visibleProducts(products)} />
          <CachacaBanner item={cachaca} />
        </div>
      </Container>
    </section>
  )
}
