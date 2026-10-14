import { formatBRL } from '@/shared/lib/format'
import styles from './CachacaBanner.module.css'
import type { Cachaca } from './types'

export function CachacaBanner({ item }: { item: Cachaca }) {
  return (
    <aside className={styles.banner} aria-label={item.title}>
      <div className={styles.copy}>
        <p className={styles.title}>{item.title}</p>
        <p className={styles.description}>{item.description}</p>
      </div>
      <p className={styles.price}>
        Garrafa {item.bottleMl} ml · {formatBRL(item.price)}
      </p>
    </aside>
  )
}
