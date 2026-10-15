import { formatBRL } from '@/shared/lib/format'
import type { PublicCatalog } from '../../../shared/catalog'
import { centsToReais } from '../../../shared/money'
import styles from './CachacaBanner.module.css'
import type { Cachaca } from './types'

type ExpandedBottle = Pick<Cachaca, 'title' | 'description'> & {
  variants: PublicCatalog['categories'][number]['items'][number]['variants']
}
export function CachacaBanner({ item }: { item: Cachaca | ExpandedBottle }) {
  return (
    <aside className={styles.banner} aria-label={item.title}>
      <div className={styles.copy}>
        <p className={styles.title}>{item.title}</p>
        <p className={styles.description}>{item.description}</p>
      </div>
      <p className={styles.price}>
        {'variants' in item ? (
          item.variants.map((v, index) => (
            <span key={v.code}>
              {index > 0 && <br />}
              {v.label} {v.volumeMl} ml ·{' '}
              {v.priceCents === null ? 'Não comercializado' : formatBRL(centsToReais(v.priceCents))}
            </span>
          ))
        ) : (
          <>
            Garrafa {item.bottleMl} ml · {formatBRL(item.price)}
          </>
        )}
      </p>
    </aside>
  )
}
