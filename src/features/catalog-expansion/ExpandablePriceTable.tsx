import { useMemo } from 'react'
import { contact } from '@/features/contact/config'
import { messages } from '@/features/contact/messages'
import { buildWhatsAppUrl } from '@/shared/lib/whatsapp'
import styles from './ExpandablePriceTable.module.css'
import { type CatalogItemV2, formatPriceFromCents } from './types'

type ExpandablePriceTableProps = {
  items: CatalogItemV2[]
  caption?: string
}

/**
 * Tabela e cards de preços dinâmicos para catálogo expansível v2.
 * Detecta dinamicamente todas as variantes comercializadas (ex.: 7,5 L, 20 L, 30 L, 50 L),
 * sem hardcode de colunas fixas e tratando variantes sem preço como indisponíveis/não compráveis.
 */
export function ExpandablePriceTable({
  items,
  caption = 'Valores dos barris de chopp por tamanho',
}: ExpandablePriceTableProps) {
  // Extrai todas as variantes distintas presentes nos produtos, ordenando por volume
  const variantColumns = useMemo(() => {
    const colMap = new Map<string, { code: string; label: string; volumeMl?: number | null }>()

    for (const item of items) {
      for (const variant of item.variants) {
        if (!colMap.has(variant.code)) {
          colMap.set(variant.code, {
            code: variant.code,
            label: variant.label,
            volumeMl: variant.volumeMl,
          })
        }
      }
    }

    return Array.from(colMap.values()).sort((a, b) => {
      const volA = a.volumeMl ?? 0
      const volB = b.volumeMl ?? 0
      return volA - volB
    })
  }, [items])

  const orderUrl = buildWhatsAppUrl(contact.whatsappNumber, messages.order) ?? '#'

  return (
    <>
      {/* Visualização em Tabela para Desktop */}
      <div className={styles.wrapper}>
        <table className={styles.table}>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={[styles.head, styles.nameCol].join(' ')}>
                Chopp
              </th>
              {variantColumns.map((col) => (
                <th
                  key={col.code}
                  scope="col"
                  className={[styles.head, styles.headPrice].join(' ')}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const hasManyVariants = item.variants.length > 2
              const isNew = item.id.includes('session-ipa') || item.name.includes('(Novo)')

              return (
                <tr key={item.id} className={styles.row}>
                  <th scope="row" className={styles.nameCell}>
                    <div className={styles.titleGroup}>
                      <span className={styles.title}>{item.name.replace(' (Novo)', '')}</span>
                      {isNew && <span className={styles.badgeNew}>Novo</span>}
                      {hasManyVariants && (
                        <span className={styles.badgeMulti}>{item.variants.length} tamanhos</span>
                      )}
                    </div>
                    <span className={styles.description}>{item.description}</span>
                  </th>
                  {variantColumns.map((col) => {
                    const variant = item.variants.find((v) => v.code === col.code)
                    const isUnavail = !variant || variant.priceCents === null

                    if (isUnavail) {
                      return (
                        <td key={col.code} className={styles.unavailable}>
                          <span aria-hidden="true">—</span>
                          <span className="visually-hidden">não disponível</span>
                        </td>
                      )
                    }

                    const priceText = formatPriceFromCents(variant.priceCents)

                    return (
                      <td key={col.code} className={styles.priceCell}>
                        {priceText}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Visualização em Cards com Chips de Variantes para Mobile */}
      <div className={styles.mobileCards}>
        {items.map((item) => {
          const isNew = item.id.includes('session-ipa') || item.name.includes('(Novo)')

          return (
            <article key={`card-${item.id}`} className={styles.card}>
              <header className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>
                  {item.name.replace(' (Novo)', '')}
                  {isNew && <span className={styles.badgeNew}>Novo</span>}
                </h3>
                <p className={styles.cardDesc}>{item.description}</p>
              </header>

              <div className={styles.variantGrid}>
                {variantColumns.map((col) => {
                  const variant = item.variants.find((v) => v.code === col.code)
                  const isAvailable = Boolean(variant && variant.priceCents !== null)

                  if (!isAvailable) {
                    return (
                      <div
                        key={`chip-unavail-${item.id}-${col.code}`}
                        className={[styles.variantChip, styles.variantChipDisabled].join(' ')}
                        aria-disabled="true"
                      >
                        <span className={styles.chipSize}>{col.label}</span>
                        <span className={styles.chipUnavail}>Indisponível</span>
                      </div>
                    )
                  }

                  const priceText = formatPriceFromCents(variant?.priceCents)

                  return (
                    <a
                      key={`chip-${item.id}-${col.code}`}
                      href={orderUrl}
                      className={[styles.variantChip, styles.variantChipAvailable].join(' ')}
                      aria-label={`Pedir ${item.name} ${col.label} por ${priceText}`}
                    >
                      <span className={styles.chipSize}>{col.label}</span>
                      <span className={styles.chipPrice}>{priceText}</span>
                    </a>
                  )
                })}
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}
