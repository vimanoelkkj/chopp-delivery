import type { PublicCatalog } from '../../../shared/catalog'
import { cachacaProductName } from '../catalog/CachacaBanner'
import { type CartLine, lineKey } from './cart'

export type PriceChange = { line: CartLine; fromCents: number; toCents: number }
export type CartIssues = { removed: CartLine[]; changed: PriceChange[] }

/**
 * Confronta o pedido com o catálogo público atual. Item oculto, variante inexistente ou sem preço
 * contam como removidos; preço diferente conta como alterado. `lines` já vem com o catálogo aplicado.
 */
export function reconcileCart(lines: readonly CartLine[], catalog: PublicCatalog) {
  const index = new Map<string, { name: string; label: string; priceCents: number | null }>()
  for (const category of catalog.categories)
    for (const item of category.items) {
      if (!item.visible) continue
      for (const variant of item.variants)
        index.set(lineKey({ itemId: item.id, variantCode: variant.code }), {
          name: category.id === 'cachacas' ? cachacaProductName(item.name) : item.name,
          label: variant.label,
          priceCents: variant.priceCents,
        })
    }
  const issues: CartIssues = { removed: [], changed: [] }
  const next: CartLine[] = []
  for (const line of lines) {
    const current = index.get(lineKey(line))
    if (!current || current.priceCents === null) {
      issues.removed.push(line)
      continue
    }
    if (current.priceCents !== line.unitPriceCents)
      issues.changed.push({ line, fromCents: line.unitPriceCents, toCents: current.priceCents })
    next.push({
      ...line,
      name: current.name,
      label: current.label,
      unitPriceCents: current.priceCents,
    })
  }
  const clean = issues.removed.length === 0 && issues.changed.length === 0
  return { lines: next, issues, clean }
}
