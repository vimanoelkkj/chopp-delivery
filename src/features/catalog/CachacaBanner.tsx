import { useState } from 'react'
import { describeOrderPrice } from '@/features/contact/messages'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import { formatOrderTotal, normalizeQuantity } from '@/shared/lib/quantity'
import { QuantityStepper } from '@/shared/ui/QuantityStepper'
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

/** Uma garrafa com seu próprio seletor de quantidade; preço ausente não permite pedir. */
function BottleOffer({
  productName,
  label,
  presentation,
  price,
  buttonLabel,
}: {
  productName: string
  label: string
  presentation: string
  price: number | null
  buttonLabel: string
}) {
  const [quantity, setQuantity] = useState(1)
  const qty = normalizeQuantity(quantity)
  const message = `Olá! Gostaria de adicionar a ${productName} (${presentation}) ao meu pedido. Quantidade: ${qty} ${qty === 1 ? 'unidade' : 'unidades'}. ${describeOrderPrice(price, qty, true)}`

  return (
    <div className={styles.variantCard}>
      <div className={styles.priceBlock}>
        <span className={styles.priceSub}>{label}</span>
        <span className={styles.price}>
          <span className="visually-hidden"> · </span>
          {price !== null ? formatBRL(price) : 'Indisponível'}
        </span>
      </div>
      {price !== null ? (
        <>
          <QuantityStepper
            value={qty}
            onChange={setQuantity}
            subject={`${productName}, ${presentation}`}
            total={formatOrderTotal(price, qty, true)}
          />
          <WhatsAppButton customText={message} variant="gold" size="md">
            {buttonLabel}
          </WhatsAppButton>
        </>
      ) : null}
    </div>
  )
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
          item.variants.map((v) => (
            <BottleOffer
              key={v.code}
              productName={productName}
              label={`${v.label} ${v.volumeMl ? `${v.volumeMl} ml` : ''}`}
              presentation={`${v.label}${v.volumeMl ? ` - ${v.volumeMl}ml` : ''}`}
              price={v.priceCents !== null ? centsToReais(v.priceCents) : null}
              buttonLabel={`Adicionar ${v.label}`}
            />
          ))
        ) : (
          <BottleOffer
            productName={productName}
            label={`Garrafa ${item.bottleMl} ml`}
            presentation={`Garrafa ${item.bottleMl}ml`}
            price={item.price}
            buttonLabel="Adicionar ao Pedido"
          />
        )}
      </div>
    </aside>
  )
}
