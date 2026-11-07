import { buildBarrelOrderMessage } from '@/features/contact/messages'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL } from '@/shared/lib/format'
import styles from './PriceComparison.module.css'
import { lowestPrice } from './pricing'
import { BARREL_SIZES, type BarrelSize, type Product } from './types'

function orderMessage(product: Product, size: BarrelSize) {
  return buildBarrelOrderMessage(product.name, `${size}L`, product.prices[size])
}

function Offer({
  product,
  size,
  lowest,
}: {
  product: Product
  size: BarrelSize
  lowest: number | null
}) {
  const price = product.prices[size]

  if (price === null) {
    return (
      <td className={styles.offer} data-label={`${size} L`}>
        <span className={styles.unavailable}>Indisponível</span>
        <span className="visually-hidden">{` não disponível em ${size} litros`}</span>
      </td>
    )
  }

  return (
    <td className={styles.offer} data-label={`${size} L`}>
      <div className={styles.offerInner}>
        <span className={styles.priceBox}>
          <span className={styles.price}>
            {formatBRL(price, { cents: !Number.isInteger(price) })}
          </span>
          {price === lowest && <span className={styles.lowest}>Menor valor</span>}
        </span>
        <WhatsAppButton
          customText={orderMessage(product, size)}
          variant="gold"
          className={styles.order}
        >
          Pedir
          <span className="visually-hidden">{` ${product.name}, barril de ${size} litros`}</span>
        </WhatsAppButton>
      </div>
    </td>
  )
}

/**
 * Tabela única de comparação: 30 L e 50 L lado a lado, com pedido por volume. Substitui a grade
 * de cards e a tabela antiga, que repetiam os mesmos barris. Tamanho não vendido permanece
 * na tabela como indisponível, sem preço ou pedido; o produto oculto nem chega aqui (o chamador filtra).
 */
export function PriceComparison({ products }: { products: Product[] }) {
  const lowest: Record<BarrelSize, number | null> = {
    30: lowestPrice(products, 30),
    50: lowestPrice(products, 50),
  }

  return (
    <table className={styles.table}>
      <caption className="visually-hidden">
        Valores dos barris de chopp por tamanho, com pedido pelo WhatsApp
      </caption>
      <thead className={styles.thead}>
        <tr>
          <th scope="col" className={styles.headName}>
            Chopp
          </th>
          {BARREL_SIZES.map((size) => (
            <th scope="col" key={size} className={styles.head}>
              Barril {size} L
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {products.map((product) => (
          <tr key={product.id} className={styles.row}>
            <th scope="row" className={styles.name}>
              <span className={styles.title}>{product.name}</span>
              <span className={styles.description}>{product.description}</span>
            </th>
            {BARREL_SIZES.map((size) => (
              <Offer key={size} product={product} size={size} lowest={lowest[size]} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
