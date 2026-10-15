import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { sharedVariantColumns } from './columns'
import styles from './ExpandablePriceTable.module.css'
import { buildCatalogWhatsAppMessage, formatVariantLabel, type VolumeUnit } from './messages'
import { type CatalogItemV2, type CatalogVariantV2, formatPriceFromCents } from './types'

type Props = { items: CatalogItemV2[]; caption?: string; volumeUnit?: VolumeUnit }

function VariantOffer({
  item,
  variant,
  volumeUnit,
  compact = false,
}: {
  item: CatalogItemV2
  variant: CatalogVariantV2
  volumeUnit: VolumeUnit
  compact?: boolean
}) {
  const label = formatVariantLabel(variant, volumeUnit)
  const message = buildCatalogWhatsAppMessage(item.name, variant, volumeUnit)
  if (message === null)
    return (
      <span
        className={[compact ? '' : styles.variantChip, styles.variantChipDisabled].join(' ')}
        aria-disabled="true"
        data-variant-code={variant.code}
      >
        {!compact && <span className={styles.chipSize}>{label}</span>}
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">não disponível</span>
        {!compact && <span className={styles.chipUnavail}>Indisponível</span>}
      </span>
    )
  return (
    <WhatsAppButton
      message="order"
      customMessage={message}
      className={
        compact ? styles.priceAction : [styles.variantChip, styles.variantChipAvailable].join(' ')
      }
    >
      <span data-variant-code={variant.code}>
        {!compact && <span className={styles.chipSize}>{label}</span>}
        <span className={styles.chipPrice}>{formatPriceFromCents(variant.priceCents)}</span>
        <span className="visually-hidden">
          {' '}
          — Pedir {item.name}, {label} no WhatsApp
        </span>
      </span>
    </WhatsAppButton>
  )
}

/** An aligned table for homogeneous presentations; otherwise each item keeps its own variants. */
export function ExpandablePriceTable({
  items,
  caption = 'Valores dos barris de chopp por tamanho',
  volumeUnit = 'L',
}: Props) {
  const columns = sharedVariantColumns(items)
  return (
    <>
      <div className={styles.wrapper}>
        <table className={styles.table}>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={[styles.head, styles.nameCol].join(' ')}>
                Produto
              </th>
              {columns ? (
                columns.map((col) => (
                  <th
                    key={col.code}
                    scope="col"
                    className={[styles.head, styles.headPrice].join(' ')}
                  >
                    {formatVariantLabel(col, volumeUnit)}
                  </th>
                ))
              ) : (
                <th scope="col" className={styles.head}>
                  Apresentações e valores
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={styles.row} data-item-id={item.id}>
                <th scope="row" className={styles.nameCell}>
                  <span className={styles.title}>{item.name}</span>
                  <span className={styles.description}>{item.description}</span>
                </th>
                {columns ? (
                  item.variants.map((variant) => (
                    <td key={variant.code} className={styles.priceCell}>
                      <VariantOffer item={item} variant={variant} volumeUnit={volumeUnit} compact />
                    </td>
                  ))
                ) : (
                  <td className={styles.priceCell}>
                    <ul className={styles.offerList}>
                      {item.variants.map((variant) => (
                        <li key={variant.code}>
                          <VariantOffer item={item} variant={variant} volumeUnit={volumeUnit} />
                        </li>
                      ))}
                    </ul>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.mobileCards}>
        {items.map((item) => (
          <article
            key={item.id}
            className={styles.card}
            aria-label={item.name}
            data-item-id={item.id}
          >
            <header className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>{item.name}</h3>
              <p className={styles.cardDesc}>{item.description}</p>
            </header>
            <div className={styles.variantGrid}>
              {item.variants.map((variant) => (
                <VariantOffer
                  key={variant.code}
                  item={item}
                  variant={variant}
                  volumeUnit={volumeUnit}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
