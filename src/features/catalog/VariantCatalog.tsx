import { useState } from 'react'
import { OrderActions } from '@/features/cart/OrderActions'
import { buildBarrelOrderMessage } from '@/features/contact/messages'
import { formatBRL, formatCatalogVolume } from '@/shared/lib/format'
import { formatOrderTotal } from '@/shared/lib/quantity'
import { QuantityStepper } from '@/shared/ui/QuantityStepper'
import { centsToReais } from '../../../shared/money'
import {
  labelMentionsVolume,
  type PublicItem,
  type PublicVariant,
  presentationText,
} from './presentation'
import styles from './VariantCatalog.module.css'

function VariantLine({
  item,
  variant,
  orderable,
}: {
  item: PublicItem
  variant: PublicVariant
  orderable: boolean
}) {
  const [quantity, setQuantity] = useState(1)
  const price = variant.priceCents === null ? null : centsToReais(variant.priceCents)
  const volume =
    variant.volumeMl === null || labelMentionsVolume(variant.label, variant.volumeMl)
      ? ''
      : formatCatalogVolume(variant.volumeMl, { compact: false })
  const subject = `${item.name}, ${variant.label}`
  return (
    <li className={styles.variant}>
      <span className={styles.label}>
        {variant.label}
        {volume ? <span className={styles.volume}>{` · ${volume}`}</span> : null}
      </span>
      {price === null ? (
        <span className={styles.unavailable}>Não comercializado</span>
      ) : (
        <>
          <span className={styles.price}>{formatBRL(price)}</span>
          {orderable ? (
            <>
              <QuantityStepper
                value={quantity}
                onChange={setQuantity}
                subject={subject}
                total={formatOrderTotal(price, quantity)}
                className={styles.quantity}
              />
              <OrderActions
                line={{
                  itemId: item.id,
                  variantCode: variant.code,
                  name: item.name,
                  label: variant.label,
                  unitPriceCents: variant.priceCents as number,
                }}
                quantity={quantity}
                directMessage={buildBarrelOrderMessage(
                  item.name,
                  presentationText(variant.label, variant.volumeMl),
                  price,
                  quantity,
                )}
                subject={subject}
                legacyLabel={
                  <>
                    Pedir
                    <span className="visually-hidden">{` ${subject}`}</span>
                  </>
                }
                className={styles.order}
              />
            </>
          ) : null}
        </>
      )}
    </li>
  )
}

/**
 * Variantes de um produto em lista, uma linha por variante. Com `orderable`, cada variante com
 * preço tem quantidade e botão "Pedir" (mensagem de barril); sem preço, só informa que não é vendida.
 */
export function VariantCatalog({
  items,
  orderable = false,
  inTable,
}: {
  items: PublicItem[]
  orderable?: boolean
  /** Produtos que já aparecem na tabela: aqui entram só as demais apresentações deles. */
  inTable?: ReadonlySet<string>
}) {
  return (
    <div className={styles.catalog}>
      {items.map((item) => (
        <article key={item.id} aria-label={item.name} className={styles.item}>
          <h3 className={styles.name}>{item.name}</h3>
          {item.description ? <p className={styles.description}>{item.description}</p> : null}
          {inTable?.has(item.id) ? <p className={styles.kicker}>Outras apresentações</p> : null}
          <ul className={styles.variants}>
            {item.variants.map((variant) => (
              <VariantLine key={variant.code} item={item} variant={variant} orderable={orderable} />
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}
