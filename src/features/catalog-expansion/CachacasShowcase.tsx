import { useState } from 'react'
import { contact } from '@/features/contact/config'
import { formatBRL } from '@/shared/lib/format'
import { buildWhatsAppUrl } from '@/shared/lib/whatsapp'
import styles from './CachacasShowcase.module.css'
import { type CatalogItemV2, centsToReaisSafe, formatPriceFromCents } from './types'

type CachacasShowcaseProps = {
  items: CatalogItemV2[]
}

/**
 * Vitrine de Cachaças para o catálogo público v2.
 * Regras comerciais e de navegação:
 * - Apoio: "NOSSA SELEÇÃO"
 * - Título: "CACHAÇAS"
 * - Descrição: "Confira nossas opções de cachaça e escolha sua garrafa."
 * - Produto com variante única: o CTA do WhatsApp inclui diretamente a variante e seu volume na mensagem.
 * - Produto com múltiplas variantes (demonstração): o cliente DEVE selecionar explicitamente uma variante antes de pedir pelo WhatsApp (nunca seleção arbitrária).
 * - Sem menções não confirmadas a alambique próprio, artesanal ou envelhecimento.
 */
export function CachacasShowcase({ items }: CachacasShowcaseProps) {
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

export function normalizeCachacaName(name: string): string {
  const clean = name.replace(' (Demonstração)', '').replace(' (Referência)', '').trim()
  if (clean.toLowerCase() === 'temos cachaça' || clean.toLowerCase() === 'temos cachaca') {
    return 'Cachaça'
  }
  return clean
}

export function formatBottleLabel(variant: { label: string; volumeMl?: number | null }): string {
  if (variant.label.toLowerCase().includes('ml')) {
    return variant.label
  }
  if (variant.volumeMl) {
    const formattedVol = `${variant.volumeMl.toLocaleString('pt-BR')} ml`
    return `${variant.label} ${formattedVol}`
  }
  return variant.label
}

export function buildCachacaWhatsAppMessage(
  itemName: string,
  variant: { label: string; volumeMl?: number | null; priceCents: number | null },
): string {
  const cleanName = normalizeCachacaName(itemName)
  const volumeNumber = variant.volumeMl
    ? `${variant.volumeMl.toLocaleString('pt-BR')} ml`
    : variant.label.replace(/garrafa\s+/i, '')
  const priceValue = variant.priceCents !== null ? centsToReaisSafe(variant.priceCents) : null
  const priceFormatted = priceValue !== null ? formatBRL(priceValue, { cents: true }) : '—'

  return `Olá! Gostaria de pedir uma garrafa de ${cleanName} ${volumeNumber} por ${priceFormatted}.`
}

function CachacaCard({ item }: { item: CatalogItemV2 }) {
  // Ordena variantes por volume (ex.: 500 ml antes de 700 ml)
  const availableVariants = [...item.variants]
    .filter((v) => v.priceCents !== null)
    .sort((a, b) => (a.volumeMl ?? 0) - (b.volumeMl ?? 0))

  const isSingleVariant = availableVariants.length === 1

  // Se houver múltiplas variantes, nenhuma é pré-selecionada arbitrariamente (exigência explícita)
  const [selectedVariantCode, setSelectedVariantCode] = useState<string | null>(
    isSingleVariant ? availableVariants[0].code : null,
  )

  const displayName = normalizeCachacaName(item.name)
  const isDemo = item.name.includes('(Demonstração)') || item.name.includes('(Teste)')
  const isOfficial = !isDemo

  const activeVariant = availableVariants.find((v) => v.code === selectedVariantCode)

  // Mensagem contextual para o WhatsApp
  let orderUrl: string | null = null
  if (activeVariant && activeVariant.priceCents !== null) {
    const customMessage = buildCachacaWhatsAppMessage(item.name, activeVariant)
    orderUrl = buildWhatsAppUrl(contact.whatsappNumber, customMessage)
  }

  return (
    <article className={styles.card} data-testid={`cachaca-card-${item.id}`}>
      <div className={styles.cardTop}>
        <span className={isOfficial ? styles.cardBadgeOfficial : styles.cardBadgeDemo}>
          {isOfficial ? 'Disponível no cardápio' : 'Demonstração v2'}
        </span>
        <h4 className={styles.cardTitle}>{displayName}</h4>
        <p className={styles.cardDesc}>{item.description}</p>
      </div>

      <div className={styles.variantsList}>
        {!isSingleVariant && (
          <p className={styles.selectPrompt}>
            {selectedVariantCode ? 'Tamanho selecionado:' : 'Selecione o tamanho da garrafa:'}
          </p>
        )}

        {availableVariants.map((variant) => {
          const isSelected = selectedVariantCode === variant.code
          const priceText = formatPriceFromCents(variant.priceCents)
          const displayLabel = formatBottleLabel(variant)

          if (isSingleVariant) {
            return (
              <div
                key={`cachaca-var-${item.id}-${variant.code}`}
                className={[styles.variantRow, styles.variantRowStatic].join(' ')}
              >
                <span className={styles.variantVolume}>{displayLabel}</span>
                <span className={styles.variantPrice}>{priceText}</span>
              </div>
            )
          }

          return (
            <button
              key={`cachaca-var-${item.id}-${variant.code}`}
              type="button"
              className={[styles.variantRow, isSelected ? styles.variantRowSelected : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelectedVariantCode(variant.code)}
              aria-pressed={isSelected}
            >
              <span className={styles.variantVolume}>
                {isSelected ? '✓ ' : ''}
                {displayLabel}
              </span>
              <span className={styles.variantPrice}>{priceText}</span>
            </button>
          )
        })}

        <div className={styles.actions}>
          {isSingleVariant && orderUrl && (
            <a
              href={orderUrl}
              className={styles.orderBtn}
              aria-label={`Pedir ${displayName} ${formatBottleLabel(availableVariants[0])} no WhatsApp`}
            >
              Pedir {formatBottleLabel(availableVariants[0])} no WhatsApp
            </a>
          )}

          {!isSingleVariant && activeVariant && orderUrl && (
            <a
              href={orderUrl}
              className={styles.orderBtn}
              aria-label={`Pedir ${displayName} ${formatBottleLabel(activeVariant)} no WhatsApp`}
            >
              Pedir {formatBottleLabel(activeVariant)} no WhatsApp
            </a>
          )}

          {!isSingleVariant && !activeVariant && (
            <span className={styles.orderBtnPrompt} data-testid="select-variant-prompt">
              Selecione uma garrafa acima
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
