import type { BarrelSize, Product } from './types'

export function visibleProducts(items: Product[]): Product[] {
  return items.filter((product) => product.visible)
}

/** Menor preço entre os produtos visíveis que vendem o tamanho. `null` se nenhum vende. */
export function lowestPrice(items: Product[], size: BarrelSize): number | null {
  const prices = visibleProducts(items)
    .map((product) => product.prices[size])
    .filter((price): price is number => price !== null)
  return prices.length > 0 ? Math.min(...prices) : null
}

/** Produtos visíveis que só existem no barril de 50 L. */
export function onlyLargeBarrel(items: Product[]): Product[] {
  return visibleProducts(items).filter(
    (product) => product.prices[30] === null && product.prices[50] !== null,
  )
}

/** Lista de nomes em português: "A, B e C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}
