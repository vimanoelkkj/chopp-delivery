import type { CatalogItemV2, CatalogVariantV2 } from './types'

/** Codes are item-scoped. A shared matrix is safe only when every presentation and its order agree. */
export function sharedVariantColumns(items: CatalogItemV2[]): CatalogVariantV2[] | null {
  const first = items[0]?.variants
  if (!first) return []
  return items.every(
    (item) =>
      item.variants.length === first.length &&
      item.variants.every(
        (variant, index) =>
          variant.label === first[index].label && variant.volumeMl === first[index].volumeMl,
      ),
  )
    ? first
    : null
}
