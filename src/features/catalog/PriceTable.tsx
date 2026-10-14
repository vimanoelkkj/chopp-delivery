import { formatBRL } from '@/shared/lib/format'
import styles from './PriceTable.module.css'
import { BARREL_SIZES, type Product } from './types'

type PriceTableProps = {
  products: Product[]
}

/** Tabela de valores. Tamanho não vendido mostra "—" com texto acessível. */
export function PriceTable({ products }: PriceTableProps) {
  return (
    <table className={styles.table}>
      <caption className="visually-hidden">Valores dos barris de chopp por tamanho</caption>
      <colgroup>
        <col className={styles.nameCol} />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className={styles.head}>
            Chopp
          </th>
          {BARREL_SIZES.map((size) => (
            <th key={size} scope="col" className={styles.head}>
              <span className={styles.sizeLong}>Barril </span>
              {size} L
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
            {BARREL_SIZES.map((size) => {
              const price = product.prices[size]
              return (
                <td key={size} className={price === null ? styles.unavailable : styles.price}>
                  {price === null ? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="visually-hidden">não disponível</span>
                    </>
                  ) : (
                    formatBRL(price, { cents: false })
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
