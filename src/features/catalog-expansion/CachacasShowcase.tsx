import { useState } from 'react'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import styles from './CachacasShowcase.module.css'
import { type CatalogItemV2, centsToReaisSafe, formatPriceFromCents } from './types'

/** Only the original legacy heading is an alias; operator-entered names remain intact. */
export function normalizeCachacaName(name: string): string {
  return /^(temos cachaça|temos cachaca)$/i.test(name) ? 'Cachaça' : name
}
export function formatBottleLabel(variant: { label: string; volumeMl?: number | null }): string {
  if (variant.volumeMl == null) return variant.label
  const volume = `${variant.volumeMl.toLocaleString('pt-BR')} ml`
  return ` ${variant.label.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')} `.includes(
    ` ${volume} `,
  )
    ? variant.label
    : `${variant.label} ${volume}`
}
export function buildCachacaWhatsAppMessage(
  itemName: string,
  variant: { label: string; volumeMl?: number | null; priceCents: number | null },
): string | null {
  if (variant.priceCents === null) return null
  const price = centsToReaisSafe(variant.priceCents)
  if (price === null) return null
  const volume =
    variant.volumeMl != null
      ? `${variant.volumeMl.toLocaleString('pt-BR')} ml`
      : variant.label.replace(/garrafa\s+/i, '')
  const presentation = ['garrafa', `garrafa ${volume}`].includes(
    variant.label.toLocaleLowerCase('pt-BR'),
  )
    ? volume
    : variant.volumeMl != null
      ? `${variant.label} · ${volume}`
      : variant.label
  return `Olá! Gostaria de pedir uma garrafa de ${normalizeCachacaName(itemName)} ${presentation} por ${formatBRL(price)}.`
}
export function CachacasShowcase({ items }: { items: CatalogItemV2[] }) {
  if (items.length === 0) return null
  return (
    <section className={styles.container} aria-labelledby="cachacas-heading">
      <header className={styles.header}>
        <p className={styles.eyebrow}>NOSSA SELEÇÃO</p>
        <h3 id="cachacas-heading" className={styles.title}>
          CACHAÇAS
        </h3>
        <p className={styles.subtitle}>Confira nossas opções de cachaça e escolha sua garrafa.</p>
      </header>
      <div className={styles.grid}>
        {items.map((item) => (
          <CachacaCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
function CachacaCard({ item }: { item: CatalogItemV2 }) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const available = item.variants.filter((variant) => variant.priceCents !== null)
  const single = available.length === 1
  const active = single ? available[0] : available.find((variant) => variant.code === selectedCode)
  const name = normalizeCachacaName(item.name)
  const message = active ? buildCachacaWhatsAppMessage(item.name, active) : null
  return (
    <article
      className={styles.card}
      aria-label={name}
      data-testid={`cachaca-card-${item.id}`}
      data-item-id={item.id}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardBadgeOfficial}>Disponível no cardápio</span>
        <h4 className={styles.cardTitle}>{name}</h4>
        <p className={styles.cardDesc}>{item.description}</p>
      </div>
      <div className={styles.variantsList}>
        {!single && <p className={styles.selectPrompt}>Selecione o tamanho da garrafa:</p>}
        {item.variants.map((variant) => {
          const selected = active?.code === variant.code
          const content = (
            <>
              <span className={styles.variantVolume}>{formatBottleLabel(variant)}</span>
              <span className={styles.variantPrice}>
                {formatPriceFromCents(variant.priceCents)}
              </span>
            </>
          )
          return single ? (
            <div
              key={variant.code}
              className={[styles.variantRow, styles.variantRowStatic].join(' ')}
              data-variant-code={variant.code}
            >
              {content}
            </div>
          ) : (
            <button
              key={variant.code}
              type="button"
              disabled={variant.priceCents === null}
              className={[styles.variantRow, selected ? styles.variantRowSelected : ''].join(' ')}
              aria-pressed={selected}
              onClick={() => setSelectedCode(variant.code)}
              data-variant-code={variant.code}
            >
              {content}
            </button>
          )
        })}
        <div className={styles.actions}>
          {active && message ? (
            <WhatsAppButton message="order" customMessage={message} className={styles.orderBtn}>
              Pedir {name} {formatBottleLabel(active)} no WhatsApp
            </WhatsAppButton>
          ) : (
            <span className={styles.orderBtnPrompt} data-testid="select-variant-prompt">
              Selecione uma garrafa acima
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
