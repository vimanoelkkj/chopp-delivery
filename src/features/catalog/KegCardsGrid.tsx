import { useState } from 'react'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import styles from './KegCardsGrid.module.css'
import type { BarrelSize, Product } from './types'

export type KegCardsGridProps = {
  products: Product[]
  initialVolume?: BarrelSize
}

const PRODUCT_METADATA: Record<string, { isFlip?: boolean; image?: string }> = {
  dronken: { image: '/images/kegs/keg-hero-50l.jpg' },
  'palato-beber': { image: '/images/kegs/keg-studio-30l.jpg' },
  'villa-alema': { isFlip: true, image: '/images/kegs/keg-studio-30l.jpg' },
  'krug-bier': { image: '/images/kegs/keg-studio-30l.jpg' },
  brahma: { image: '/images/kegs/keg-hero-50l.jpg' },
  kaiser: { image: '/images/kegs/keg-studio-30l.jpg' },
  heineken: { image: '/images/kegs/keg-hero-50l.jpg' },
  'chopp-de-vinho': { image: '/images/kegs/keg-studio-30l.jpg' },
}

export function getProductTag(_product: Product): string {
  // A12: Não inventa estilos comerciais não declarados no CMS; utiliza identificador neutro
  return 'Barril Inox'
}

export function KegCardsGrid({ products, initialVolume }: KegCardsGridProps) {
  const [selectedVolume, setSelectedVolume] = useState<BarrelSize>(initialVolume ?? 30)

  return (
    <div className={styles.container}>
      {/* Seletor Rápido de Volume Global com Cálculo de Doses */}
      <div className={styles.switcherRow}>
        <div className={styles.volumeDoseInfo}>
          <span>Rendimento estimado:</span>
          <span className={styles.doseHighlight}>
            {selectedVolume === 30
              ? '~60 copos de 500ml (ou 100 de 300ml)'
              : '~100 copos de 500ml (ou 160 de 300ml)'}
          </span>
        </div>

        <fieldset className={styles.switcherGroup} aria-label="Seletor de Litragem">
          <span className={styles.switcherLabel}>Litragem:</span>
          <button
            type="button"
            className={`${styles.switchBtn} ${selectedVolume === 30 ? styles.switchBtnActive : ''}`}
            onClick={() => setSelectedVolume(30)}
            aria-pressed={selectedVolume === 30}
          >
            Barril 30L
          </button>
          <button
            type="button"
            className={`${styles.switchBtn} ${selectedVolume === 50 ? styles.switchBtnActive : ''}`}
            onClick={() => setSelectedVolume(50)}
            aria-pressed={selectedVolume === 50}
          >
            Barril 50L
          </button>
        </fieldset>
      </div>

      {/* Grid Responsivo de Cards Reais */}
      <div className={styles.grid}>
        {products.map((product) => {
          const meta = PRODUCT_METADATA[product.id] ?? {
            image: '/images/kegs/keg-hero-50l.jpg',
          }
          const price = product.prices[selectedVolume]
          const isOnly50L = product.prices[30] === null && product.prices[50] !== null
          const isOnly30L = product.prices[30] !== null && product.prices[50] === null
          const isUnavailableForSelected = price === null

          const kegImageSrc =
            meta.image ??
            (selectedVolume === 50
              ? '/images/kegs/keg-hero-50l.jpg'
              : '/images/kegs/keg-studio-30l.jpg')

          const orderMessage = `Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de ${product.name} (${selectedVolume}L).`

          // Mensagens corretas para quando uma variante não estiver disponível (A07)
          let unavailableText = '— (Indisponível)'
          let disabledBtnText = 'Indisponível'
          if (isOnly50L && selectedVolume === 30) {
            unavailableText = '— (Disponível em 50L)'
            disabledBtnText = 'Somente 50 Litros'
          } else if (isOnly30L && selectedVolume === 50) {
            unavailableText = '— (Disponível em 30L)'
            disabledBtnText = 'Somente 30 Litros'
          }

          return (
            <article key={product.id} className={styles.card} aria-label={product.name}>
              <div>
                <div className={styles.topRow}>
                  <span className={styles.styleBadge}>{getProductTag(product)}</span>
                  {isOnly50L ? (
                    <span className={styles.stockBadgeOnly50}>Apenas 50L</span>
                  ) : isOnly30L ? (
                    <span className={styles.stockBadgeOnly50}>Apenas 30L</span>
                  ) : (
                    <span className={styles.stockBadgeAvailable}>30L &amp; 50L</span>
                  )}
                </div>

                <div className={styles.imageWrap}>
                  <img
                    src={kegImageSrc}
                    alt={`Barril de ${product.name} em aço escovado`}
                    className={`${styles.kegImage} ${meta.isFlip ? styles.kegFlip : ''}`}
                    loading="lazy"
                  />
                </div>

                <div className={styles.cardInfo}>
                  <h3 className={styles.name}>{product.name}</h3>
                  <p className={styles.desc}>{product.description}</p>
                </div>
              </div>

              <div className={styles.cardBottom}>
                <div className={styles.priceRow}>
                  <span className={styles.priceLabel}>Barril {selectedVolume}L:</span>
                  {isUnavailableForSelected ? (
                    <span className={styles.priceUnavailable}>{unavailableText}</span>
                  ) : (
                    <span className={styles.priceValue}>
                      {formatBRL(price, { cents: !Number.isInteger(price) })}
                    </span>
                  )}
                </div>

                {isUnavailableForSelected ? (
                  <button
                    type="button"
                    className={`${styles.orderBtn} ${styles.orderBtnDisabled}`}
                    disabled
                  >
                    {disabledBtnText}
                  </button>
                ) : (
                  <WhatsAppButton customText={orderMessage} fullWidth variant="gold">
                    Pedir Barril {selectedVolume}L
                  </WhatsAppButton>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
