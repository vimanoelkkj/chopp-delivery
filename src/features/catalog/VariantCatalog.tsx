import { formatBRL } from '@/shared/lib/format'
import type { PublicCatalog } from '../../../shared/catalog'
import { centsToReais } from '../../../shared/money'

export function VariantCatalog({ items }: { items: PublicCatalog['categories'][number]['items'] }) {
  return (
    <div>
      {items.map((item) => (
        <article key={item.id} aria-label={item.name}>
          <h3>{item.name}</h3>
          <p>{item.description}</p>
          <ul>
            {item.variants.map((v) => (
              <li key={v.code}>
                {v.label}
                {v.volumeMl === null ? '' : ` · ${v.volumeMl} ml`} ·{' '}
                {v.priceCents === null
                  ? 'Não comercializado'
                  : formatBRL(centsToReais(v.priceCents))}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}
