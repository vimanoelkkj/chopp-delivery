export type CatalogVariant = {
  code: string
  creationRef: string | null
  label: string
  volumeMl: number | null
  priceCents: number | null
}
export type CatalogItem = {
  id: string
  creationRef: string | null
  name: string
  description: string
  visible: boolean
  variants: CatalogVariant[]
}
export type CatalogCategory = { id: string; name: string; items: CatalogItem[] }
export type ExpandedCatalog = { revision: string; categories: CatalogCategory[] }
export type PublicCatalog = {
  revision: string
  categories: {
    id: string
    name: string
    items: (Omit<CatalogItem, 'creationRef' | 'variants'> & {
      variants: Omit<CatalogVariant, 'creationRef'>[]
    })[]
  }[]
}
