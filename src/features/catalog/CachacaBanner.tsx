import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import type { PublicCatalog } from '../../../shared/catalog'
import { centsToReais } from '../../../shared/money'
import styles from './CachacaBanner.module.css'
import type { Cachaca } from './types'

type ExpandedBottle = Pick<Cachaca, 'title' | 'description'> & {
  variants: PublicCatalog['categories'][number]['items'][number]['variants']
}

/** O catálogo nomeia a vitrine como "Temos cachaça"; na mensagem do pedido isso vira só o produto. */
export function cachacaProductName(title: string): string {
  return title.trim().replace(/^temos\s+/i, '')
}

export function CachacaBanner({ item }: { item: Cachaca | ExpandedBottle }) {
  const productName = cachacaProductName(item.title)
  return (
    <aside className={styles.banner} aria-label={item.title}>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Tradição mineira em barril</p>
        <h3 className={styles.title}>{item.title}</h3>
        <p className={styles.description}>{item.description}</p>
      </div>

      <div className={styles.actionArea}>
        {'variants' in item ? (
          item.variants.map((v) => {
            const isAvail = v.priceCents !== null
            const priceText =
              v.priceCents !== null ? formatBRL(centsToReais(v.priceCents)) : 'Indisponível'
            const message = `Olá! Gostaria de adicionar a ${productName} (${v.label}${v.volumeMl ? ` - ${v.volumeMl}ml` : ''} por ${priceText}) ao meu pedido.`
            return (
              <div key={v.code} className={styles.variantCard}>
                <div className={styles.priceBlock}>
                  <span className={styles.priceSub}>
                    {v.label} {v.volumeMl ? `${v.volumeMl} ml` : ''}
                  </span>
                  <span className={styles.price}>
                    <span className="visually-hidden"> · </span>
                    {priceText}
                  </span>
                </div>
                {isAvail ? (
                  <WhatsAppButton customText={message} variant="gold" size="md">
                    Adicionar {v.label}
                  </WhatsAppButton>
                ) : null}
              </div>
            )
          })
        ) : (
          <div className={styles.variantCard}>
            <div className={styles.priceBlock}>
              <span className={styles.priceSub}>Garrafa {item.bottleMl} ml</span>
              <span className={styles.price}>
                <span className="visually-hidden"> · </span>
                {formatBRL(item.price)}
              </span>
            </div>
            <WhatsAppButton
              customText={`Olá! Gostaria de adicionar a ${productName} (Garrafa ${item.bottleMl}ml por ${formatBRL(item.price)}) ao meu pedido.`}
              variant="gold"
              size="md"
            >
              Adicionar ao Pedido
            </WhatsAppButton>
          </div>
        )}
      </div>
    </aside>
  )
}
